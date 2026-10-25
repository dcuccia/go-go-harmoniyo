# I2 — Phones → web host (integration)

- Integration of [S1](S1-report.md) (phone controller + HGP v0 host, PR #4), [S4](S4-report.md)
  (web host, PR #5) and [S5](S5-report.md) (charts, PR #3). **Depends on #3, #4, #5** (merged
  into this branch). Feeds E02, E03, E06.
- Date: 2026-10-23 · one focused agent session.
- Code: [`spikes/i2-web-phones/`](../../spikes/i2-web-phones/README.md) — **owner runbook there**.
- Raw data: [`spikes/i2-web-phones/results/`](../../spikes/i2-web-phones/results/).

![4 ringers, Jingle Bells medium (simulated phones)](media/i2-4-ringers-play.png)

*Screenshots re-captured 2026-10-23 after [#12](https://github.com/dcuccia/go-go-harmoniyo/issues/12):
each bell's colour follows its pitch class ([palette](../design/visual-identity.md#pitch-class-palette)),
so C5 has the same colour on every highway and phone; F♯4 shows the sharp/flat ring outline.*

## TL;DR

- **Built:** the S4 web host now plays S5 carols with **1–4 ringers on one TV**, each ringer on
  their own S4 highway (name, note names under the strike targets, live hits/accuracy), with
  S4's team score/streak/multiplier on top. Phones join by **QR on the TV** (S1 controller, WSS
  on the LAN with S1's self-signed cert), get their **bells from the chart** (≤ 4 per phone, in
  the highway's lane order, coloured by pitch class), **ring the bell sound locally**, and their **next
  zone glows** from the song's cues. Parts without a player — and bells beyond 4 per ringer —
  are rung by the TV.
- **Timing:** rings are judged on the phones' **source timestamps** (phone→host clock sync on
  the phone, host→page clock sync in the game, then S4's `AudioContext` output-timestamp
  mapping). Simulated phones with 25 ms send delay land at **−7…+11 ms mean offset**; a forced
  +60 ms lateness is measured as **+55…+66 ms**. Page↔host clock error ±0.4–0.5 ms.
- **Verified without phones:** 4 E2E scenarios (real S1 host + S1 simulated phones +
  headless Chrome 155) pass, plus S1's **real phone page** (mobile emulation, touch mode)
  driven through Silent Night: **32/32 Perfect**, next-zone glow correct 11/11.
- **Not verified:** real phones' motion ringing in a game (S1 physical tests still pending),
  iPhone, TV audio latency, Edge/Firefox/Safari as the TV browser.
- **Owner action:** play it on the TV with real phones — [runbook](../../spikes/i2-web-phones/README.md#owner-runbook-tv-playthrough-10-minutes).

## What was built

| Requirement | Implementation |
|---|---|
| Game receives HGP rings | The game page connects to the S1 Node host on the same PC as a `dashboard` client (`ws://127.0.0.1:8080/hgp`), runs S1's `ClockSync` against the host clock, and receives every gesture relayed with its `th` (source time on the host clock). `HgpInputSource` (an S4 `InputSource`) maps `th` → page `performance.now()` → song time. Unsynced rings are dropped, never judged by arrival. |
| Multiple ringers on one screen | `MultiHighway`: 1–4 S4 `HighwayRenderer`s side by side (one canvas/WebGL context each, created once and reused), presented to S4's unchanged `Session` as one renderer over the team chart's global lanes. All highways are framed for 4 lanes so strike lines line up; name/stats in a footer band. |
| S5 charts, song/difficulty/ringers | `npm run charts` runs S5's pipeline (`loadSong` + `buildChart`) with the `phone-4zone` profile for 1–4 ringers (16 carols × 3 tiers × 4 counts; the song list is generated from S5's `songs/manifest.json`). `buildTeamChart` turns a part into one S4 chart + per-ringer sub-charts. |
| Bell assignment to phones | New S1 host command `assign-bells` (explicit `bells[]` + optional `ringer` label) → HGP `assign` with `select: "zones"`. Sounding pitch = written + 12 (handbells sound an octave up; `?octave=0` to disable). |
| Team score / phone sound | S4 `Judge` over all lanes = team score/streak/multiplier; per-ringer stats via a new `Session.onJudgement` hook. Phones ring locally (`sound: device`, S1's recommendation); "Phones + TV" / "TV only" switch in the lobby. |
| QR join on the game screen | The S1 host serves the built game at `/game/` (new `--game` flag) so the page loads `/qr.svg` and the join URL same-origin. |
| Next-bell cue | New HGP host→device `cues` (`at[]` host times + `bells[]`) sent at song start, and re-sent if the song→host-time mapping later moves by > 2 ms ([#18](https://github.com/dcuccia/go-go-harmoniyo/issues/18)); the controller glows the next zone (previously only in S1's metronome test). |

Lobby: QR + join URL, song/difficulty/ringer/sound pickers, one row per ringer (phone, "Host plays
this part" or Keyboard A S D F), phone list with sync/sensor state; ringing a phone flashes its
row and its lane. ![Lobby](media/i2-4-ringers-lobby.png)

Phone (S1 controller, mobile emulation) during Silent Night with I1's `assign.ringer` label and
lane-row zones; A4 is the next note: ![phone](media/i2-phone-controller.png)

Two phones + host ringing ringer 3 (note "Host rings: ringer 3"): ![2+host](media/i2-2-phones-plus-host-play.png)

### Seating chart (follow-up, 2026-10-24)

The owner found that re-assigning parts in the lobby was nearly impossible: the S1 host broadcast
`devices` every second and the lobby rebuilt every ringer `<select>` on each broadcast, so an
open dropdown collapsed within a second. Fixed at both ends — the host now broadcasts on change
(+ 3 s heartbeat) and the lobby patches the DOM in place — and the per-ringer dropdowns were
replaced by a **seating chart**: part cards (musical name from the chart's note roles, bells,
range, 1–5 difficulty meter) × player chips (phones, Keyboard, 🤖 TV plays), with drag-to-swap,
a stable picker that works with a TV remote, 🎲 Shuffle / 🔁 Rotate / ⚖️ Balance, and seats that
persist across songs, ringer-count changes and reconnects. Phones get a Jackbox-style **Pick
your part** list with *Swap with …?* and ✓ Ready (HGP `parts` / `claim` / `ready`). Verified by
unit tests and `npm run e2e:seating` (30 checks, including a regression check that the picker
survives device broadcasts). Runbook: [spike README](../../spikes/i2-web-phones/README.md).

![Seating chart lobby](media/i2-seating-lobby.png) ![Pick your part on a phone](media/i2-phone-part-picker.png)

### Fast rings, richer backing, performance SFX (follow-up, 2026-10-25)

From the owner's 4-player session:

- **Fast repeated rings** — *"a little too difficult to do multiple rings in rapid succession"*.
  Each phone now adapts its ring detector to its own notes (from `cues`): in 8th/16th passages
  the refractory follows the note spacing, flick-sized strokes count and both directions of a
  back-and-forth shake ring. Emulated (60 Hz, shake): 8ths/16ths at 100–140 bpm **23–44 % →
  92–98 %** of fast notes detected; max ring rate **2 → 9.3 rings/s**; false rings while idle
  unchanged. A per-phone **Normal / 🐇 Quick** sensitivity in the TV's phone list (HGP
  `assign.ring`). Details and limits: [S1 report](S1-report.md#fast-repeated-rings-eighth-and-sixteenth-notes).
- **Richer backing** — *"more sophisticated backing tracks"*. Songs are read as 4-bar phrases
  (`backing/phrases.ts`): drum fills (snare, tom run, brush swell or a sleigh-bell roll) at
  phrase ends with a soft crash on the next downbeat, a glockenspiel glissando up into every
  other phrase, bass variations in alternate phrases (walking through the third, octave leaps,
  alternating waltz bass), hi-hats in the march, celesta broken chords, a strings voice (the
  waltz pad, and a lift under the last phrase of the others) and a **ritardando ending**: after
  the bells' last note the chord is held (fermata) while glockenspiel and sleigh bells step down
  it with ever longer gaps. The song's tempo itself is untouched, so judging is unchanged.
- **Performance SFX** — *"special sound effects for feedback on performance"*: sparkle/chime at
  team-streak milestones (10, 25, 50, every 50), a whoosh when the multiplier goes up, a soft
  two-note "boop" for a miss (at most one per 3 s), a little brass fanfare on the current chord
  for a phrase with every note Perfect/Great, and applause at the end scaled by team accuracy
  (cheers from 80 %). All synthesised (`src/sfx/`), 10–25 dB under one bell and ducked a further
  9 dB while a bell rings; lobby **Sound effects** on/off + volume.

Evidence: unit tests (`test/backing.test.ts`, `test/sfx.test.ts`, S1 `test/detectors.test.ts`),
`npm run audio-check` ([results](../../spikes/i2-web-phones/results/backing-render.md):
OfflineAudioContext levels, onsets on their scheduled sample, ending decays to silence, 0.75×
practice speed on-sample), `npm run sim:fast` in S1, and the gating timing E2E.

### Alignment with I1 (YARG fork, PR #8)

I1 changed the same S1 controller. I2 takes I1's controller/HGP changes **verbatim** (optional
`assign.ringer` `{slot, title, song?}`, up to 5 zones, lane-row zones when `ringer` is set, the
`#ringer` label) so the two branches do not fork the controller, and sends the same `ringer`
field instead of a new one. Expected merge conflicts between #8 and this PR: `sendAssign()` in
`server.ts` (resolve as `ringer: yarg ? <I1 seat> : d.ringer`) and the docs index rows.

## Measurements

Environment: Windows 11 laptop, Intel Core Ultra 7 155H, Intel Arc iGPU (Chrome's default
adapter; RTX 2000 Ada present), Chrome 155 headless via Playwright, 1920×1080 viewport, audio
48 kHz, `getOutputTimestamp` available, reported output latency 40–48 ms + 10 ms base.
Simulated phones: S1's `tools/sim-phones.ts --game` (own clock offset + drift, 60 Hz sample
grid, detector back-dating, 25 ms send delay, ±20 ms human jitter, 3 % missed notes, 3 % wrong
zone, 300 ± 120 ms zone-touch lead). Reproduce: `npm run e2e` in `spikes/i2-web-phones`.

| Scenario | Result | Team score | Team acc. | Ringers (hit/notes, mean offset, p95 abs) | Ring→page p50 | Host clock err | fps |
|---|---|---|---|---|---|---|---|
| silent-night-easy-3 | PASS | 5470 | 90.7 % | Alice 7/7, −7.1 ms, ±32.9; Bob 23/26, 4.2 ms, ±39.9; Cara 12/13, −1.2 ms, ±34.1 | 36.6 ms | ±0.43 ms | 164.3 |
| jingle-bells-medium-4 | PASS | 25080 | 90.2 % | Alice 39/40, 1.8 ms, ±45.4; Bob 26/28, 7 ms, ±42.6; Cara 26/28, 10.8 ms, ±34.6; Dan 56/65, 5.7 ms, ±47.9 | 34.8 ms | ±0.43 ms | 164.2 |
| joy-easy-2-with-host (3 ringers, 2 phones) | PASS | 9310 | 94.2 % | Alice 21/22, −4.2 ms, ±54.9; Bob 16/16, 3.5 ms, ±57.9 | 32.3 ms | ±0.48 ms | 164.6 |
| silent-night-late60 (+60 ms lateness) | PASS | 4090 | 67.2 % | Alice 7/7, 54.6 ms; Bob 23/26, 65.9 ms; Cara 12/13, 58.2 ms | 33.7 ms | ±0.43 ms | 164.8 |

- Misses match the injected 3 % missed notes + 3 % wrong zones; no unsynced or unmapped rings.
- "Ring→page" (gesture source time → game page received it) p50 33–37 ms, p95 42–52 ms: the
  simulated 25 ms detection/send delay + 60 Hz back-dating + two WebSocket hops. Judging does not
  depend on it (late60 proves the judge sees source time, not arrival).
- Rendering: 4 highways with bloom + particles, frame p95 6.2 ms at the 165 Hz panel rate.
- Real controller page (`scripts/controller-check.mjs`, Pixel 7 emulation, "Touch: on", taps
  via CDP at note times): 32/32 hits, all Perfect, mean +6.8…+10 ms (CDP input latency),
  ring→page 13 ms; next-zone glow correct 11/11 samples.

### Timing under load: the flaky E2E ([#18](https://github.com/dcuccia/go-go-harmoniyo/issues/18), 2026-10-24)

The timing E2E failed intermittently on a busy PC, including on unmodified `main`, and in all four
CI runs on GitHub's runners (hit rates 30–70 %). We added instrumentation for every clock in the
chain, which the E2E now prints when a scenario fails. It found two causes, both in the game
rather than in the test.

1. **Valid rings were thrown away (the hit-rate failures).** S4's `Session` declared a note
   missed 140 ms (the good window) after it was due, using the current frame's time. Rings are
   judged on source time, but they arrive later. On a quiet loopback they reach the page 30–40 ms
   after the strike. Wi-Fi power save adds up to ~200 ms (S1), and a ring that arrives during a
   long frame waits behind the next rAF callback. When the sweep ran first, a ring timed
   correctly became a miss plus a stray. Measured on the unmodified code with 16 busy CPU threads:
   ring→page p95 225 ms, max 635 ms, frames up to 1.8 s. In one run Dan scored 45/65 although his
   phone rang 59 notes, 14 of them as strays. A real player on real Wi-Fi hits the same thing.
   **Fix:** the sweep runs one frame behind (`lastCpu0`), minus a `missGraceMs` (new
   `SessionOptions` field, default 0 so S4's keyboard behaviour is unchanged). I2 uses
   250 ms, stretched to the slowest of the last 32 rings' arrival (capped at 1 s). The only visible
   effect is that a "miss" appears up to 250 ms later.
2. **The phones' cues could be stale (the uniform +80 ms).** Cues (host times of each note) were
   sent once, at song start, from that moment's song→host-time mapping. That mapping chains the
   page↔host clock sync and the audio clock, and both can still move near page start-up. We
   measured the page's first host-sync estimate (a sample timed through a long task) as 65–571 ms
   off until a clean exchange reset it. The audio clock also re-anchored by 50–826 ms, repeatedly,
   while Chrome's audio output started under load. If either correction lands after the cues,
   every phone is offset by the same amount. **Fix:** cues are re-sent when the mapping moves by
   more than 2 ms (the phone controller already handles a fresh `cues` list). The audio clock is
   now updated in the lobby too, so it has settled before a round. Autostart (`?start=play`,
   kiosk/E2E only) also waits for a host sync bound ≤ 10 ms (up to 20 s) and for an audio clock
   with no re-anchoring in the last second (up to 10 s).

Test harness changes. The simulated phones seed their jitter, miss and wrong-zone draws from the
part, so a part gets the same "performance" whichever phone plays it. A re-cue reschedules only the
notes not yet rung. The phones also run above normal priority, because they stand in for separate
devices whose CPUs the PC's load can't stall. Each player must hit every ring that their phone
sent on the right bell (±1). The mean-offset tolerance is 4.5 standard errors of the ring jitter
(σ ≈ 20.6 ms), but never below 12 ms per player or 6 ms for the team: ±35 ms for a 7-note part
and ±7–15 ms for the pooled team. The old fixed thresholds (≥ 80 % hits, ±12 ms per player) were
1–2 σ events for the small parts. The E2E hosts use ports 18080+ (`--port`).

| Run (Core Ultra 7 155H, Chrome 155 headless) | Result |
|---|---|
| Before, 16 busy threads (`--load=16`) | 4/7 suite runs passed; every failure was hit rate (rings dropped as strays) |
| After, 16 busy threads | **24/25 suite runs (99/100 scenarios)**; worst per-player mean-offset error 6.5 ms. The one failure: rings sent 0.5–2.0 s late during a single 2 s stall of a Node process, beyond the 1 s grace cap |
| After, no extra load, repeated suite runs (stopped at 36 of 50 planned) | **35/36 runs (143/144 scenarios)**; worst cue-anchor drift 1.1 ms. The one failure: the S1 host relayed three rings 0.5–1.0 s late, although the phones sent them on time (≤ 16 ms) and the page had no long frame. That is a single ~1 s stall in the host process, beyond the grace (follow-up) |
| After, GitHub `ubuntu-latest`, no GPU (SwiftShader), default quality | PASS: **2.5 fps**, ring→page p50 450–570 ms, every player's mean offset within 7 ms of target |

## Answers to the brief

1. **Phones → game over the S1 host, judged on source timestamps:** yes, as designed
   (ADR-0002/0006): two chained clock syncs, then S4's audio-clock mapping. The page↔host hop on
   localhost adds ±0.5 ms. Real-Wi-Fi accuracy is S1's open physical test.
2. **Multiple ringers on one screen:** side-by-side per-ringer highways (Rock Band style); in
   1080p screenshots names and note names are large and each player's lanes are distinct at
   2–4 players. A single shared highway with per-ringer lane groups (up to 16 lanes) was not
   built. Ringers with fewer bells get narrower highways at the same scale. Couch readability
   on the real TV is for the owner to judge.
3. **S5 charts + bell assignment:** yes; charts generated with `phone-4zone`. Overflow remains:
   1-ringer parts need 8–11 bells, 2-ringer parts 4–8, 4-ringer hard parts up to 5–6 — the
   TV rings the least-used overflow bells (shown in the lobby and on the HUD).
4. **Team score/streak; phone-local sound:** yes; host sound optional per lobby setting.
5. **QR join on the game screen:** yes (lobby).

## Platform notes

- TV host: tested Chrome 155 on Windows (headless). Edge is the same engine (`--channel=msedge`
  in the scripts); Safari/Firefox untested. The game page must run on the PC that runs the S1
  host (it uses the loopback listener); `npm run dev` also works against a host on port 8080.
- Phones: unchanged from S1 — WSS on LAN with a one-time self-signed-cert warning; iOS untested.
  On iPhone the silent switch may mute the phone's bell: use "Phones + TV".
- WebKit smoke test (#27, `node scripts/webkit-controller-check.mjs`, CI job `webkit-smoke`): S1's
  phone page in Playwright WebKit 27.2 with an iPhone 15 profile over HTTPS (self-signed) passes on
  Linux (15/15 checks: permission requested and Web Audio unlocked inside the tap, join, *Pick your
  part*, touch → zone, next-zone glow 65/65, synthetic motion rings judged 63/65) and on Windows
  (14/15; Playwright's Windows WebKit has no Web Audio, so that check is skipped). No WebKit-specific
  failures found. Emulation can't show real sensors, the silent switch, the real certificate bypass,
  Wake Lock or backgrounding ([results](../../spikes/i2-web-phones/results/webkit-controller-check.md));
  the real iPhone test is #31/#34.
- Each highway is one WebGL context (≤ 4 + none elsewhere), well under browser limits.

## Known limits / next steps

- Real phones: S1's physical tests (detection %, false rings) haven't been run; the first TV
  playthrough doubles as that test. Phones must be calibrated (6 rings) before play.
- Wrong-zone rings count as stray rings (the expected note becomes a miss); no damp/LV scoring.
- Count-in and a procedural backing track have since been added (see the spike README). Practice
  speed (50–100 %, owner feedback 2026-10-25: "even Easy is a steep learning curve") stretches the
  chart so everything slows down together while judging windows stay in real time; the e2e plays a
  song at 50 % with the same offset tolerances. No loop-a-section mode yet.
- Drop-in joining (owner feedback 2026-10-25): a corner QR stays on screen during songs and results;
  phones that join mid-song wait and get the first TV-played part at the next round. Follow-up:
  live takeover of a TV part mid-song (needs a cue/highway handover inside a round).
- The richer backing (phrases, fills, ritardando ending) is generated from the stretched chart, and
  the performance SFX are event-driven, so both follow practice speed.
- A/V offset is global; per-phone latency offsets (HGP v1) would help mixed iOS/Android groups.
- `cues` are sent once at song start (a phone that reconnects mid-song loses its glow).
- Charts: S5's assignment is not phone-aware enough for 1–2 ringers; consider a "max 4 bells"
  hard constraint with melody-first dropping.

## Licenses

All code MIT (repo). No new assets: S5 charts (CC0 / public domain, per-song licence in each
chart), S4's and S1's synthesized bell sounds; the backing and performance SFX are synthesised
live from code (no samples or audio files, nothing to register). New npm dev dependencies are MIT/Apache-2.0
(see the spike README).
