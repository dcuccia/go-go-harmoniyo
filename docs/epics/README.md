# Epics

Long-lived workstreams. Each epic lists goals, holiday-MVP slice, later scope, and open
questions. Spikes feed epics; ADRs record decisions.

| ID | Epic | Holiday MVP? |
|---|---|---|
| E01 | [Input & timing / Handbell Gesture Protocol](#e01-input--timing--handbell-gesture-protocol-hgp) | Yes |
| E02 | [Phone-as-bell controller](#e02-phone-as-bell-controller) | Yes |
| E03 | [Game host & engine](#e03-game-host--engine) | Yes |
| E04 | [Songs, charts & arrangement pipeline](#e04-songs-charts--arrangement-pipeline) | Yes |
| E05 | [Bell audio](#e05-bell-audio) | Yes |
| E06 | [Gameplay, scoring & team play](#e06-gameplay-scoring--team-play) | Yes |
| E07 | [Visual & aural engagement ("juice")](#e07-visual--aural-engagement-juice) | Yes |
| E08 | [Classroom & coaching](#e08-classroom--coaching) | No |
| E09 | [Hardware adapters](#e09-hardware-adapters) | No |
| E10 | [Community, upstream & licensing](#e10-community-upstream--licensing) | Partly |
| E11 | [Distribution & cross-platform packaging](#e11-distribution--cross-platform-packaging) | Yes |

---

## E01 Input & timing / Handbell Gesture Protocol (HGP)

**Goal:** one hardware-agnostic contract for gesture input with source timestamps on a
synchronized clock, so any device (phone, ESP32-S3 bell, MIDI, keyboard, mic listener) can
drive any host.
- MVP: HGP v0 — device hello/capabilities, clock sync, `ring` events (+ optional `damp`),
  bell assignment from host to device. Judging uses source timestamps mapped to host audio
  clock.
- Later: full technique vocabulary (shake, martellato, pluck, thumb damp, LV, echo),
  intensity/velocity, battery/health, BLE and serial bindings, firmware reference impl.
- Open: transport (WebSocket/TLS on LAN vs WebRTC data channel vs relay); target timestamp
  accuracy (p95 ≤ 15 ms?); how to calibrate per-device sensor latency.
  - S1 (emulated, physical pending): LAN sync error ≈ 1 ms p95; the ~60 Hz sensor rate dominates
    (≈ 8 ms per-device p95; two-phone p95 ≈ 15 ms), so the 15 ms target should apply per device.
    Per-device latency → input-offset calibration (median strike − beat in a metronome run).
    Transport: ADR-0006 (Proposed). Draft spec: [hgp-v0.md](../protocol/hgp-v0.md).
  - Hosts must hold a note's verdict for an arrival lookahead (Wi-Fi power-save spikes ~200 ms).
- Spikes: S1. Spec lives in [docs/protocol/](../protocol/README.md).

## E02 Phone-as-bell controller

**Goal:** any phone becomes a bell by scanning a QR code — no install.
- MVP: web page on iOS Safari + Android Chrome; motion permission flow; strike detection;
  shows assigned bell(s)/note name and color; wake lock; reconnect.
- **Top alpha bug: [#10](https://github.com/dcuccia/handbell-hero/issues/10).** On a real
  Pixel, QR pairing works but taps and rings don't register with the Node host. Simulated
  phones pass (S1, I1, I2), so this is the first real-device finding. To investigate:
  - Which runbook was used (I1 `npm run yarg` vs I2 `npm start`).
  - Motion permission, calibration, and zone touch vs swing.
  - WSS status in the dashboard.
  - `chrome://inspect` console logs and `?record=1` traces.
- Open: one phone covering 2+ bells (tilt/orientation, on-screen thumb zones, gesture
  direction, or difficulty-based single-bell parts?); local vs host sound; iOS silent switch
  and Web Audio; phone-holder ergonomics (see handbellSTLs).
  - S5 data: carol melodies need 8–11 distinct bells, so 1 bell per phone is infeasible for
    3–5 ringers and 2 bells per phone overflows on most songs; ~4 bells per phone (zones) fits
    6/8 carols on easy and medium with 4 ringers. Needs measured bell-switch and re-strike
    times from S1 to calibrate the pipeline's controller profiles.
  - S1: 4 sticky thumb zones (touch selects, swing rings; next bell glows) are implemented and
    scored (right-bell %, touch→ring lead). Physical usability is pending (runbook test D).
    Fallbacks: two phones per player, or 1–2 bells per phone. A six-ring axis calibration is
    essential (false rings 4–27 % → 0 % in emulation). Sound on the phone is recommended.
  - iOS (unverified): permission must be requested from the Start tap; behaviour after a
    self-signed-certificate bypass; `navigator.audioSession` for the silent switch; no haptics.
  - I2 ([report](../spikes/I2-web-phones.md)): with S5's `phone-4zone` profile, 4 ringers fit
    ≤ 4 bells per phone on easy/medium for most carols, but 1–2 ringers and hard tiers still
    overflow; I2 lets the host ring the least-used overflow bells. Host `cues` make the
    next zone glow; zones laid out as a lane row (I1's `assign.ringer`) match the TV highway.
- Spikes: S1.

## E03 Game host & engine

**Goal:** the shared-screen game, as engaging as commercial rhythm games, cross-platform.
- MVP: Windows PC → TV. Note highway with per-ringer lanes, song select, results screen.
- Candidates: YARG fork (+ HGP input), web-native (TypeScript + WebGL/WebGPU), .NET core
  with Avalonia/Blazor shells, osu! ruleset (fallback). Multiple hosts allowed only on a
  shared core.
- Decided (M2):
  - [ADR-0004](../decisions/0004-host-strategy.md): the product host is web-first, on an
    engine we own. The YARG fork is a community/experimental track.
  - [ADR-0005](../decisions/0005-shared-core-language.md): the shared core is TypeScript,
    with HGP + chart JSON as language-neutral contracts tested by golden vectors.
  - The alpha path is the I2 host.
- Open: frame pacing on low-end classroom hardware; audio clock accuracy in browsers
  (`AudioContext.outputLatency`); product code layout (follow-up ADR).
- Learned (S3 Phase A): a YARG "thin fork" reuses Five-Lane Keys for up to 5 ringers × 5 bells,
  with band score and practice mode for free; ~13–20 agent-days to holiday MVP. Host is desktop
  only (Win x64/macOS/Linux x86_64; no browser/ChromeOS/ARM). YARG's engine clamps late-arriving
  inputs to "now", so network input needs a lookbehind seam. If the web host judges in TypeScript
  and YARG in C#, the two hosts would not share a core.
  See [S3 report](../spikes/S3-report.md).
- Learned (S3 Phase B):
  - The thin fork [`dcuccia/YARG@handbell-spike`](https://github.com/dcuccia/YARG/tree/handbell-spike)
    builds headlessly (Unity 6000.3.5f2; 13 min full player build, 1.3 min incremental).
  - Phones join as virtual bell devices and get auto-profiles.
  - A 40 ms input lookbehind makes modeled typical Wi-Fi judging exact (stock: p95 32 ms error).
  - ≈3–5.5 agent-days remain to the Nov 15 alpha on this path.
  - See [Phase B results](../spikes/S3-report.md#phase-b-results).
- Learned (S2):
  - S2: YARG.Core runs in browser-wasm (bit-identical scoring vs desktop, ~107 KB brotli, ~1.7 MB
    total with the .NET runtime) after a small `YargLogger` patch; a TS host could call it via
    `[JSExport]`. Engines must run a fixed latency budget behind the audio clock so networked,
    source-timestamped strikes arrive in time. Unmeasured: WASM AOT, Safari.
  - S2: handbell mode can start as per-ringer Pro Keys engines with no YARG.Core changes
    (≤25 semitones per chart); a first-class instrument touches ~45 YARG.Core files.
- Learned (S4):
  - S4: Chrome/Windows holds 60 fps+ at 1080p and 4K on an integrated GPU with bloom (4× MSAA is
    the expensive part); `getOutputTimestamp()` mapping jitter < 0.12 ms; real Chromebook and
    Safari/Firefox still untested; render-scale/auto-quality needed for low-end hosts.
- Learned (I1, phones → YARG fork; [report](../spikes/I1-yarg-phones.md)):
  - The S1 host doubles as the YARG sidecar (`npm run yarg`). One phone = one ringer seat = one
    stable YARG bell device (`ringerN`), so a dropped or swapped phone keeps the same YARG profile.
  - YARG reports the loaded song and each ringer's part/difficulty back to the sidecar, so phones
    get that ringer's chart bells (lane k = k-th bell, YARG lane colours on the phone).
  - Simulated phones → real built YARG: 182/182 rings registered on 4 ringer devices, 0 drops.
    In-song judging with real phones is still unverified (owner run).
  - Open: lookbehind budget for real phones (S1 predicts arrival ≈ 40–65 ms, above the 40 ms
    default; start at 60 ms); whether phone-local bell sound plus YARG's bell stems sounds doubled.
- Learned (I2, phones → web host; [report](../spikes/I2-web-phones.md)):
  - I2: 1–4 side-by-side S4 highways (one WebGL context each, reused) hold the 165 Hz panel
    headless on the owner's laptop; one shared-lane-group highway was not tried. Phone rings
    reach the game page through the S1 Node host (dashboard WebSocket relay, ~35 ms p50 in
    simulation); a production host would embed the HGP server or run it as a sidecar.
- Spikes: S2, S3, S4, (S6).

## E04 Songs, charts & arrangement pipeline

**Goal:** turn sheet music into playable, fair handbell charts for N ringers at several
difficulties.
- MVP: import MIDI / MusicXML of public-domain carols; derive bell set; assign bells to
  ringers (handbell conventions: adjacent naturals + their sharps); difficulty tiers
  (melody-only → full); per-file source/license metadata; ≥5 carols.
- Later: chart editor; import/map Clone Hero/YARG charts (`.chart`, `.mid`, `.sng`);
  handbell notation symbols; arrangement sharing.
- Open: engine-neutral chart format vs reuse RB/CH MIDI conventions; sources (Mutopia,
  IMSLP, self-authored) and their per-file licenses.
- Learned (S3 Phase B): YARG drops a chart from its library entirely if the folder has no audio
  stem. Exports must include at least one stem; per-ringer stems also give per-ringer
  mute-on-miss. Prefer opus/ogg over WAV.
- Learned (S2):
  - S2: YARG.Core parses RB-style `PART REAL_KEYS_X` MIDI and `.chart` in-memory (browser too);
    Pro Keys tracks can carry handbell parts within a 25-semitone window (C3–C5 as written).
- Learned (S5, see [report](../spikes/S5-report.md)): engine-neutral JSON proposed as source of truth
  ([ADR-0007](../decisions/0007-chart-format.md), Proposed), RB/CH `.mid` as export; corpus of 8
  carols (5 self-encoded CC0 lead sheets + 3 Mutopia public-domain MIDI). 4 ringers is the
  sweet spot. Still open: easy-tier load fairness (melody pitch histograms are peaked — allow
  non-contiguous bells on easy?), hard-tier melody concentrating on one ringer, pitch-set
  reduction when a phone covers ≤ 2 bells, bell-synth audio render for exports, proofreading
  workflow for self-encoded songs.
- Spikes: S5.

## E05 Bell audio

**Goal:** a beautiful, license-clean bell sound with low latency.
- MVP: modal/additive synthesis (handbells are tuned with a strong 12th partial) or CC0 /
  self-recorded samples; backing track optional.
- Open: sound on host vs phone vs both; owner-recorded handbell samples?; latency budget.
  - Direction (ADR-0004): move to **real recorded handbell samples**, with a per-file
    license.
  - S1: recommends sound on the phone (TV/HDMI/Bluetooth audio adds 50–150+ ms on the host).
    `/meter` in the S1 harness measures knock→sound latency; results are pending.
  - S4: an additive synth (fundamental + tuned 12th + inharmonic partials) is pleasant but not
    "beautiful"; Windows shared-mode output adds ~50 ms between a host-side ring and its sound.

## E06 Gameplay, scoring & team play

**Goal:** fun that teaches ensemble ringing.
- MVP: timing windows (Perfect/Great/Good/Miss), per-ringer and team streaks, team
  multiplier, difficulty levels, practice mode (slow-down, loop section), results screen.
- Later: "star power" analogue (e.g. team-wide perfect phrase), damp scoring, sight-reading
  mode, achievements, replays.
- Open: how unforgiving to be with kids vs experienced ringers; scoring missed damps.
  - S2: YARG's per-player combo multiplier penalizes split parts (same perfect play: 23,160 as
    one player vs 15,360 over 4 ringers); team play needs a team/band multiplier. With ±70 ms
    windows, total strike-timing error σ ≲ 20 ms → 100 % hits; σ 35 ms → 91 %; σ 50 ms → 76 %.
  - I2: team score/streak/multiplier is S4's single `Judge` over all ringers' lanes (one miss
    breaks the team streak); per-ringer hits/accuracy/timing on each highway and in results.
    Parts nobody holds are rung by the host. Open: per-ringer streaks/multipliers vs team-only.

## E07 Visual & aural engagement ("juice")

**Goal:** commercial-game feel: 3D highway, hit flashes, particles, streak fire, crowd/
audience reactions, festive themes (holiday theme for M5).
- Open: art pipeline and asset licenses (CC0/CC-BY, commissioned, procedural).
  - Decided ([ADR-0008](../decisions/0008-assets-ip-and-attribution.md)): original assets CC BY
    4.0, AI-generated CC0 with logged provenance and a human resemblance review; ideas are free,
    other games' expression and trade dress are not. Our principles and the pitch-class palette:
    [visual identity](../design/visual-identity.md). Lane colours move to that palette in
    [#12](https://github.com/dcuccia/handbell-hero/issues/12).
  - S4: procedural neon highway + bloom/particles reaches "Clone Hero default" level; the gap to
    GH/RB is mostly scene/environment art, authored models/animation and UI design, not the engine.

## E08 Classroom & coaching

**Goal:** low-budget classroom use with 8–12 ringers.
- Later: teacher dashboard, roster/bell assignment, coaching mode that conducts a real
  choir without sensors (for RP2040 bells or acoustic bells), progress tracking.

## E09 Hardware adapters

**Goal:** physical bells as first-class inputs, decoupled from the game.
- ESP32-S3 digital-handbell speaking HGP over Wi-Fi (coordinate with
  [digital-handbell](https://github.com/dcuccia/digital-handbell)).
- Microphone "listener": onset + pitch detection to score real bells/chimes or the
  standalone RP2040 bells.
- MIDI / keyboard / game-controller adapters for development and accessibility.
- Direction (ADR-0004): digital handbells are a **premium peripheral**. The preferred link
  for bells is an **ESP-NOW → USB gateway dongle** (Web Serial, with HID/MIDI fallbacks);
  phones use WSS, then WebRTC. See the
  [connectivity research](../research/connectivity-and-deployment.md) and ADR-0006
  (Proposed).

## E10 Community, upstream & licensing

**Goal:** build on and give back to existing projects; keep licensing clean.
- Track forks (e.g. YARG under LGPL-3.0) in separate repos; propose upstream-friendly seams
  (e.g. generic network input devices, custom lane counts) only with owner approval.
  - S2 drafted (not filed) a YARG.Core issue: `YargLogger` static ctor starts a thread and
    crashes browser-wasm; see [S2 report](../spikes/S2-report.md#the-blocker-and-the-patch).
- License register for code, assets, songs, samples.
  - Done ([ADR-0008](../decisions/0008-assets-ip-and-attribution.md)): REUSE (`REUSE.toml`,
    `LICENSES/`), [asset register](../../attribution/register.json) → generated
    [ATTRIBUTION.md](../../ATTRIBUTION.md) and in-game `credits.json`, dependency license gate →
    [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md), all checked in CI. Audit:
    [IP audit 2026-10-23](../research/ip-audit-2026-10-23.md).
  - Open: owner sign-off on exceptions EX-001 (MPL-2.0 `mediabunny`), EX-002 (Unlicense
    `tweetnacl`), EX-005 (LGPL S2 patch file); product name
    ([#13](https://github.com/dcuccia/handbell-hero/issues/13)); proofread the S5 AI-encoded
    lead sheets.
- Decided ([ADR-0004](../decisions/0004-host-strategy.md)):
  [`dcuccia/YARG@handbell-spike`](https://github.com/dcuccia/YARG/tree/handbell-spike) is a
  community/experimental track (snapshot tag `handbell-spike-2026-10-23`).
  - Keep it buildable with [`tools/setup/setup-yarg.ps1`](../../tools/setup/setup-yarg.ps1).
  - Backport HGP input and the YARG/CH exporter to the YARG community where useful.
  - Upstream seams only with owner approval. No product dependency on YARG.
- Open (S3 Phase A): a YARG-based host is **non-commercial only** (BASS is free for non-commercial
  use only; YARG also ships CC BY-NC crowd SFX). Draft upstream issues (latency budget for network
  input devices; software device registration) are in the [S3 report](../spikes/S3-report.md).
  Owner to raise them in YARG's Discord first. Git LFS pushes to and pulls from a fork count
  against YARC-Official's quota, so keep fork LFS traffic minimal.

## E11 Distribution & cross-platform packaging

**Goal:** easy setup at home and in classrooms.
- MVP: Windows host install/run; phones join via QR code over home Wi-Fi with valid HTTPS.
  - S1: alpha uses a self-signed cert (one warning tap per phone) or a Cloudflare quick tunnel;
    guest and school networks isolate clients (use the relay). On Windows, allow Node through the
    firewall for Private networks and use `127.0.0.1` rather than `localhost`. See ADR-0006.
- Later: macOS/Linux/ChromeOS hosts; hosted web version; offline classroom kit.
