# S6 — AI-assisted arranging: report

- Spike: [S6 brief](README.md#s6--ai-assisted-arranging) · code: [`spikes/s6-ai-arranging/`](../../spikes/s6-ai-arranging/README.md)
- Date: 2026-10-24 · one session, unattended (owner away) · decisions in
  [ADR-0011](../decisions/0011-ai-assisted-arranging.md) (Accepted 2026-10-25)
- Machine: Windows 11 laptop (22 logical CPUs, 32 GB, NVIDIA RTX 2000 Ada Laptop 8 GB), Node
  22.18, Python 3.11.9, Docker Desktop 29.9.2 (WSL2), headless Chrome 155
- Live node rerun: 2026-10-27, `dcuccia-north` (agent 0.1.0, RTX 3080 Ti 12 GB, Ollama
  `qwen3:8b`), laptop on the same Wi-Fi LAN. See [Live rerun on the node](#d-live-rerun-on-the-node-2026-10-27)

**Bottom line.** The node client, validators, candidate pipeline, AMT container and blind-listening
renderer all work. The **qwen3:8b arranging experiments are a clear "no"** (confirmed on the real
node on 2026-10-27, at ~5× lower latency): it infers worse chords
than S5's algorithm, and its descants either fail basic bar and range checks or are degenerate
(the tune copied a third higher, or the prompt's format example looped). A 30-line rule-based
descant beats it on every metric. Intros and endings work only in 4/4, and they quote the tune.
**AMT is undecided.** Its license is clean, the container runs under the node's sandbox rules,
and the small model's CPU output is weak (chord fit 0.30–0.40). A medium-model GPU run on the
node is the open question. It's waiting for cuccia-infra to register the fixed image.

> **Update 2026-10-27: the experiments were rerun on the real node** (token set, client CA pin
> fixed in [#73](https://github.com/dcuccia/go-go-harmoniyo/pull/73)). Latency dropped about 5×
> (median 1–1.6 s per call, ~110 tokens/s) and **the verdict is unchanged**; see
> [d](#d-live-rerun-on-the-node-2026-10-27). The caveat below describes the first run.
>
> **Original caveat: the node token was never available** (not in the Process, User or Machine
> environment all session; the coordinator confirmed that the owner is away). `/healthz` on
> the old URL answered `{"ok":true,"busy":false}` at 14:50 and timed out later (the node was
> probably asleep). So the qwen3:8b runs used a **local stand-in**: the official Qwen3-8B
> `Q4_K_M` GGUF (the quantization Ollama ships as `qwen3:8b`) behind the same `/v1` contract
> ([`local_llm_shim.py`](../../spikes/s6-ai-arranging/scripts/local_llm_shim.py), llama.cpp,
> thinking off as with `reasoning_effort: none`). Model and prompts match the node. **Latency
> does not**: the laptop GPU runs about 25 tokens/s against the node's measured ~120. One command
> reruns everything on the node once the token is set (see Infra follow-ups).

## What was built

| Part | What | Evidence |
|---|---|---|
| Node client ([`src/client.ts`](../../spikes/s6-ai-arranging/src/client.ts), [`env.ts`](../../spikes/s6-ai-arranging/src/env.ts), [`tls-fetch.ts`](../../spikes/s6-ai-arranging/src/tls-fetch.ts), [`wake.ts`](../../spikes/s6-ai-arranging/src/wake.ts)) | Zero-dependency TS (Node type stripping). Config from the process env or the Windows **User** env. HTTPS default `https://north.local` with the private CA pinned by SHA-256 (`CUCCIA_AI_CA_CERT`, never disables verification); the legacy `http://dcuccia-north.local:8790` still works. `/v1` chat with 503 Retry-After and exponential backoff for 429/502/504 and network errors; `/jobs` submit (multipart), poll, outputs, logs, cancel. Wake-on-LAN `ensureAwake()` re-implements cuccia-infra's `cuccia_ai_client.py` behaviour in TypeScript (no code copied; that repo declares no license) and shares its cache file. Token never printed; errors are redacted | 31 `node:test` tests, offline [mock node](../../spikes/s6-ai-arranging/src/mock-node.ts) |
| Smoke ([`scripts/smoke.ts`](../../spikes/s6-ai-arranging/scripts/smoke.ts)) | ensureAwake → health → status → models → 2 chats → `smoke-file` job | Mock: OK. Live 2026-10-27: OK. healthz 6 ms, `/v1/models` = `qwen3:8b`, chat 3.8 s first / 0.37 s warm, `smoke-file` job succeeded in 1.1 s ([`results/smoke.json`](../../spikes/s6-ai-arranging/results/smoke.json)) |
| Music I/O and checks ([`abc-io.ts`](../../spikes/s6-ai-arranging/src/abc-io.ts), [`songs.ts`](../../spikes/s6-ai-arranging/src/songs.ts), [`theory.ts`](../../spikes/s6-ai-arranging/src/theory.ts)) | Score → ABC writer that the S5 parser reads back exactly (all 8 carols round-trip: notes, chords, bar lines, pickups). Checks: bar lengths, key/diatonic share, range, chord-tone fit (all / strong beats), clashes and parallels against the tune, similar motion, pitch and bar variety, per-beat chord agreement, handbell playability through S5's `buildPart` | Tests |
| LLM harness ([`llm.ts`](../../spikes/s6-ai-arranging/src/llm.ts), [prompts](../../spikes/s6-ai-arranging/src/prompts/)) | Templates in the repo; ask → validate → up to 2 repair turns that send the validator's errors back. Every call is logged to JSONL with the full prompt and reply: this is the AI-provenance record | [`results/runs/`](../../spikes/s6-ai-arranging/results/runs/) |
| Candidates ([`build-candidates.ts`](../../spikes/s6-ai-arranging/scripts/build-candidates.ts), [`assemble.ts`](../../spikes/s6-ai-arranging/src/assemble.ts)) | Intro + tune + ending in voice 1, descant in voice 2, chords. S5 realizes bass/inner bells, then builds a chart (format 0.2.0, schema-valid). Originals untouched | [`candidates/`](../../spikes/s6-ai-arranging/candidates/), [`charts/`](../../spikes/s6-ai-arranging/charts/) |
| AMT ([`amt/`](../../spikes/s6-ai-arranging/amt/)) | CLI `/inputs/melody.mid` + `args.json` → `/outputs/accompaniment.mid`, `combined.mid`, `report.json`; Dockerfile with weights baked in and verified by SHA-256, base image pinned by digest, non-root, works on a read-only rootfs; workload [`manifest.json`](../../spikes/s6-ai-arranging/amt/manifest.json) (published digest, [#56](https://github.com/dcuccia/go-go-harmoniyo/pull/56)); owner-only [`publish.ps1`](../../spikes/s6-ai-arranging/amt/publish.ps1), superseded by the `s6-amt-image` workflow | Local CPU runs; sandboxed container smoke ([`container-smoke.json`](../../spikes/s6-ai-arranging/results/amt/container-smoke.json)) |
| Blind-listening set ([`render-previews.ts`](../../spikes/s6-ai-arranging/scripts/render-previews.ts), [`preview/`](../../spikes/s6-ai-arranging/preview/)) | Headless Chrome, OfflineAudioContext, S4 bell synth + I2 backing synth unchanged; loudness-matched (−20 dBFS RMS) mono Ogg; shuffled letters | [`previews/`](../../spikes/s6-ai-arranging/previews/README.md), [`results/previews.md`](../../spikes/s6-ai-arranging/results/previews.md) |

## qwen3:8b experiments

Settings: `qwen3:8b` with thinking off, `max_tokens` 1000–1500. For each song: one run at
T = 0, then 4–5 runs at T = 0.7–0.8 with different seeds. Each output gets up to 2 repair turns.
Outputs are picked by a reference-free objective; references and listening are used only to
report. All numbers below come from the local stand-in.

### a. Chord symbols for the 3 Mutopia carols ([`results/chords-local.md`](../../spikes/s6-ai-arranging/results/chords-local.md))

The model saw only the melody (as `beat:note` per bar plus ABC). Good King Wenceslas and It Came
Upon the Midnight Clear have SATB sources, so S5's chords inferred from all four voices act as a
reference. The Holly and the Ivy is melody-only. Proofreading started from S5's melody-only
inference (the fair input for a melody-only source).

| Song | S5 melody-only inference: fit all / strong; ref root | qwen3 inference (best of 5): fit; ref root | qwen3 proofread (best of 3): fit; ref root |
|---|---|---|---|
| The Holly and the Ivy | 0.83 / 0.93; – | 1 of 5 valid: 0.50 / 0.80; – | 0.83 / 0.93, **unchanged** (3 of 3 identical to its input) |
| Good King Wenceslas | 0.97 / 1.00; 0.44 | 0.66 / 0.65; 0.38 | 0.94 / 0.98; 0.35–0.41 |
| It Came Upon the Midnight Clear | 0.85 / 1.00; 0.41 | 0.53 / 0.67; 0.38 (5 of 5 identical) | 0.85 / 1.00; 0.41–0.44 |

- **Validity:** 20/24 valid after repairs, 17/24 on the first try. Every failure has the same
  cause: one chord per melody note, which doesn't divide the bar ("4 chords in a 3-beat bar"),
  even after the prompt says so explicitly (prompt v2) and after two repair turns. 3/4 Holly
  failed 4 of 5 times.
- **Quality:** inference is clearly worse than S5's template matcher and changes chords 2–3
  times per bar. Proofreading is close to a no-op: Holly came back unchanged, the others had small,
  mixed edits that lowered reference agreement for Wenceslas. Temperature hardly mattered (some
  runs were identical across seeds).
- **The Holly and the Ivy stays the weakest song.** No qwen3 output improved it. Melody-only
  inference is weak in general: even S5's agrees with the SATB chords only ~42 % of the time.
  The real fix is a source with harmony (CPDL/Mutopia SATB, or a human-written lead sheet).

### b. Descant and intro/ending for 2 carols ([`results/descant-local.md`](../../spikes/s6-ai-arranging/results/descant-local.md))

Deck the Halls (4/4, lead-sheet chords) and The Holly and the Ivy (3/4, pickup, S5 chords).
Descant prompts: v1 (rules), then v2 (adds "a descant is its own melody", ≥ 5 pitches, a bar
length in eighths and a 2-bar format example). The validator requires bar-by-bar length match,
range, ≤ 10 % non-diatonic notes, ≥ 4 pitches and ≤ 2 identical bars in a row.

| Task | Valid after repairs | First try | Typical failure |
|---|---|---|---|
| Descant v1 (Deck / Holly) | 0/6 · 1/6 | 0 · 1 | Range (E6 in a B4–C6 window), wrong bar lengths, 1-pitch "descants" |
| Descant v2 (Deck / Holly) | 2/6 · 0/6 | 2 · 0 | Bars 2× too long, runaway output (31–215 bars, up to 78 s) |
| Intro + ending (Deck / Holly) | 4/5 · 0/5 | 0 · 0 | Deck: ending on V (fixed by a repair turn). Holly: 4/4 bars in a 3/4 song |

What the "valid" ones are:

- **Deck descant (v2):** `e4 d4 | c6 B2 |` × 8, the prompt's format example looped (bar
  variety 0.13, objective 0.02). Below the 0.3 gate, so it was not kept.
- **Holly descant (v1):** the tune shifted up a third or fourth (similar motion 0.6, 12 parallel
  fifths/octaves, chord fit 0.67 / 0.73), with 4 playability violations once bass/inner are
  added. It passes the gate (objective 0.38) and is kept as the "LLM" candidate for listening.
- **Deck intro/ending:** the intro is bars 1–4 of the tune verbatim (a fair, conventional
  intro); the ending is bar 9 + bar 2, ending on F after the repair.
- **Rule-based baseline** ([`rule-descant.ts`](../../spikes/s6-ai-arranging/src/rule-descant.ts)):
  chord-tone fit 1.0, 0 parallels, 0 violations, objective 0.40 (Deck) and 0.74 (Holly). It is
  better than every model output, but it's plain (one held note per strong beat).

### c. Measurements

| Metric | Chords (24 outputs) | Descant + intro/ending (34 outputs) |
|---|---|---|
| Valid after ≤ 2 repairs | 20 (83 %) | 7 (21 %) |
| Valid on first try | 17 (71 %) | 3 (9 %) |
| Calls (incl. repairs) | 36 | 92 |
| Latency per call, local stand-in | median 7.1 s, p90 11.1 s | median 5.1 s, p90 9.5 s, max 78.5 s |
| Generation speed, local stand-in | median 25 tokens/s, median 152 completion tokens | |
| Consonance (chord-tone fit, all / strong) | see table a | LLM descants 0.50–0.67 / 0.57–0.73 vs rule-based 1.0 / 1.0 |

On the node (~120 tokens/s warm per the infra baseline), a typical 150–300-token call would take
about 1.5–3 s, plus a ~40 s cold load after 10 idle minutes. Retries: none were needed against
the stand-in. The node's 503 + Retry-After behaviour is covered by tests only.

### Candidates kept (never replacing originals)

| Candidate | AI parts | Chart (hard, 4 ringers): strikes; violations; dropped |
|---|---|---|
| [`deck-the-halls-s6`](../../spikes/s6-ai-arranging/candidates/deck-the-halls-s6.abc) | 4-bar intro + 2-bar ending | 189 → 257; 12 → 14; 4 |
| [`the-holly-and-the-ivy-s6`](../../spikes/s6-ai-arranging/candidates/the-holly-and-the-ivy-s6.abc) | Descant (voice 2); chords = S5's, unchanged by qwen3 | 59 → 142; 0 → 4; 23 |

Chord-only candidates for the SATB carols were not kept. They scored below the SATB reference,
and a lead sheet would drop those songs' real inner voices.

### d. Live rerun on the node (2026-10-27)

Same scripts, prompts, seeds and validators, against the real node:
`node scripts/smoke.ts; node scripts/exp-chords.ts; node scripts/exp-descant.ts` from
`spikes/s6-ai-arranging` (results tagged `-node`:
[`chords-node.md`](../../spikes/s6-ai-arranging/results/chords-node.md),
[`descant-node.md`](../../spikes/s6-ai-arranging/results/descant-node.md), full prompt/reply
logs in [`results/runs/`](../../spikes/s6-ai-arranging/results/runs/)). The candidates in
`candidates/` were **not** rebuilt from these runs; they stay the local-run candidates, all
`review: pending`.

| Metric | Chords, local → node | Descant + intro/ending, local → node |
|---|---|---|
| Valid after ≤ 2 repairs | 20/24 → 20/24 | 7/34 → 10/34 |
| Valid on first try | 17/24 → 14/24 | 3/34 → 3/34 |
| Calls (incl. repairs) | 36 → 41 | 92 → 88 |
| Latency per call | median 7.1 → **1.6 s**, p90 11.1 → **2.4 s**, max → 3.3 s | median 5.1 → **1.0 s**, p90 9.5 → **2.4 s**, max 78.5 → **13.7 s** |
| Generation speed | 25 → **113 tokens/s** (median 183 completion tokens) | → **110 tokens/s** (median 105 completion tokens) |
| Retries (503/429/5xx) | none | none; 1 call failed with Ollama's `500 prediction aborted, token repeat limit reached` (a runaway descant) |

The first chat of the session took 3.8 s with `qwen3:8b` already resident (`/node/status`
`ollama_resident`); no ~40 s cold load was seen.

Quality against the procedural/rule-based arrangement (same metrics as a–b):

- **Chords:** S5's melody-only inference still wins on every song. qwen3 inference, best of 5:
  Holly 1/5 valid, fit 0.52 / 0.93 (S5: 0.83 / 0.93); Wenceslas 0.78 / 0.79, ref root 0.44
  (S5: 0.97 / 1.00, 0.44); Midnight Clear 0.53 / 0.67, ref root 0.38, 5/5 seeds identical and
  not ending on I (S5: 0.85 / 1.00, 0.41). **Proofreading returned S5's input unchanged in 9/9
  runs**, so it adds nothing.
- **Descants:** Holly 0/12 valid (wrong bar counts and lengths, one 219-bar runaway). Deck 5/12
  valid, but 4 of them are a **C-major scale in half notes** (`c4 c4 | d4 d4 | …`, three seeds
  byte-identical) and one is a 4-bar stepwise loop. The best by objective (0.56, v2 seed 31) beats
  the rule-based baseline's 0.43 only because the objective rewards pitch and bar variety. Its
  chord fit is 0.56 against 1.0, and 22 % of onsets clash with the tune against 13 %. Not musically
  usable.
- **Intros/endings:** Deck 2/5 and Holly 3/5 valid (Holly was 0/5 locally; in 3/4 the model
  still writes 4/4 bars first and needs a repair turn). The best Holly intro is one chord tone
  repeated per bar (`F2 F2 F2 | d2 d2 d2 | A2 A2 A2 | c2 c2 c2`), which ends on V. It's valid but
  trivial, and a rule could write it.
- **Verdict unchanged:** a fast LLM doesn't fix the musical failures. Rule-based intros/endings,
  a better rule-based descant and SATB sources remain the path (ADR-0011).

## Anticipatory Music Transformer

### License check (ADR-0008): compatible

| Item | License / terms | Evidence |
|---|---|---|
| Code `jthickstun/anticipation` @ `af37397` | Apache-2.0 | GitHub license API + README ("licensed under the terms of the Apache License, Version 2.0") |
| Weights `stanford-crfm/music-{small,medium}-800k` | Apache-2.0, no NC/ND or use restrictions on the card | HF model metadata `license: apache-2.0` (checked 2026-10-24); revisions pinned: small `fa800530…`, medium `93b6eb7e…`; `pytorch_model.bin` SHA-256 small `45af5006…87e4d8`, medium `7af65dbab…241ad` |
| Training data | Lakh MIDI Dataset (CC BY 4.0 as a dataset; the MIDI files themselves have mixed provenance, many are of copyrighted songs) | Model card |
| Container contents | torch 2.6.0 (BSD-3; the cu124 wheels bundle NVIDIA CUDA runtime libraries under NVIDIA's redistribution terms), transformers 4.51.3 (Apache-2.0), mido (MIT), numpy (BSD-3), tqdm (MPL-2.0 AND MIT) | `amt/requirements.txt`, manifest |

Notes for the owner: (1) Outputs are treated as AI assets (CC0, provenance, resemblance review).
The Lakh training data makes the review real: a model can reproduce fragments of training songs.
(2) Keep the GHCR package **private** unless you decide otherwise: the GPU image redistributes
NVIDIA libraries, which is allowed but adds a third-party notice for a public image. Nothing
from the image is vendored into this MIT repo.

### Runs

| Run | Result |
|---|---|
| Local CPU (venv), small model, The Holly and the Ivy (23 s) | 118 notes, 15 instruments, load 82 s, **generate 824 s** |
| Local CPU (venv), small model, Deck the Halls (32 s) | 163 notes, 14 instruments, generate 593 s |
| **Container smoke** (`go-go-harmoniyo-amt:cpu-small`, the node's sandbox flags: `--network none --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges`, non-root, 4 CPUs) | OK: 85 notes for an 8 s excerpt, 1071 s on 4 threads. The first attempt oversubscribed torch threads under the CPU quota (stopped after 75 min); fixed by sizing threads from cgroup `cpu.max` |
| Node GPU (medium) | **Not run yet.** The first published image (`sha256:a3df2566…f097`) could crash with `AssertionError` in `events_to_compound`: anticipation's sampler can emit the REST token in a duration slot, which decodes to a duration ≥ `MAX_DUR`. Fixed in [#73](https://github.com/dcuccia/go-go-harmoniyo/pull/73) by clamping to `MAX_DUR - 1` (count in `report.json` `clamped_durations`), and rebuilt as `sha256:93e86a83…ec21` ([#74](https://github.com/dcuccia/go-go-harmoniyo/pull/74)). Waiting for cuccia-infra to register that digest |

Output quality (small model, CPU, seed 1; [`results/amt/analysis.md`](../../spikes/s6-ai-arranging/results/amt/analysis.md)):
chord fit 0.30 (Deck) and 0.40 (Holly); 33–38 % of onsets clash with the tune; 14–15 GM
instruments; pitches down to MIDI 0 (Deck) and 16 (Holly). That's an orchestral scatter, not a
handbell-friendly accompaniment. The generator has no KV cache (each token re-runs the full
1024-token context), which is why CPU is so slow. On the 3080 Ti, fp16, I estimate **5–30 s per
carol plus ~10–20 s load and ~1.3 s container start**, VRAM ≈ 1.5–3 GiB (measured into
`report.json` `max_vram_mib` on first run). These are estimates until measured.

Container: CPU image 2.58 GB. The GPU image will be larger (CUDA wheels). The manifest asks for
`gpu: exclusive`, `memory: 8g`, `cpus: 4`, `timeout_s: 900`, no caches, no network.

## Procedural vs LLM vs AMT: blind-listening set

[`previews/`](../../spikes/s6-ai-arranging/previews/README.md): Deck the Halls and The Holly and
the Ivy, three clips each (A/B/C, shuffled per song), 27–49 s, mono 22.05 kHz Ogg, loudness-matched.

- **Procedural:** the S5 chart (hard, 4 ringers) with the I2 procedural backing from the S5 chords.
- **LLM:** the S6 candidate chart (hard, 4 ringers) with the same backing from its chords.
- **AMT:** S5 melody bells (easy) plus the AMT accompaniment, played through the I2 bass/pad voices.

Confound to keep in mind: the Holly "LLM" clip also gains S5-realized bass/inner bells, because
the candidate is a lead sheet, while the original Holly chart is melody-only. Much of any
improvement there comes from S5's realizer and not from the model. The key is in
`previews/answer-key.json` (for new listeners: don't open it first).

### Owner listening result (2026-10-25)

The owner listened blind. His verdict (verbatim): "for the blind listening the only one that
sounded decent is deck the halls version B. none of the holly and the ivy ones sounded like a
realistic arrangement."

| Song | Clip rated "decent" | What it was (from the key) | Not rated decent |
|---|---|---|---|
| Deck the Halls | **B** | **LLM**: the qwen3:8b candidate. Its only AI parts are a 4-bar intro and a 2-bar ending; the rest is S5's procedural chart (bass/inner realized from S5's chords) plus the I2 procedural backing | A (AMT), C (procedural) |
| The Holly and the Ivy | none | — | A (LLM descant), B (AMT), C (procedural) |

What it means:

- **Song form, not AI harmony, made the difference.** B and C are the same procedural
  arrangement; B adds a short intro and ending. So the value is in the form (a lead-in and a
  proper close), which a rule or a human can write too. It is not evidence that qwen3:8b
  harmonizes well.
- **AMT (small model, CPU) was not preferred for either song**, consistent with its chord fit of
  0.30–0.40. The medium-model GPU run is still open (ADR-0011 point 4).
- **The Holly and the Ivy failed in every version** because its source is melody-only and its
  chords are inferred. Neither the LLM descant, the AMT accompaniment nor S5's realizer turns
  that into a realistic arrangement. The fix is a real four-part (SATB) source, and an SATB redo
  of the carol corpus is in progress (see [#57](https://github.com/dcuccia/go-go-harmoniyo/pull/57)).
- Next cheap steps: rule-based intros and endings in S5/I2 for every song, and SATB sources
  before any generative harmony.

All AI candidates stay `review: pending`. A listening preference is not the ADR-0008
resemblance review; the owner has not done that review (see owner actions).

## Licensing and provenance

- Every new asset is in [`attribution/register.json`](../../attribution/register.json) with full
  AI provenance (tool, model + revision + hash, terms URL and date, prompt-log paths),
  `review: pending` and the new `candidate: true` + `credit: false` flags. `REUSE.toml` was
  updated and `ATTRIBUTION.md` regenerated.
- **Policy change (accepted 2026-10-25):** ADR-0008 requires a resemblance review before merge.
  The brief asks for `review: pending`. [ADR-0011](../decisions/0011-ai-assisted-arranging.md)
  adds a narrow `candidate` state: complete provenance is required, the review may be pending, the
  asset is not credited and can't be promoted until reviewed. `attribution.mjs` enforces this.
- Models: qwen3:8b / Qwen3-8B and AMT are Apache-2.0, with no NC/ND terms. The local stand-in
  tooling (llama-cpp-python MIT; NVIDIA CUDA runtime pip wheels) was dev-only and lived outside
  the repo.
- Prompts describe music ("a descant is its own melody…"). They name no artists or editions. The
  descant prompt v2's 2-bar format example is our own (`e4 d4 | c6 B2`), and the Deck "descant"
  that copied it is not kept.

## Infra follow-ups and owner actions

1. ~~**Set the node env** and rerun on the node~~ Done 2026-10-27 (see
   [d](#d-live-rerun-on-the-node-2026-10-27); closed
   [#47](https://github.com/dcuccia/go-go-harmoniyo/issues/47)). The published CA value
   (`78F6AA75…3357CC`) is the certificate's SHA-256 fingerprint, not a hash of the PEM file;
   the client now accepts either.
2. ~~**Publish the AMT image**~~ Done by the `s6-amt-image` workflow. The current digest is
   `sha256:93e86a83…ec21` (with the duration clamp, [#74](https://github.com/dcuccia/go-go-harmoniyo/pull/74)).
   Still to do: **cuccia-infra registers that digest** (not self-service, per the consumer guide).
3. Then run AMT for three carols over three seeds (separate output dirs via `--out`):
   `node scripts/amt-run.ts --node --songs deck-the-halls,the-holly-and-the-ivy,good-king-wenceslas --seed N --out amt-node/seed-N`
   for N = 1, 2, 3. Then run `node scripts/amt-analyze.ts`, optionally
   `node scripts/render-previews.ts --ogg-python …`, and listen again.
4. ~~**Listen to the blind set**~~ Done 2026-10-25 (see
   [Owner listening result](#owner-listening-result-2026-10-25)).
5. ~~Decide on ADR-0011~~ Accepted 2026-10-25.
6. **Resemblance review (ADR-0008), not done.** Before any S6 candidate is promoted (used in a
   build, or its `candidate` flag removed), listen to it and check it doesn't resemble a
   specific copyrighted arrangement, then record reviewer and date in
   `attribution/register.json`. Until then every S6 candidate stays `review: pending`.
7. Infra wishes (draft; no issue filed in cuccia-infra): a documented way to get `/node/status`
   `wake` details once without a token, so a fresh client can wake a sleeping node; a
   `max_vram_mib` field in job status; and a note in the guide that GPU jobs should size threads
   from cgroup quotas. Seen 2026-10-27: `/node/status` advertises Wake-on-LAN MAC
   `08-BF-B8-29-4D-46`, but the node answers ARP for 192.168.70.11 from `A0-36-9F-A2-89-B6`
   (another NIC). If the WoL MAC belongs to an adapter that isn't armed for wake, that would
   explain why wake from sleep failed. The node also drops ICMP echo, so ping fails while HTTPS
   works.

## Open questions (for E04/E05)

- Would a larger instruction model (or a music-specific one) do better on descants? qwen3:8b's
  failures (bar arithmetic, copying the example) look like model limits, not prompt wording.
- Is AMT-medium on GPU, restricted to 1–3 instruments (`keep_programs`) and fed a few seconds of
  history, good enough for an optional "AI backing" toggle? It's the only generative option left.
- A better rule-based descant (passing tones, contrary motion, phrase shapes) is probably the
  cheapest real improvement, together with SATB sources for harmony.
