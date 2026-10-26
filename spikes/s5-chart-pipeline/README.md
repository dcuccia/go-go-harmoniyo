# S5 — Carol chart pipeline (spike code)

Throwaway spike code for [S5](../../docs/spikes/README.md#s5--carol-chart-pipeline). Report:
[docs/spikes/S5-report.md](../../docs/spikes/S5-report.md).

Zero-dependency Node.js (ESM). Tested with Node 22.18 on Windows; uses only `node:fs`,
`node:path`, `node:test`, so any Node ≥ 20 on Windows/macOS/Linux/ChromeOS (Crostini) should
work. The modules other than `build.mjs`/`pipeline.mjs` avoid Node APIs except `Buffer` in the
MIDI writer, so they can be bundled for a browser later.

```sh
node build.mjs            # regenerate charts/, exports/, results/ (~30–90 s: the metrics build every arrangement)
node --test               # 26 tests: importers, assignment, schema, determinism, export, harmony, form, fairness
node build.mjs --ringers 3,4,5 --arrangements balanced,chord-split,by-range --export-ringers 5 --form short
```

## Song form, balanced parts and super easy (chart format 0.3)

Owner feedback from a 4-player session: parts were unbalanced (one player one bass bell, another
four bells), songs too short to get one's bearings, and even Easy too steep for first-timers.
Format 0.3 (all additions optional; 0.1/0.2 charts stay valid):

- **Song form** (`src/form.mjs`, chart `form.sections[]`). `full` (default): intro (the last
  phrase, accompaniment only) · verse × N · interlude + key change up a step before the last verse
  (when there are 3+ verses) · coda (tag of the last phrase, a held final bar, gentle
  ritardando). N is chosen so the piece lands near 150 s (all 16 songs: 2:10–2:52). Verses
  develop: v1 light bass/harmony, v2 fuller, then a descant verse and a quiet verse alternate,
  the last verse is the finale. `short`: the song once. Deterministic, rule-based, no AI content;
  options (`targetSec`, `keyChange`, `descant`, `intro`, `coda`, …) in `FORM_DEFAULTS`.
  Each beat in `harmony.beats` carries its `section`, each section an `energy` the backing uses.
- **Role-aware parts** (`src/parts.mjs`, part `arrangement`, ringer `role` + `name`). Each role
  has its own pitch window, fixed for the piece and starting on a natural (bass and harmony one
  octave each below the tune, descant above it), so a ringer's bells are one role and one
  contiguous region and accidentals travel with their natural.
  - `balanced` (default): Bass (roots/fifths, or the score's own bass line), Harmony (one
    voice-led inner line per hand, or the score's alto/tenor folded into the window), Melody split
    by range, optional Descant ringer. Accompaniment density (chord changes → strong beats → every
    beat) is chosen within each tier's range to even out the ringers' load, penalising bells
    beyond the controller's capacity. SATB sources keep their real bass and inner voices.
  - `chord-split`: up to three ringers share each chord, one tone each (1-3-5, voice-led, in a
    wider window since there is no bass ringer); as many as leave enough tune ringers for the
    tune's bells; the backing plays the bass.
  - `by-range`: the 0.2 algorithm (bells cut into ranges by load, roles ignored), for comparison.
- **Tiers**: `super-easy` (new; the tune's downbeats and long notes ≥ 1 s apart, ≤ 3 bells per
  ringer, optional bass on chord changes; the host plays the rest of the tune softly from the
  part's `guide`), `easy`, `medium`, `hard`. A descant nobody holds is also a `guide`.
- **Fairness** (`results/metrics.md`): Jain's index on each ringer's load (strikes + ½ bell
  changes), strikes and bells min–max, mixed-role and one-bell ringers, before (0.2, by-range,
  short) vs after (balanced, full) for the `handbell` and `phone-4zone` profiles.
- **Practice speed**: every time is a `time` or `…Sec` field derived from the tempo map, so a
  reader can stretch the chart (the I2 game scales it for 50–100 % speed).

Committed `charts/` carry the balanced arrangement for 4 ringers (every tier; the S1 YARG bridge
defaults to 4 — rebuild with `--ringers 3,4,5` for other counts); the I2 game builds its own charts
with every arrangement, 1–4 ringers and both lengths.

## Harmony block (chart format 0.2)

Each chart carries an optional `harmony` object for game-side backing tracks (used by the I2
web game, `spikes/i2-web-phones/src/backing/`):

- `chords[]`: `{ tick, time, dur, durSec, symbol, root, bass, tones }` (pitch classes, 0 = C).
  `source` is `lead-sheet` when the file has chord symbols (the 5 ABC songs) and `inferred`
  otherwise (the 11 Mutopia MIDI files: template matching per strong-beat segment with bass,
  diatonic and tonic bonuses, `src/harmony.mjs`). Inferred chords are plausible, not
  proofread; the melody-only Holly and the Ivy is the weakest.
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
| `songs/*.abc` | 5 self-encoded public-domain carol lead sheets (melody + chord symbols), CC0-1.0 |
| `songs/manifest.json` | Per-file source + license register; import options (melody/bass voice, pickup, tempo, `timeSig` meter override, backing style). The I2 game's song list is generated from it |
| `sources/mutopia/` | 11 Mutopia Project files (`.mid` input + `.ly` provenance), public domain; 9 are SATB hymn settings. A test checks each SATB melody against the `.ly` soprano line |
| `src/abc.mjs`, `src/midi.mjs`, `src/musicxml.mjs` | Importers → common score model (`src/score.mjs`) |
| `src/arrange.mjs` | Melody/bass/inner role detection (one pass of the song) |
| `src/form.mjs` | Song form: intro, developing verses, interlude + key change, coda; rule-based descant; role pitch windows |
| `src/parts.mjs` | Tiers, arrangements (balanced / chord split / by range), accompaniment realization, load balancing, fairness |
| `src/harmony.mjs` | Chord timeline + beat grid + backing style for the chart's `harmony` block; chord inference |
| `src/assign.mjs` | Bell→ringer assignment (DP over contiguous natural slots) + playability repair; controller profiles |
| `src/chart.mjs` | Engine-neutral chart JSON builder, handbell-set fit |
| `src/export.mjs` | Clone Hero/YARG `notes.mid` + `song.ini`, General MIDI audition files, ASCII previews |
| `schema/chart.schema.json` | JSON Schema (2020-12) for the proposed chart format |
| `charts/*.json` | Generated charts (format 0.3, full form): 4 tiers × 4 ringers, balanced arrangement, per song (profile `handbell`) |
| `exports/<song>/` | Generated `notes.mid` + `song.ini` (4 ringers, balanced; CH Easy/Medium/Hard/Expert = super easy/easy/medium/hard) and `audition-<tier>-r4.mid` |
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
