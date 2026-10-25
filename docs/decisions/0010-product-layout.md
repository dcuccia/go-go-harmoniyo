# 0010 — Product layout: how spike code graduates into product packages

- Status: Proposed
- Date: 2026-10-24
- Deciders: @dcuccia (owner); proposed by the v0.1-alpha planning session (agent)
- Plan: [v0.1-alpha plan](../plan/v0.1-alpha.md). Owner decision issue:
  [#32](https://github.com/dcuccia/go-go-harmoniyo/issues/32). Migration issue:
  [#41](https://github.com/dcuccia/go-go-harmoniyo/issues/41).

## Context

[ADR-0004](0004-host-strategy.md) and [ADR-0005](0005-shared-core-language.md) chose a web host
on an engine we own and a TypeScript core. They left the location of product code to a
follow-up ADR. This is that ADR.

The playable game is spread over five spike folders. Each has its own `package.json` and
lockfile, and they import each other by relative path:

| Spike folder | What the product uses from it |
|---|---|
| `spikes/s1-phone-bell` | `src/core` (HGP types, `ClockSync`, ring and impact detectors); `src/host/server.ts` (Node HGP relay, HTTPS/WSS with a self-signed certificate, QR, `--tunnel`, `--game`, the I1 `--yarg` sidecar); `src/web` (the phone controller and dashboard); `tools/sim-phones.ts` |
| `spikes/s4-web-host` | `src/core` (chart, judge, MIDI, stats), `src/game/session.ts`, `src/audio`, `src/render` (Three.js highway, effects), `src/input`, `src/ui/hud.ts` |
| `spikes/s5-chart-pipeline` | Zero-dependency Node pipeline (ABC/MIDI/MusicXML import, arrange, assign, harmony, export), `schema/chart.schema.json`, `songs/` and `sources/` (CC0 and public domain), generated `charts/` and `exports/` |
| `spikes/i2-web-phones` | The TV game: multi-highway, team chart, seating chart, parts, lobby, procedural backing, HGP input; e2e and audio checks; `npm start` |
| `spikes/shared` | `pitch-palette.ts` |

Spike folders are throwaway by rule ([AGENTS.md](../../AGENTS.md)). Every spike is preserved at
an annotated tag (`spike/*`, `integration/*`).

The alpha is due Nov 15, 2026 and the holiday release Dec 18, 2026. The owner has played the
I2 build at home and said "This is all great, no notes". One timing e2e scenario is flaky
([#18](https://github.com/dcuccia/go-go-harmoniyo/issues/18)), and CI doesn't cover the I2 path
yet ([#24](https://github.com/dcuccia/go-go-harmoniyo/issues/24)).

## Target layout

Use **npm workspaces** in a single repository. They need no new tool, Node 22 already ships
npm, and every spike already uses npm lockfiles. Package names use the `@gogoharmoniyo/` scope
from the [brand guide](../design/brand.md). Packages stay `private: true` until the owner
decides to publish (the npm org is reserved in
[#45](https://github.com/dcuccia/go-go-harmoniyo/issues/45)).

```
package.json            workspace root: npm start / test / e2e for everything
packages/
  hgp/                  @gogoharmoniyo/hgp      HGP types, message validation, ClockSync          (S1 src/core/hgp, clock-sync)
  core/                 @gogoharmoniyo/core     chart model, judge, team chart, scoring, stats,   (S4 src/core, game/session timing;
                                                timing/clock mapping, seating model, part names,   I2 team-chart, seating, parts;
                                                pitch-class palette                                 spikes/shared)
  sensing/              @gogoharmoniyo/sensing  ring/impact detectors, onsets, match              (S1 src/core detectors)
  charts/               @gogoharmoniyo/charts   import (ABC/MIDI/MusicXML), arrange, assign,       (S5 src, schema)
                                                harmony, export, validate (zero dependencies)
apps/
  host/                 the TV game (web host per ADR-0004): renderer, audio, backing, lobby,      (I2 src + S4 render/audio/input/ui)
                        HUD; Vite
  controller/           the phone page: motion, zones, part picker, local bell sound              (S1 src/web controller)
  server/               Node process on the PC: HGP relay, static serving of host + controller,    (S1 src/host; I1 --yarg sidecar stays
                        HTTPS/WSS, QR, --tunnel, dashboard                                          here behind its flag)
content/
  songs/                carol sources + manifest (CC0 / public domain; REUSE annotations move here) (S5 songs, sources)
  charts/               generated charts and YARG/CH exports                                       (S5 charts, exports)
contracts/              golden test vectors per ADR-0005: hgp/, chart/, judge/                     (#42)
tools/
  charts/               CLI: build charts for the host profiles (`npm run charts`)                 (S5 build.mjs, I2 build-charts.mjs)
  sim/                  simulated phones and YARG phones, trace analysis                           (S1 tools)
  licensing/, setup/    unchanged
tests/e2e/              timing, seating, controller, WebKit and audio checks across apps           (I2 scripts, S1 e2e)
spikes/                 stays for future spikes and for what doesn't graduate (see below)
```

Rules:

- **Dependencies point downward:** `apps` → `packages`, and `packages/core` → `packages/hgp`.
  Packages never import apps. The browser packages (`core`, `hgp`) don't import Node modules.
- **Contracts first:** a change to HGP or the chart format changes `docs/protocol/`, the schema
  and `contracts/` first, then the code (ADR-0005).
- **Assets live in `content/`** (and later `assets/`), never next to code. That keeps
  `REUSE.toml` and `attribution/register.json` simple.

### What stays in `spikes/`

- `s2-yarg-core` and `s3-yarg-handbell` (C#, YARG community track, LGPL exception EX-005). They
  are evidence, not product.
- The S1 measurement tools that only matter for research (`meter`, `analysis.ts`, `sim/`
  results) move to `tools/sim/` only if a product test uses them. Otherwise they stay.
- Graduated folders (`s1-phone-bell`, `s4-web-host`, `s5-chart-pipeline`, `i2-web-phones`,
  `shared`) are replaced by a short `README.md` stub pointing to the new location and the tag.
  Their results and reports stay in `docs/spikes/`.
- New spikes keep going in `spikes/<id>-<slug>/`. A spike may depend on workspace packages.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| **A. Ship the alpha from `spikes/i2-web-phones` as-is; graduate right after the tag (Nov 16–24)** | No churn before the alpha; the owner tests exactly what ships; #18 and CI (#24) get fixed on stable paths; holiday features (5 ringers, iPhone, reconnect, theme) are written once, in their final place; the alpha tag stays a clean baseline to compare against after the move | The alpha's release notes and start command point into `spikes/` (fine for an owner-only alpha); a short freeze on feature work during the move |
| B. Graduate before the alpha (Oct 27 – Nov 7), ship the alpha from `apps/` | The alpha looks like a product; no move later | Moves about 13.6 k lines in 93 source files across 5 folders while #18 is still flaky and before CI covers I2; regressions would surface in the owner's only pre-alpha playtest; it pushes alpha work (#25, #26, #27) late; about 3–4 agent-days spent before the date |
| C. Hybrid: workspace root and `contracts/` before the alpha, apps after | Golden vectors protect the alpha early | Two disruptive moments instead of one; vectors without a stable package home must move again |
| D. Never graduate; keep growing the spikes | Zero migration cost | Contradicts AGENTS.md (spikes are throwaway); cross-spike relative imports and five lockfiles get worse with each feature; no clear home for contracts |
| E. Separate repositories per package | Independent versioning | Cross-repo changes for every HGP change; more CI, more licensing setup; wrong scale for one team |

## Decision (proposed)

**Option A.** Tag `v0.1.0-alpha` from `spikes/i2-web-phones` with a root `npm start` that
delegates to it ([#25](https://github.com/dcuccia/go-go-harmoniyo/issues/25)). Then graduate in
the sequence below, finished by **Nov 24**, before most holiday feature work
([#41](https://github.com/dcuccia/go-go-harmoniyo/issues/41)).

If the owner wants the alpha to look like a product, choose B. Its earliest safe start is after
#18 and #24 merge.

## Migration sequence

Each step is one PR. Behaviour doesn't change, and the full check list passes before and after
each step: unit tests, `e2e`, `e2e:seating`, `audio-check` and `controller-check`, plus
`attribution.mjs --check`, `license-gate.mjs --check` and `reuse lint`. Use `git mv` so history
follows the files.

1. **Workspace root.** Make the root `package.json` (from #25) an npm workspace with
   `tsconfig.base.json` and one lockfile. Add a `product` CI workflow. No code moves.
2. **`packages/hgp` + `contracts/hgp`.** Move S1's HGP types and `ClockSync`. S1 and I2 import
   the package. Seed the HGP vectors from S1 `test/` (#42).
3. **`packages/core` (+ `sensing`) + `contracts/judge`.** Move the S4 core, the I2 team chart,
   seating and parts, the palette, and the S1 detectors. Seed the judge vectors from the I2 e2e
   scenarios.
4. **`packages/charts`, `content/`, `tools/charts`, `contracts/chart`.** Move the S5 pipeline,
   songs, sources, charts and exports. Update the `REUSE.toml` paths and register entries in the
   same PR.
5. **`apps/server`, `apps/controller`, `apps/host`.** Move the S1 host and controller, and I2
   with the S4 render, audio, input and UI. Root `npm start` now runs `apps/server` with
   `apps/host` and `apps/controller`.
6. **`tests/e2e/` and cleanup.** Move the e2e, controller, WebKit and audio scripts. Update CI
   workflows and docs (runbooks, the README map, the roadmap). Replace the graduated spike
   folders with pointer stubs.

Estimate: about 3–4 agent-days in total. Steps 2–4 can't run in parallel, because each changes
the imports of the next.

## Consequences

- One `npm install`, one lockfile, one `npm test` at the root. The license gate reads one
  lockfile instead of five. The CI path filters get simpler.
- The ADR-0005 golden vectors get a home (`contracts/`) and run against `packages/*` in CI.
- `REUSE.toml`, `attribution/register.json`, the workflows and the runbooks all change paths. Each
  step updates them in the same PR (the licensing checks fail otherwise, which is the guard).
- Links into `spikes/` from older docs and reports keep working through the stubs and tags.
  New docs link to `apps/` and `packages/`.
- The YARG fork track is unaffected. It talks to `apps/server`'s `--yarg` sidecar over `hgp0`
  and checks `contracts/` (ADR-0005).
- Publishing packages to npm, and moving the repository to a GitHub org, are separate later
  decisions.

## Evidence

- [I2 report](../spikes/I2-web-phones.md) and [runbook](../../spikes/i2-web-phones/README.md):
  the alpha path, its cross-spike imports, and its checks.
- [ADR-0005](0005-shared-core-language.md): contracts and golden vectors are the first task
  after this ADR.
- [Alpha plan](../plan/v0.1-alpha.md): dates, exit criteria, and the risk of churn before the
  alpha.
