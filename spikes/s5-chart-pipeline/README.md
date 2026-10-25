# S5 — Carol chart pipeline (spike code)

Throwaway spike code for [S5](../../docs/spikes/README.md#s5--carol-chart-pipeline). Report:
[docs/spikes/S5-report.md](../../docs/spikes/S5-report.md).

Zero-dependency Node.js (ESM). Tested with Node 22.18 on Windows; uses only `node:fs`,
`node:path`, `node:test`, so any Node ≥ 20 on Windows/macOS/Linux/ChromeOS (Crostini) should
work. The modules other than `build.mjs`/`pipeline.mjs` avoid Node APIs except `Buffer` in the
MIDI writer, so they can be bundled for a browser later.

```sh
node build.mjs            # regenerate charts/, exports/, results/
node --test               # 21 tests: importers, assignment, schema, determinism, export, harmony
node build.mjs --ringers 3,4,5 --export-ringers 5
```

## Harmony block (chart format 0.2)

Each chart carries an optional `harmony` object for game-side backing tracks (used by the I2
web game, `spikes/i2-web-phones/src/backing/`):

- `chords[]`: `{ tick, time, dur, durSec, symbol, root, bass, tones }` (pitch classes, 0 = C).
  `source` is `lead-sheet` when the file has chord symbols (the 14 ABC songs, including the multi-voice
  ones, whose first voice carries the symbols) and `inferred` otherwise (the 10 Mutopia MIDI files: template matching per strong-beat segment with bass,
  diatonic and tonic bonuses, `src/harmony.mjs`). Inferred chords are plausible, not
  proofread.
- `beats[]`: `{ tick, time, bar, beat, div, strong, chord }` — every beat with times from the
  tempo map (compound meters count dotted quarters, `div` 3), and the chord sounding on it.
- `style`: backing preset (`sleigh-ride`, `march`, `waltz`, `gentle`) from the manifest's
  `options.backingStyle` (or an ABC `%%hh-backing-style` line), else a default from meter and
  tempo.

Readers that don't know `harmony` ignore it (unknown properties are ignored); charts without
it still validate.

## Layout

| Path | What |
|---|---|
| `songs/*.abc` | 14 self-encoded public-domain carols, CC0-1.0: 12 lead sheets (melody + chord symbols), The Holly and the Ivy as SATB (4 `V:` voices, our own harmony) and our own 3-voice arrangement of Carol of the Bells (Shchedryk). Multi-voice files set `melodyVoice`/`bassVoice` (the `V:` ids) in the manifest. The 9 added 2026-10-25 are AI-generated and await the owner's resemblance review (`attribution/register.json`) |
| `songs/manifest.json` | Per-file source + license register; import options (melody/bass voice, pickup, tempo, `timeSig` meter override, backing style). The I2 game's song list is generated from it |
| `sources/mutopia/` | 11 Mutopia Project files (`.mid` + `.ly`), public domain; 9 SATB hymn settings and 1 more used as chart input, plus the melody-only Holly and the Ivy kept as the reference for our SATB version (a test compares them). A test checks each SATB melody against the `.ly` soprano line |
| `src/abc.mjs`, `src/midi.mjs`, `src/musicxml.mjs` | Importers → common score model (`src/score.mjs`) |
| `src/arrange.mjs` | Melody/bass/inner role detection, lead-sheet realization, difficulty tiers |
| `src/harmony.mjs` | Chord timeline + beat grid + backing style for the chart's `harmony` block; chord inference |
| `src/assign.mjs` | Bell→ringer assignment (DP over contiguous natural slots) + playability repair; controller profiles |
| `src/chart.mjs` | Engine-neutral chart JSON builder, handbell-set fit |
| `src/export.mjs` | Clone Hero/YARG `notes.mid` + `song.ini`, General MIDI audition files, ASCII previews |
| `schema/chart.schema.json` | JSON Schema (2020-12) for the proposed chart format |
| `charts/*.json` | Generated charts: 3 tiers × 3/4/5 ringers per song (profile `handbell`) |
| `exports/<song>/` | Generated `notes.mid` + `song.ini` (4 ringers) and `audition-<tier>-r4.mid` |
| `results/metrics.md`, `results/previews.md` | Generated measurements and lane previews |
| `test/` | `node:test` suite + hand-written MusicXML fixture |

## Licenses

Code: MIT (repo license). `songs/*.abc`, `test/fixtures/*`: CC0-1.0 (melodies public domain;
encodings written for this repo). `sources/mutopia/*`: public domain (Mutopia "Public Domain"
license, see `songs/manifest.json` for per-file attribution). Generated charts/exports inherit
their source file's license, recorded in each chart's `song.license`.

## Known limits

- ABC subset: no repeats/endings expansion, no broken rhythm (`>`), no inline fields.
- MusicXML subset: uncompressed partwise only (`.mxl` needs unzip), no repeat expansion.
- MIDI: pickups and melody track must be declared in the manifest when the file lacks them.
- Thresholds in `PROFILES` (swap/switch/repeat times) are assumptions; S1 and playtests should
  calibrate them.
- CH/YARG export has no audio stem; the games need one (`song.ogg`) to play the chart.
