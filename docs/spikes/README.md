# Spikes

Time-boxed experiments for milestone M1 (Oct 22 – Oct 30, 2026; alpha Nov 15). **M1 is
complete;** the M2 outcome is in [ADR-0004](../decisions/0004-host-strategy.md) and
[ADR-0005](../decisions/0005-shared-core-language.md). Each spike answers specific
questions for the [M2 decision gate](../roadmap.md#decision-gate-inputs-m2). Code goes in
`spikes/<id>-<slug>/`; the report goes in `docs/spikes/<id>-report.md`. Follow
[AGENTS.md](../../AGENTS.md).

| ID | Spike | Feeds | Status | Code at tag | Owner action needed |
|---|---|---|---|---|---|
| S1 | Phone-bell input, timing & transport | E01, E02, E11 | **Done** — [report](S1-report.md) (harness + emulation); physical phone tests pending, see [#10](https://github.com/dcuccia/handbell-hero/issues/10) | [`spike/s1-phone-bell`](https://github.com/dcuccia/handbell-hero/tree/spike/s1-phone-bell) | Run the [20-min runbook](../../spikes/s1-phone-bell/README.md#owner-runbook-pixel-first-20-minutes) on Pixel (iPhone if available); send `summary.md` |
| S2 | YARG.Core portability (console + browser WASM) | E03, E04 | **Done** — [report](S2-report.md): works on console + browser-wasm with a 5-line logger patch | [`spike/s2-yarg-core`](https://github.com/dcuccia/handbell-hero/tree/spike/s2-yarg-core) | Decide on upstreaming the logger fix; review LGPL-in-browser notes |
| S3 | YARG handbell mode | E03, E10 | **Done** — Phase A + B ([report](S3-report.md#phase-b-results)); fork [`dcuccia/YARG@handbell-spike`](https://github.com/dcuccia/YARG/tree/handbell-spike), snapshot tag `handbell-spike-2026-10-23` | [`spike/s3-yarg-desk-study`](https://github.com/dcuccia/handbell-hero/tree/spike/s3-yarg-desk-study), [`spike/s3-yarg-phase-b`](https://github.com/dcuccia/handbell-hero/tree/spike/s3-yarg-phase-b) | Optional: play-test on the TV with `-hgp -hgp-keyboard` — see [next steps](S3-report.md#phase-b-next-steps-owner-at-the-pc) |
| S4 | Web-native host prototype | E03, E05, E07 | **Done** — [report](S4-report.md) | [`spike/s4-web-host`](https://github.com/dcuccia/handbell-hero/tree/spike/s4-web-host) | Look at it on the TV; run Calibrate there; enable Pages if wanted |
| S5 | Carol chart pipeline | E04, E06 | **Done** — [report](S5-report.md) | [`spike/s5-chart-pipeline`](https://github.com/dcuccia/handbell-hero/tree/spike/s5-chart-pipeline) | Proofread the 5 self-encoded carols; review [ADR-0007](../decisions/0007-chart-format.md) |
| S6 | Other .NET hosts: Avalonia (desktop + browser) and osu! ruleset | E03 | Not run (optional; not needed after [ADR-0004](../decisions/0004-host-strategy.md)) | — | — |
| I1 | Integration: phones → YARG fork | E01, E03 | **Done** — sidecar + fork bridge; simulated phones verified against the built YARG ([report](I1-yarg-phones.md)) | [`integration/i1-yarg-phones`](https://github.com/dcuccia/handbell-hero/tree/integration/i1-yarg-phones) | Play one carol with real phones — [owner runbook](I1-yarg-phones.md#owner-runbook-phones--yarg) |
| I2 | Integration: phones → web host (S1 + S4 + S5) | E02, E03, E06 | **Done** — verified with simulated phones ([report](I2-web-phones.md)); the alpha path per ADR-0004 | [`integration/i2-web-phones`](https://github.com/dcuccia/handbell-hero/tree/integration/i2-web-phones) | Play it on the TV with real phones: [runbook](../../spikes/i2-web-phones/README.md#owner-runbook-tv-playthrough-10-minutes) |

All spike and integration PRs (#1–#9) were merged into `main` with merge commits on 2026-10-23.
Each tag above is an annotated tag on that PR's final head commit, so the spike can be checked
out exactly as reviewed. Set up a machine for the carried-forward code with
[tools/setup](../../tools/setup/README.md).

Common time box: **one focused session (~1–2 days of agent work)**. Stop at the time box
and report what you have.

---

## S1 — Phone-bell input, timing & transport

**Question:** Can phones running a web page act as handbells with timing good enough for a
rhythm game, on ordinary home Wi-Fi, on both iOS Safari and Android Chrome?

**Do:**
- Build a minimal controller page (TypeScript, no framework needed) and a minimal,
  engine-independent host harness (e.g. Node) under `spikes/s1-phone-bell/`.
- Strike detection from `DeviceMotionEvent` (accelerometer + gyro): detect the ring moment of
  a handbell-style forward stroke; log raw traces for offline tuning. Study (don't copy;
  GPL-3.0) how [Handbell Manager](https://github.com/GACJ/handbellmanager) detects strikes.
- Clock sync: NTP-style ping/pong with min-RTT filtering; map phone timestamps to host
  clock.
- Transport and HTTPS on LAN: iOS requires a secure context for motion sensors. Compare at
  least (a) WebSocket over LAN with a publicly trusted certificate (e.g. DNS-01 Let's
  Encrypt for a hostname resolving to the LAN IP), (b) WebRTC data channel (unordered,
  `maxRetransmits: 0`) with signaling via the host or a small cloud endpoint, (c) cloud
  relay as fallback. Note setup friction for a family and for a school network.
- Sound placement: measure gesture→sound latency for bell sound on the phone vs on the host.
- iOS specifics: `DeviceMotionEvent.requestPermission()`, silent switch vs Web Audio
  (`navigator.audioSession`), Wake Lock, backgrounding/reconnect.

**Measure:** motion sample rate per device; detection latency (peak→event); false
positives/negatives over a scripted session (≥100 strikes); clock-sync error — "clink test"
(two phones struck together, compare synced timestamps) and RTT stats; jitter of arrival
time vs source timestamp.

**Success:** ≥98 % detection, ≤2 % false strikes, synced-timestamp error p95 ≤ 15 ms on
Pixel; documented, family-friendly HTTPS path. **Kill:** if p95 > 40 ms or iOS cannot be
made to work, say so and propose alternatives (native wrapper, BLE, dedicated hardware).

**Report must answer:** recommended transport; achievable timing accuracy; detection
algorithm + thresholds; sound placement; iOS caveats; draft
[HGP v0](../protocol/README.md) message schema (write it into `docs/protocol/hgp-v0.md`).

---

## S2 — YARG.Core portability

**Question:** Can [YARG.Core](https://github.com/YARC-Official/YARG.Core) (LGPL-3.0) serve as
an engine-agnostic shared core — in a .NET console app and in the browser via WebAssembly?

**Do:** reference YARG.Core at a pinned commit (submodule or package) under
`spikes/s2-yarg-core/` — do not fork on GitHub without owner approval. Build a console app
that parses a sample chart (`.chart` or RB-style `.mid`) and runs a scoring engine against
synthetic inputs. Then attempt `browser-wasm` (Blazor WASM or `wasmbrowser` template) doing
the same. Catalog native dependencies and blockers. Assess how instruments/engines are
modeled and what adding a "Handbell" instrument (N lanes, per-ringer parts) would take.

**Report must answer:** builds on which targets; WASM size/perf; native deps; effort and
seams for a Handbell instrument; LGPL-3.0 implications for an MIT project consuming it
(flag for owner, don't decide); recommendation for "shared core = YARG.Core?".

---

## S3 — YARG handbell mode

**Question:** How hard is it to add a handbell instrument with network (HGP) input to YARG,
and does it inherit GH-level engagement?

**Phase A (no Unity needed):** desk study of [YARG](https://github.com/YARC-Official/YARG):
instrument pipeline, input system (Unity Input System / PlasticBand), track rendering,
lane counts, multiplayer (local up to 32), audio (BASS) and build targets. Identify the
smallest change set for a handbell mode and upstream-friendly seams (generic network input
device, custom lane counts). Estimate effort to holiday MVP.

**Phase B (needs owner to install Unity):** fork to `dcuccia/YARG` (owner approval), branch
`handbell-spike`, playable prototype with keyboard keys as bells, then HGP input via S1's
harness if available.

**Report must answer:** effort estimate; risk list; platform reach (desktop only?); BASS
licensing implications; whether upstream would plausibly accept the seams (cite their
contribution guidelines); recommendation.

---

## S4 — Web-native host prototype

**Question:** How close can a browser host get to commercial rhythm-game feel, and with what
timing accuracy and frame pacing?

**Do:** TypeScript + Vite under `spikes/s4-web-host/`. Choose a renderer (Three.js for a 3D
highway is the default suggestion; justify if PixiJS/Babylon.js/WebGPU-native). Load a MIDI
file, generate N lanes, schedule audio on the `AudioContext` clock (account for
`outputLatency`), synthesize a bell tone, judge keyboard input. Add "juice": hit flashes,
particles, streak/multiplier, bloom. Publish a static build (GitHub Pages) and capture a
short video/GIF.

**Measure:** frame times at 1080p and 4K on the owner's PC; CPU-throttled run approximating
a Chromebook; audio–visual sync error; input-to-judgement latency with keyboard.

**Report must answer:** visual-quality assessment vs GH reference (honest); performance;
timing; effort to holiday MVP; cross-platform reach; recommendation for "shared core =
TypeScript?".

---

## S5 — Carol chart pipeline

**Question:** Can we automatically turn public-domain carols (MIDI/MusicXML) into fair
handbell charts for 3–5 ringers at multiple difficulties?

**Do:** under `spikes/s5-chart-pipeline/`: find ≥5 carols with **file-level** licenses that
permit redistribution (e.g. Mutopia, CPDL, IMSLP where the edition is free, or author our
own); record source+license per file. Derive the bell set; assign bells to ringers using
handbell conventions (each ringer covers adjacent naturals and their accidentals; balance
load; avoid impossible fast alternations); generate difficulty tiers. Propose an engine-
neutral chart JSON and evaluate exporting to RB/CH-style MIDI for YARG.

**Report must answer:** sources and licenses; assignment algorithm; sample charts;
proposed format (+ schema); mapping to YARG/CH formats; what a phone covering 2 bells
would require.

---

## S6 — Other .NET hosts (optional)

**Question:** Do cross-platform .NET UI stacks give a better path than Unity or pure web?

**Do (desk study + tiny prototype):** Avalonia (desktop + browser WASM) with GPU rendering
(Skia/OpenGL/composition) for a note highway; osu! custom ruleset via the official ruleset
templates (visual identity, distribution model, platforms). Compare against S3/S4.

**Report must answer:** feasibility, visual ceiling, platform reach, effort; recommendation.
