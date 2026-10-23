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
- Spikes: S1. Spec lives in [docs/protocol/](../protocol/README.md).

## E02 Phone-as-bell controller

**Goal:** any phone becomes a bell by scanning a QR code — no install.
- MVP: web page on iOS Safari + Android Chrome; motion permission flow; strike detection;
  shows assigned bell(s)/note name and color; wake lock; reconnect.
- Open: one phone covering 2+ bells (tilt/orientation, on-screen thumb zones, gesture
  direction, or difficulty-based single-bell parts?); local vs host sound; iOS silent switch
  and Web Audio; phone-holder ergonomics (see handbellSTLs).
- Spikes: S1.

## E03 Game host & engine

**Goal:** the shared-screen game, as engaging as commercial rhythm games, cross-platform.
- MVP: Windows PC → TV. Note highway with per-ringer lanes, song select, results screen.
- Candidates: YARG fork (+ HGP input), web-native (TypeScript + WebGL/WebGPU), .NET core
  with Avalonia/Blazor shells, osu! ruleset (fallback). Multiple hosts allowed only on a
  shared core.
- Open: shared-core language (C# via YARG.Core vs TypeScript); frame pacing on low-end
  classroom hardware; audio clock accuracy in browsers (`AudioContext.outputLatency`).
- Learned (S3 Phase A): a YARG "thin fork" reuses Five-Lane Keys for up to 5 ringers × 5 bells,
  with band score and practice mode for free; ~13–20 agent-days to holiday MVP. Host is desktop
  only (Win x64/macOS/Linux x86_64; no browser/ChromeOS/ARM). YARG's engine clamps late-arriving
  inputs to "now", so network input needs a lookbehind seam. If the web host judges in TypeScript
  and YARG in C#, the two hosts would not share a core.
  See [S3 report](../spikes/S3-report.md).
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
- Spikes: S5.

## E05 Bell audio

**Goal:** a beautiful, license-clean bell sound with low latency.
- MVP: modal/additive synthesis (handbells are tuned with a strong 12th partial) or CC0 /
  self-recorded samples; backing track optional.
- Open: sound on host vs phone vs both; owner-recorded handbell samples?; latency budget.

## E06 Gameplay, scoring & team play

**Goal:** fun that teaches ensemble ringing.
- MVP: timing windows (Perfect/Great/Good/Miss), per-ringer and team streaks, team
  multiplier, difficulty levels, practice mode (slow-down, loop section), results screen.
- Later: "star power" analogue (e.g. team-wide perfect phrase), damp scoring, sight-reading
  mode, achievements, replays.
- Open: how unforgiving to be with kids vs experienced ringers; scoring missed damps.

## E07 Visual & aural engagement ("juice")

**Goal:** commercial-game feel: 3D highway, hit flashes, particles, streak fire, crowd/
audience reactions, festive themes (holiday theme for M5).
- Open: art pipeline and asset licenses (CC0/CC-BY, commissioned, procedural).

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

## E10 Community, upstream & licensing

**Goal:** build on and give back to existing projects; keep licensing clean.
- Track forks (e.g. YARG under LGPL-3.0) in separate repos; propose upstream-friendly seams
  (e.g. generic network input devices, custom lane counts) only with owner approval.
- License register for code, assets, songs, samples.
- Open (S3 Phase A): a YARG-based host is **non-commercial only** (BASS is free for non-commercial
  use only; YARG also ships CC BY-NC crowd SFX). Draft upstream issues (latency budget for network
  input devices; software device registration) are in the [S3 report](../spikes/S3-report.md).
  Owner to raise them in YARG's Discord first. Git LFS pushes to and pulls from a fork count
  against YARC-Official's quota, so keep fork LFS traffic minimal.

## E11 Distribution & cross-platform packaging

**Goal:** easy setup at home and in classrooms.
- MVP: Windows host install/run; phones join via QR code over home Wi-Fi with valid HTTPS.
- Later: macOS/Linux/ChromeOS hosts; hosted web version; offline classroom kit.
