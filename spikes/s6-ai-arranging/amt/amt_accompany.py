# SPDX-License-Identifier: MIT
"""Accompaniment for a melody with the Anticipatory Music Transformer (AMT).

Contract (cuccia AI node, batch workload):
  /inputs/melody.mid   melody (any instrument/track; every note is used as a control)
  /inputs/args.json    optional settings, see DEFAULTS
  /outputs/accompaniment.mid   generated accompaniment only
  /outputs/combined.mid        accompaniment + melody
  /outputs/report.json         timings, device, model, counts

Weights are baked into the image (no network). Locally, point AMT_MODEL_DIR at a downloaded
snapshot and AMT_INPUTS / AMT_OUTPUTS at folders.
Model + code: Apache-2.0 (stanford-crfm/music-*-800k, jthickstun/anticipation).
"""
import json
import os
import sys
import time

DEFAULTS = {
    "top_p": 0.95,          # nucleus sampling (the paper's demos use 0.95-0.98)
    "seed": 1,
    "end_seconds": None,     # default: melody length + 1 s (AMT max sequence 100 s)
    "history_seconds": 0,    # >0: give the first N seconds of the melody as plain history too
    "drop_drums": True,      # AMT may add a drum kit (instrument 128); bells + our backing have their own
    "keep_programs": None,   # e.g. [0, 32, 48]: keep only these GM programs in the accompaniment
    "device": None,          # "cuda" | "cpu"; default cuda if available
}


def cpu_threads() -> int:
    """Threads for torch: the container's CPU quota (cgroup v2 cpu.max) if set, else all cores.
    torch defaults to every visible core; under a 4-CPU quota on a 20-thread host that
    oversubscribes and runs orders of magnitude slower."""
    n = os.cpu_count() or 1
    try:
        with open("/sys/fs/cgroup/cpu.max", encoding="utf-8") as f:
            quota, period = f.read().split()
        if quota != "max":
            n = min(n, max(1, int(int(quota) / int(period))))
    except (OSError, ValueError):
        pass
    return int(os.environ.get("AMT_THREADS", n))


def main() -> int:
    inputs = os.environ.get("AMT_INPUTS", "/inputs")
    outputs = os.environ.get("AMT_OUTPUTS", "/outputs")
    model_dir = os.environ.get("AMT_MODEL_DIR", "/opt/models/music-medium-800k")
    args = dict(DEFAULTS)
    args_path = os.path.join(inputs, "args.json")
    if os.path.exists(args_path):
        with open(args_path, encoding="utf-8") as f:
            args.update({k: v for k, v in json.load(f).items() if k in DEFAULTS})

    t0 = time.perf_counter()
    import torch
    from transformers import AutoModelForCausalLM
    from anticipation import ops
    from anticipation.config import TIME_RESOLUTION, MAX_TIME_IN_SECONDS
    from anticipation.convert import events_to_midi, midi_to_events
    from anticipation.sample import generate
    from anticipation.tokenize import extract_instruments
    from anticipation.vocab import NOTE_OFFSET

    device = args["device"] or ("cuda" if torch.cuda.is_available() else "cpu")
    torch.manual_seed(int(args["seed"]))
    torch.set_num_threads(cpu_threads())
    model = AutoModelForCausalLM.from_pretrained(model_dir, local_files_only=True).to(device).eval()
    if device == "cuda":
        model = model.half()  # fp16: about half the VRAM, same quality for sampling
    t_load = time.perf_counter()

    events = midi_to_events(os.path.join(inputs, "melody.mid"))
    instruments = sorted(ops.get_instruments(events).keys())
    _, melody = extract_instruments(events, instruments)  # every melody note becomes a control
    melody_len = ops.max_time(events, seconds=True)
    end = float(args["end_seconds"] or min(MAX_TIME_IN_SECONDS - 1, melody_len + 1.0))
    history = ops.clip(events, 0, float(args["history_seconds"]), clip_duration=False) if args["history_seconds"] else None
    start = float(args["history_seconds"] or 0)

    accompaniment = generate(model, start, end, inputs=history, controls=melody, top_p=float(args["top_p"]))
    t_gen = time.perf_counter()

    def keep(tokens):
        out = []
        for i in range(0, len(tokens), 3):
            note = tokens[i + 2] - NOTE_OFFSET
            instr = note // 128
            if args["drop_drums"] and instr == 128:
                continue
            if args["keep_programs"] is not None and instr not in args["keep_programs"]:
                continue
            out.extend(tokens[i:i + 3])
        return out

    # generate() returns history + new events (controls are not included); drop the history.
    acc_only = keep(ops.clip(accompaniment, start, end, clip_duration=False) if history else accompaniment)
    os.makedirs(outputs, exist_ok=True)
    events_to_midi(acc_only).save(os.path.join(outputs, "accompaniment.mid"))
    events_to_midi(ops.combine(acc_only, melody)).save(os.path.join(outputs, "combined.mid"))

    acc_instr = ops.get_instruments(acc_only)
    report = {
        "model_dir": model_dir,
        "device": device,
        "threads": torch.get_num_threads(),
        "torch": torch.__version__,
        "cuda_device": torch.cuda.get_device_name(0) if device == "cuda" else None,
        "max_vram_mib": round(torch.cuda.max_memory_allocated() / 2**20) if device == "cuda" else None,
        "args": args,
        "melody_seconds": round(melody_len, 2),
        "generated_until_seconds": end,
        "melody_events": len(melody) // 3,
        "accompaniment_events": len(acc_only) // 3,
        "accompaniment_instruments": {str(k): v for k, v in acc_instr.items()},
        "seconds": {"load": round(t_load - t0, 2), "generate": round(t_gen - t_load, 2), "total": round(time.perf_counter() - t0, 2)},
        "time_resolution": TIME_RESOLUTION,
    }
    with open(os.path.join(outputs, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    print(json.dumps(report))
    return 0


if __name__ == "__main__":
    sys.exit(main())
