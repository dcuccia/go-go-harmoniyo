# SPDX-License-Identifier: MIT
"""Regression tests for amt_accompany.py (no torch, no model, no GPU).

  python -m unittest discover -s spikes/s6-ai-arranging/amt

The clamp tests run with the standard library only. The end-to-end test also needs mido and
anticipation@af37397 (CI installs them; see .github/workflows/s6-ai-arranging.yml); it runs the
real main() with stubbed torch/transformers and a fake sampler that emits the REST token as a
duration, the failure seen on the AI node.
"""
import json
import os
import sys
import tempfile
import types
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import amt_accompany  # noqa: E402

# anticipation@af37397 vocabulary (config.py / vocab.py), so the clamp tests need no install.
MAX_TIME, MAX_DUR, MAX_NOTE = 10000, 1000, 129 * 128
DUR_OFFSET = MAX_TIME
NOTE_OFFSET = DUR_OFFSET + MAX_DUR
REST = NOTE_OFFSET + MAX_NOTE
CONTROL_OFFSET = NOTE_OFFSET + MAX_NOTE + 1
ADUR_OFFSET = CONTROL_OFFSET + MAX_TIME
ANOTE_OFFSET = ADUR_OFFSET + MAX_DUR
SEPARATOR = ANOTE_OFFSET + MAX_NOTE
VOCAB = types.SimpleNamespace(MAX_DUR=MAX_DUR, DUR_OFFSET=DUR_OFFSET, CONTROL_OFFSET=CONTROL_OFFSET,
                              ADUR_OFFSET=ADUR_OFFSET, SEPARATOR=SEPARATOR)


def note(time, dur, pitch, instr=0):
    return [time, DUR_OFFSET + dur, NOTE_OFFSET + 128 * instr + pitch]


try:
    import mido  # noqa: F401
    from anticipation import vocab as real_vocab
    HAVE_ANTICIPATION = True
except ImportError:
    HAVE_ANTICIPATION = False


class ClampDurations(unittest.TestCase):
    def test_clamps_rest_token_in_duration_slot_and_keeps_the_note(self):
        tokens = note(0, 50, 60) + [100, REST, NOTE_OFFSET + 64] + note(200, MAX_DUR - 1, 67)
        out, n = amt_accompany.clamp_durations(tokens, VOCAB)
        self.assertEqual(n, 1)
        self.assertEqual(len(out), len(tokens))
        self.assertEqual(out[4], DUR_OFFSET + MAX_DUR - 1)
        self.assertEqual(out[:4] + out[5:], tokens[:4] + tokens[5:])

    def test_clamps_control_durations_against_the_control_offset(self):
        tokens = [CONTROL_OFFSET + 10, ADUR_OFFSET + MAX_DUR + 5, ANOTE_OFFSET + 72,
                  CONTROL_OFFSET + 20, ADUR_OFFSET + 30, ANOTE_OFFSET + 74]
        out, n = amt_accompany.clamp_durations(tokens, VOCAB)
        self.assertEqual(n, 1)
        self.assertEqual(out[1], ADUR_OFFSET + MAX_DUR - 1)
        self.assertEqual(out[4], ADUR_OFFSET + 30)

    def test_valid_sequences_and_separators_are_unchanged(self):
        tokens = note(0, 0, 60) + note(10, MAX_DUR - 1, 62) + [SEPARATOR] * 3
        out, n = amt_accompany.clamp_durations(tokens, VOCAB)
        self.assertEqual((out, n), (tokens, 0))

    @unittest.skipUnless(HAVE_ANTICIPATION, "needs mido + anticipation@af37397")
    def test_vocabulary_matches_anticipation(self):
        for k in ("MAX_DUR", "DUR_OFFSET", "CONTROL_OFFSET", "ADUR_OFFSET", "SEPARATOR"):
            self.assertEqual(getattr(real_vocab, k), getattr(VOCAB, k), k)
        self.assertEqual(real_vocab.REST, REST)


@unittest.skipUnless(HAVE_ANTICIPATION, "needs mido + anticipation@af37397")
class MainWithOverlongDuration(unittest.TestCase):
    """main() used to die in events_to_compound's `assert max(durations) < MAX_DUR`."""

    def setUp(self):
        self.saved = {k: sys.modules.get(k) for k in ("torch", "transformers", "anticipation.sample")}

        class Model:
            def to(self, _device):
                return self

            def eval(self):
                return self

            def half(self):
                return self

        torch = types.ModuleType("torch")
        torch.__version__ = "stub"
        torch.cuda = types.SimpleNamespace(is_available=lambda: False)
        torch.manual_seed = lambda _seed: None
        torch.set_num_threads = lambda _n: None
        torch.get_num_threads = lambda: 1
        transformers = types.ModuleType("transformers")
        transformers.AutoModelForCausalLM = types.SimpleNamespace(from_pretrained=lambda *_a, **_k: Model())

        def generate(_model, _start, _end, inputs=None, controls=None, top_p=1.0):
            # Three accompaniment notes; the second has the REST token as its duration.
            return note(0, 50, 48) + [100, REST, NOTE_OFFSET + 52] + note(200, 80, 55)

        sample = types.ModuleType("anticipation.sample")
        sample.generate = generate
        sys.modules.update({"torch": torch, "transformers": transformers, "anticipation.sample": sample})

    def tearDown(self):
        for k, v in self.saved.items():
            if v is None:
                sys.modules.pop(k, None)
            else:
                sys.modules[k] = v

    def test_clamps_writes_midi_and_reports_the_count(self):
        import mido
        from anticipation.convert import events_to_midi

        with self.assertRaises(AssertionError):  # the unpatched failure
            events_to_midi(note(0, 50, 48) + [100, REST, NOTE_OFFSET + 52])

        with tempfile.TemporaryDirectory() as tmp:
            inputs, outputs = os.path.join(tmp, "in"), os.path.join(tmp, "out")
            os.makedirs(inputs)
            mid = mido.MidiFile(ticks_per_beat=480)
            track = mido.MidiTrack()
            mid.tracks.append(track)
            for pitch in (72, 74, 76):
                track.append(mido.Message("note_on", note=pitch, velocity=80, time=0))
                track.append(mido.Message("note_off", note=pitch, velocity=0, time=480))
            mid.save(os.path.join(inputs, "melody.mid"))
            env = {"AMT_INPUTS": inputs, "AMT_OUTPUTS": outputs, "AMT_MODEL_DIR": tmp}
            old = {k: os.environ.get(k) for k in env}
            os.environ.update(env)
            try:
                self.assertEqual(amt_accompany.main(), 0)
            finally:
                for k, v in old.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v

            with open(os.path.join(outputs, "report.json"), encoding="utf-8") as f:
                report = json.load(f)
            self.assertEqual(report["clamped_durations"], 1)
            self.assertEqual(report["accompaniment_events"], 3)

            def onsets(path):
                return sorted(m.note for m in mido.MidiFile(path) if m.type == "note_on" and m.velocity > 0)

            self.assertEqual(onsets(os.path.join(outputs, "accompaniment.mid")), [48, 52, 55])
            self.assertEqual(onsets(os.path.join(outputs, "combined.mid")), [48, 52, 55, 72, 74, 76])


if __name__ == "__main__":
    unittest.main()
