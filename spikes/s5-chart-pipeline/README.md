# S5 — Carol chart pipeline (spike code)

Throwaway spike code for [S5](../../docs/spikes/README.md#s5--carol-chart-pipeline). Report:
[docs/spikes/S5-report.md](../../docs/spikes/S5-report.md).

Zero-dependency Node.js (ESM). Tested with Node 22.18 on Windows; uses only `node:fs`,
`node:path`, `node:test`, so any Node ≥ 20 on Windows/macOS/Linux/ChromeOS (Crostini) should
work. The modules other than `build.mjs`/`pipeline.mjs` avoid Node APIs except `Buffer` in the
MIDI writer, so they can be bundled for a browser later.

```sh
node build.mjs            # regenerate charts/, exports/, results/
node --test               # 11 tests: importers, assignment, schema, determinism, export
node build.mjs --ringers 3,4,5 --export-ringers 5
```

## Layout

| Path | What |
|---|---|
| `songs/*.abc` | 5 self-encoded public-domain carol lead sheets (melody + chord symbols), CC0-1.0 |
| `songs/manifest.json` | Per-file source + license register; import options (melody voice, pickup, tempo) |
| `sources/mutopia/` | 3 Mutopia Project files (`.mid` input + `.ly` provenance), public domain |
| `src/abc.mjs`, `src/midi.mjs`, `src/musicxml.mjs` | Importers → common score model (`src/score.mjs`) |
| `src/arrange.mjs` | Melody/bass/inner role detection, lead-sheet realization, difficulty tiers |
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
