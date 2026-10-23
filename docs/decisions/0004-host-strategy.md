# 0004 — Host strategy: web-first host on an engine we own; YARG fork as a community track

- Status: Accepted
- Date: 2026-10-23
- Deciders: @dcuccia (owner); proposed by the M2 consolidation session (agent), from the
  [M2 decision brief](m2-decision-brief.md)

## Context

M2 asks which host engine carries the game from the Nov 15 alpha to the holiday release and on
to classrooms. Spikes S1–S5 and integrations I1 and I2 produced two playable hosts, and both
now take phone input:

- **YARG fork** ([S3](../spikes/S3-report.md), [I1](../spikes/I1-yarg-phones.md)):
  [`dcuccia/YARG@handbell-spike`](https://github.com/dcuccia/YARG/tree/handbell-spike).
  It inherits commercial-adjacent polish. It is desktop-only (Win/macOS/Linux x64) and
  non-commercial only (BASS, CC BY-NC SFX). It needs Unity: an 8 GB editor, a 13 min full
  build, and a license sign-in.
- **Web host** ([S4](../spikes/S4-report.md), [I2](../spikes/I2-web-phones.md)): TypeScript +
  Three.js. It is MIT throughout and runs in any modern browser, including ChromeOS and
  tablets. Its art is still to be made.

The roadmap's priority order is engagement, timing, time to MVP, cross-platform reach, license
fit, community leverage, then agent maintainability. The decision brief framed the choice as
"inherit polish, desktop-only, non-commercial" vs "own everything, every platform".

The owner's direction (2026-10-23) is a Jackbox-style, zero-friction experience: phones join
by QR code with no install. Immediacy beats inherited polish.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| (a) Both hosts as products on a shared contract | Polish now (YARG) + reach later (web) | Two products to maintain. The cores would differ (C# YARG.Core vs TS judge), which ADR-0005 rules out for product code. Doubles QA on a short runway |
| (b) YARG for the holiday release, web later | Most polish by Dec 18 | Desktop-only and non-commercial at launch. Unity/LFS setup and the license sign-in block agents and new contributors. Rework later |
| **(c) Web-first on an engine we own; YARG fork as a community/experimental track** | Zero-install host + controller on one codebase. Every platform. MIT. Fast CI. I2 already plays 1–4 phone ringers on one TV | We must make the art and "juice" ourselves (S4 is "Clone Hero default" tier today) |
| (d) YARG only | Polish | Fails cross-platform reach, licensing, and the zero-friction goal |

## Decision

**(c) Web-first.** The product host is a **browser game on an engine we own**: TypeScript,
with a Three.js renderer for now. It is served with the phone controller from one host.
Phones join by QR code with no install.

- **Feel before fidelity.** Prioritize input-to-feedback immediacy, timing, and readable
  per-ringer highways. Use a **stylized art direction** we can own, rather than chasing
  photo-real venues.
- **Co-op first.** The song only sounds right when everyone plays their part. Use team
  score/streak (I2's single judge over all ringers), and let the host ring unheld parts.
- **Sound.** Move from the synth to **real recorded handbell samples** with recorded
  per-file licenses (E05).
- **Content.** Public-domain carols plus **MIDI import**, via the S5 pipeline and chart JSON
  ([ADR-0007](0007-chart-format.md), Proposed).
- **Peripherals.** Phones are the zero-cost default. **Digital handbells are a premium
  peripheral.** For bells, prefer an **ESP-NOW → USB gateway dongle**
  ([connectivity research](../research/connectivity-and-deployment.md)). For phones, use WSS
  now and WebRTC later. Transport details stay in [ADR-0006](0006-phone-host-transport.md)
  (Proposed).
- **YARG fork = community/experimental track**, not a product dependency:
  - Keep `dcuccia/YARG@handbell-spike` buildable.
    [`tools/setup/setup-yarg.ps1`](../../tools/setup/setup-yarg.ps1) reproduces the toolchain,
    and the S1 host's `--yarg` sidecar (I1) keeps phones working with it.
  - Upstream seams (latency budget for network inputs, software input devices, lane labels)
    are offered to YARG **only with owner approval**. The drafts are in the S3 report.
  - Backporting what we build (HGP input, the chart exporter's YARG/CH MIDI) to the YARG
    community is welcome. Nothing in the product may require YARG, Unity, or BASS.
  - Snapshot: tag `handbell-spike-2026-10-23` on the fork (`130cbd82`).

## Consequences

- E03 builds on S4 + I2: multi-ringer highways, team judge, HGP input, and chart JSON loading
  are already proven with simulated phones. The alpha path is the I2 host.
- E07 (art, juice) becomes the main quality risk. Budget for a stylized look, UI design, and
  hit feedback, not engine work.
- Cross-platform reach comes "for free" for hosts: Windows/macOS/Linux/ChromeOS, plus tablets
  for small groups. Safari/Firefox hosts and low-end Chromebooks still need checks (S4: real
  Chromebook untested).
- Licensing stays MIT end-to-end, so a commercial or classroom-kit path stays open.
- The YARG fork costs a small ongoing tax: keep it building, and keep the I1 sidecar test in
  CI (`.github/workflows/s1-phone-bell.yml`). Fork LFS traffic counts against YARC-Official's
  quota, so keep it minimal (S3 R12).
- S6 (Avalonia / osu! ruleset) is not needed for M2. A desktop wrapper (Tauri/Electron/Avalonia
  WebView) stays an E11 packaging option for the same web code.
- A follow-up ADR sets the product code layout (e.g. host, controller, and core packages).
  Until then, the carry-forward code lives in `spikes/s1-phone-bell`, `spikes/s4-web-host`,
  `spikes/s5-chart-pipeline`, and `spikes/i2-web-phones`
  ([`tools/setup/setup-web.ps1`](../../tools/setup/setup-web.ps1)).

## Evidence

- [M2 decision brief](m2-decision-brief.md): side-by-side on the roadmap criteria.
- [S4 report](../spikes/S4-report.md): 165 fps at 1080p on the iGPU; 137–163 fps at 4K Ultra
  on the dGPU; audio-clock mapping jitter < 0.12 ms; key → judgement p50 1.4 ms; visual tier
  "Clone Hero default".
- [I2 report](../spikes/I2-web-phones.md): real S1 host, simulated phones, and headless Chrome.
  All 4 scenarios pass (1–4 ringers, host ringer, +60 ms lateness). Mean offsets −7…+11 ms;
  page↔host clock error ±0.4–0.5 ms; 4 highways at 164 fps (frame p95 6.2 ms) on an Arc iGPU.
  Re-run during consolidation on 2026-10-23: all 4 scenarios PASS.
- [S3 report](../spikes/S3-report.md) and [I1 report](../spikes/I1-yarg-phones.md): fork builds
  headlessly (13.3 min full, 1.3 min incremental). A 40 ms lookbehind takes modeled Wi-Fi
  judging from p95 32 ms to 0 ms. 182/182 simulated rings registered on 4 ringer devices.
  BASS is non-commercial; Unity sign-in is required.
- [S1 report](../spikes/S1-report.md): phone web controller with QR join; 98–100 % detection
  after calibration (emulated); ≈8 ms p95 per device.
- [S2 report](../spikes/S2-report.md): YARG.Core can run in the browser, but only with a C#↔TS
  bridge and LGPL-in-WASM questions. See ADR-0005.
- [Connectivity and deployment research](../research/connectivity-and-deployment.md): browser
  API ceilings; ESP-NOW gateway for classrooms; "YARG on the web" is a multi-month port.
- Open real-device issue: [#10](https://github.com/dcuccia/go-go-harmoniyo/issues/10) (real-phone
  rings not registering). It is the top alpha bug and does not change this decision.
