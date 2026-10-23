# S4 — Web-native host prototype (throwaway spike code)

TypeScript + Vite + Three.js note highway for Handbell Hero. Report:
[docs/spikes/S4-report.md](../../docs/spikes/S4-report.md).

## Run

```powershell
cd spikes/s4-web-host
npm install
npm run dev        # generates public/songs/jingle-bells.mid, serves http://localhost:5173 (also on LAN)
```

Open the page, click **Play (keyboard)**. Bells are `A S D F J` (or `1`–`5`). `Esc` menu,
`` ` `` stats overlay, `←/→` nudge A/V offset (Shift = ×4). **Calibrate** taps along to 16 clicks
and stores your input offset in `localStorage`. Drop any `.mid` file on the page to chart it
(first non-"backing" track → up to 8 lanes; everything else auto-plays).

Other scripts:

| Command | What |
|---|---|
| `npm test` | Vitest: MIDI parser, chart builder, judge |
| `npm run build` | Type-check + static build to `dist/` (relative base, works on any sub-path) |
| `npm run preview` | Serve `dist/` |
| `node scripts/bench.mjs [url] [--gpu=high] [--only=name]` | Headed Chrome autoplay/keyboard benchmark matrix → `bench-results/*.json` + screenshots |
| `node scripts/capture-gif.mjs [url] --seconds=8 --start=13 --width=560 --fps=12` | CDP screencast → `docs/spikes/media/s4-autoplay.gif` (settings used for the report) |

## URL parameters

| Param | Default | Meaning |
|---|---|---|
| `mode=play\|autoplay\|calibrate` + `auto=1` | — | Start immediately (needs `--autoplay-policy=no-user-gesture-required` or a prior click) |
| `w`, `h` | window | Force drawing-buffer size, e.g. `w=3840&h=2160` |
| `dpr` | 2 | Max device-pixel ratio |
| `bloom`, `particles` | 1 | `0` disables |
| `msaa` | 4 | MSAA samples on the HDR render target |
| `stats` | 0 | Show the measurement overlay |
| `vis`, `inp` | saved | A/V and input offsets in ms |
| `song`, `title`, `lanes` | built-in | Load another MIDI URL / title / max lanes |
| `bench` | — | Expose `window.__s4Result` and set title `BENCH_DONE` at the end |

## Layout

```
src/core/     engine-agnostic TS (no DOM): midi.ts, chart.ts, judge.ts, stats.ts   ← shared-core candidate
src/input/    GestureEvent/InputSource (HGP-shaped), keyboard.ts, hgp.ts (stub + min-RTT clock mapper)
src/audio/    bell.ts (additive handbell synth), clock.ts (AudioContext ↔ performance.now), engine.ts
src/render/   highway.ts (Three.js scene, shader highway, instanced bells, bloom), fx.ts (particles, snow)
src/game/     session.ts (scheduling, judging, autoplay, metrics)
src/ui/       hud.ts (DOM HUD)
scripts/      make-song.mjs, bench.mjs, capture-gif.mjs
```

## Assets and licenses

| Item | Source | License |
|---|---|---|
| "Jingle Bells" chorus melody | J. L. Pierpont, 1857 — public domain | PD |
| `public/songs/jingle-bells.mid` (notes, rhythm, accompaniment) | Self-encoded in `scripts/make-song.mjs` | MIT (repo) |
| Bell sound, reverb IR | Synthesized at runtime (`src/audio/bell.ts`) | MIT (repo) |
| Visuals (highway shader, bell mesh, glow texture, particles) | Procedural, self-made | MIT (repo) |
| Fonts | System UI fonts only (none bundled) | — |
| three (+ examples/jsm postprocessing, RoomEnvironment) | npm `three@0.170` | MIT |
| Dev only: vite, vitest, typescript, playwright-core, gifenc, jpeg-js | npm | MIT / MIT / Apache-2.0 / Apache-2.0 / MIT / BSD-3-Clause |
