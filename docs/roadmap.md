# Roadmap

Dates are targets, not promises. Plan written 2026-10-22; status updated 2026-10-23.

## Status (2026-10-23)

| # | Milestone | Status |
|---|---|---|
| M0 | Planning | **Done** |
| M1 | Spikes | **Done.** S1–S5 plus integrations I1 (phones → YARG fork) and I2 (phones → web host) are merged; S6 not run. Code is preserved at tags `spike/*` and `integration/*` ([spikes index](spikes/README.md)) |
| M2 | Decision gate | **In progress.** Accepted: [ADR-0004](decisions/0004-host-strategy.md) (web-first host on an engine we own; YARG fork as a community/experimental track) and [ADR-0005](decisions/0005-shared-core-language.md) (TypeScript core; HGP + chart JSON as language-neutral contracts with golden test vectors). Pending owner: [ADR-0006](decisions/0006-phone-host-transport.md) (transport) and [ADR-0007](decisions/0007-chart-format.md) (chart format), both Proposed |
| M3 | Alpha (Nov 15) | Next. Path: the I2 web host ([runbook](../spikes/i2-web-phones/README.md#owner-runbook-tv-playthrough-10-minutes)); machine setup via [tools/setup](../tools/setup/README.md) |

**Top alpha bug:** [#10](https://github.com/dcuccia/handbell-hero/issues/10). Real-phone taps
and rings don't register with the Node host, although QR pairing works. Simulated phones
pass end-to-end, so this is the first real-device finding. Fix it before any other M3 work,
because every alpha exit criterion depends on real phones.

Direction agreed by the owner for M3 onward (ADR-0004):
- Jackbox-style zero friction: phones join by QR code, no install.
- Feel before fidelity, with a stylized art direction.
- Co-op play where the song only sounds right together.
- Real recorded bell samples.
- Content from public-domain carols plus MIDI import.
- Digital handbells as a premium peripheral (ESP-NOW USB dongle).

## North star

A team of ringers stands in front of a shared screen, each holding a bell (phone, digital
handbell, or real bell heard by a microphone). A carol starts; notes fly down each ringer's
lane; the room rings it together and the game celebrates streaks and team accuracy.

## Milestones

| # | Milestone | Target | Exit criteria |
|---|---|---|---|
| M0 | Planning | Oct 22–25 | Repo, epics, spike briefs, ADR-0001..0003 merged |
| M1 | Spikes | Oct 22 – Oct 30 | S1–S5 reports merged (S6 optional) |
| M2 | **Decision gate** | Oct 31 – Nov 1 | Owner accepts ADRs for: host engine, shared-core language, controller transport, chart format |
| M3 | **Alpha release** | Nov 15 | Playable end-to-end on the owner's PC + Pixel phones: ≥2 carols, 2+ phones as bells, per-ringer lanes, timing judgement, team score. Tagged `v0.1.0-alpha` |
| M4 | Holiday MVP build + beta | Nov 16 – Dec 6 | ≥5 carols, 3–5 phones incl. iPhone, difficulty levels, polish/juice, holiday theme |
| M5 | Family playtest + polish | Dec 7 – Dec 13 | Tested on iPhone (Safari) and Pixel (Chrome) on home Wi-Fi; bugs triaged |
| M6 | **Holiday release** | Dec 18 | Tagged release under the chosen public name; one-page "how to play" with QR join |
| M7 | Classroom edition | Q1 2027 | 8–12 ringers, teacher/coach mode, low-budget host (ChromeOS/browser if feasible) |
| M8 | Digital-handbell integration | follows hardware | ESP32-S3 bells speak HGP over Wi-Fi |
| M9 | Listener + RP2040 coaching | 2027 | Mic pitch/onset scoring of real bells/chimes; non-interactive coaching mode |
| M10 | Community charts | 2027 | Import/map Clone Hero/YARG charts; arrangement tools |

## Naming

"Handbell Hero" is the **code name** (repo, docs). Before the public holiday release we
choose a distinct public name, because Activision holds a family of "[instrument] Hero"
marks for music games (GUITAR HERO, BAND HERO, and filings for DRUM HERO, SING HERO,
KEYBOARD HERO), which raises likelihood-of-confusion risk even for a free MIT project.

- Shortlist by Nov 15 (alpha); decision by Dec 1; rename public surfaces by Dec 18.
- Checks per candidate: USPTO (classes 9, 28, 41), app stores, GitHub/npm/NuGet, domain,
  general web; no "Hero"-style evocation of Activision marks. Not legal advice — consult
  counsel if commercial use is ever planned.
- Starting ideas: Peal, Chime In, Ring Along, Bell Rush.

The Nov 15 alpha is deliberately ambitious; if a spike shows it is not achievable, cut
scope (fewer carols, Android-only, keyboard fallback) rather than move the date.

## Holiday MVP scope (see [ADR-0003](decisions/0003-holiday-v1-scope.md))

In: PC host on TV, 3–5 phones as bells via web page (iOS + Android, join by QR code),
public-domain carols from MIDI/MusicXML, per-ringer lanes, timing judgement, team
score/streak, difficulty levels, a satisfying bell sound.

Out: online play, accounts, custom hardware, microphone scoring, licensed music.

## Decision gate inputs (M2)

| Decision | Evidence from | Outcome |
|---|---|---|
| Host engine: YARG fork vs web-native vs other | S2, S3, S4, I1, I2 (S6 not run) | [ADR-0004](decisions/0004-host-strategy.md) **Accepted**: web-first; YARG fork as a community track |
| Shared-core language (C# vs TypeScript) | S2, S4 | [ADR-0005](decisions/0005-shared-core-language.md) **Accepted**: TypeScript + language-neutral contracts |
| Phone ↔ host transport (LAN WebSocket+TLS, WebRTC, relay) | S1 | [ADR-0006](decisions/0006-phone-host-transport.md) Proposed |
| Chart / arrangement format | S5, S2 | [ADR-0007](decisions/0007-chart-format.md) Proposed |

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
timing model, and HGP input. Per ADR-0004/0005, the product host is the web host. The YARG
fork stays a community/experimental track that talks to the core through the HGP and
chart-JSON contracts.
