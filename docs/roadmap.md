# Roadmap

Dates are targets, not promises. Plan written 2026-10-22.

## North star

A team of ringers stands in front of a shared screen, each holding a bell (phone, digital
handbell, or real bell heard by a microphone). A carol starts; notes fly down each ringer's
lane; the room rings it together and the game celebrates streaks and team accuracy.

## Milestones

| # | Milestone | Target | Exit criteria |
|---|---|---|---|
| M0 | Planning | Oct 22–25 | Repo, epics, spike briefs, ADR-0001..0003 merged |
| M1 | Spikes | Oct 26 – Nov 6 | S1–S5 reports merged (S6 optional) |
| M2 | **Decision gate** | Nov 7–9 | Owner accepts ADRs for: host engine, shared-core language, controller transport, chart format |
| M3 | Holiday MVP build | Nov 9 – Dec 6 | Playable end-to-end with ≥5 carols, 3–5 phones, team scoring |
| M4 | Family playtest + polish | Dec 7 – Dec 13 | Tested on iPhone (Safari) and Pixel (Chrome) on home Wi-Fi; bugs triaged |
| M5 | **Holiday release** | Dec 18 | Tagged release; one-page "how to play" with QR join |
| M6 | Classroom edition | Q1 2027 | 8–12 ringers, teacher/coach mode, low-budget host (ChromeOS/browser if feasible) |
| M7 | Digital-handbell integration | follows hardware | ESP32-S3 bells speak HGP over Wi-Fi |
| M8 | Listener + RP2040 coaching | 2027 | Mic pitch/onset scoring of real bells/chimes; non-interactive coaching mode |
| M9 | Community charts | 2027 | Import/map Clone Hero/YARG charts; arrangement tools |

## Holiday MVP scope (see [ADR-0003](decisions/0003-holiday-v1-scope.md))

In: PC host on TV, 3–5 phones as bells via web page (iOS + Android, join by QR code),
public-domain carols from MIDI/MusicXML, per-ringer lanes, timing judgement, team
score/streak, difficulty levels, a satisfying bell sound.

Out: online play, accounts, custom hardware, microphone scoring, licensed music.

## Decision gate inputs (M2)

| Decision | Evidence from |
|---|---|
| Host engine: YARG fork vs web-native vs other | S2, S3, S4 (S6 if run) |
| Shared-core language (C# vs TypeScript) | S2, S4 |
| Phone ↔ host transport (LAN WebSocket+TLS, WebRTC, relay) | S1 |
| Chart / arrangement format | S5, S2 |

Evaluation criteria for the host engine, in priority order:
1. Engagement / visual + audio quality
2. Timing accuracy
3. Time to holiday MVP
4. **Cross-platform reach** (Windows/macOS/Linux/ChromeOS hosts, browser if possible;
   iOS + Android controllers), including low-budget classroom hosts
5. License compatibility with an MIT project
6. Community leverage (users, contributors, upstream benefit)
7. Maintainability by agents

Multiple host engines are acceptable long-term (e.g. a YARG-based "deluxe" host and a
web host) **only if** they share the engine-agnostic core: chart format, scoring/judging,
timing model, and HGP input.
