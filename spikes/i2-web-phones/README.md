# I2 — Phones → web host (integration spike code)

Real phones (S1 controller + HGP v0 host) play the S4 web-native host with S5 carol charts,
2–4 ringers on one TV. Report: [docs/spikes/I2-web-phones.md](../../docs/spikes/I2-web-phones.md).

```
phones ──WSS (LAN, self-signed)──▶ S1 Node host ◀──WS (127.0.0.1)── game page on the TV
 (S1 controller: rings, zones,        (HGP v0 relay, QR,              (this folder: S4 renderer/judge/
  local bell sound, cue glow)          serves the game at /game/)       session/audio + S5 charts)
```

Code reuse (imported, not copied): S4 `HighwayRenderer`, `Session`, `Judge`, `Hud`,
`AudioEngine`, `KeyboardSource`; S1 `ClockSync` + HGP types; S5 `loadSong`/`buildChart`
(charts are generated at build time with the `phone-4zone` profile, 1–4 ringers).

## Owner runbook (TV playthrough, ~10 minutes)

**You need:** the Windows PC connected to the TV (HDMI), Node ≥ 22, Chrome or Edge, 1–4 phones
on the **same Wi-Fi** as the PC. First run downloads npm packages (~1 min).

1. On the PC, in this folder:
   ```sh
   cd spikes/i2-web-phones
   npm install
   npm start                      # builds the game, starts the S1 phone host, opens the game
   ```
   If the PC has several network adapters and the QR shows the wrong address, use
   `npm start -- --ip 192.168.x.y`. Allow Node through the Windows firewall (Private networks)
   if Windows asks.
2. The browser opens **http://127.0.0.1:8080/game/** — drag it to the TV and press **F11**.
3. Each ringer scans the QR on the TV. The phone warns about the certificate **once**
   (Chrome: *Advanced → Proceed*; Safari: *Show Details → visit this website*). Type a name,
   tap **Tap to start**, allow motion, then **ring 6 times** to calibrate (the banner counts down).
4. The TV lobby lists the phones. Ring a phone: its row flashes and its lane lights on the TV.
   Each phone shows its ringer number, song and its bells as coloured zones in the same order
   and colours as its highway on the TV.
5. Pick **Song**, **Difficulty** (start with Easy) and **Ringers** (defaults to the number of
   phones). Each *Ringer* row can be a phone, **Host plays this part** (the TV rings it) or
   **Keyboard** (A S D F). Bells beyond 4 per ringer are rung by the TV automatically.
   **Backing track** (on by default, volume 50 %) adds a festive groove from the song's chords
   on the TV — sleigh bells, light drums, bass and an organ/pad, styled per song (see below).
   **Count-in** plays woodblock clicks on the beat before the first note (a pickup comes in on
   its beat). Both settings are saved on this PC.
6. **▶ Play** (or Enter). Touch a zone to pick a bell (the next one glows), swing to ring.
   The phone makes the bell sound; the TV plays only the parts nobody holds, plus the backing.
   Change *Bell sound* to "Phones + TV" or "TV only" if a phone is silent (iPhone silent switch).
7. Results show the team score and a row per ringer (hits, misses, timing). **Again** / **Lobby**.
   Esc returns to the lobby any time.

Tips: if hits feel consistently early/late on the TV, use ←/→ (A/V offset, 5 ms steps;
Shift = 20 ms) — it is saved. `` ` `` shows timing stats (clock sync, ring→TV latency).
Please send back: the results JSON (*Copy JSON*), the host's `data/<session>/` folder from
`spikes/s1-phone-bell/data/`, and how it felt.

### Backing track (procedural)

Try it first with **Jingle Bells · Easy · 1 ringer** (sleigh-ride groove under the melody),
then **Silent Night · Easy** (gentle), **We Wish You a Merry Christmas** (waltz) and **Joy to
the World** (march). *Autoplay demo* plays the bells and the backing together without phones.

| Style | Songs | What plays |
|---|---|---|
| Sleigh ride | Jingle Bells, Deck the Halls | sleigh bells on every eighth (shake on 2 and 4), kick on 1/3, brushy snare on 2/4, walking bass, drawbar organ |
| March | Joy to the World, Good King Wenceslas | kick on strong beats, soft snare, sleigh bells on the beat, root–fifth bass on every beat, organ |
| Waltz | We Wish You a Merry Christmas, The Holly and the Ivy | "oom-pah-pah": bass + soft kick on 1, organ stabs, brushes and sleigh bells on 2 and 3 |
| Gentle | Silent Night, It Came Upon the Midnight Clear | no drums: soft brushes, a sleigh shimmer per bar, bass on the downbeat, warm slow pad |

How it works: the S5 pipeline writes each song's chords and beat grid into the chart
(`harmony`, chart format 0.2; chords come from the lead sheet, or are inferred from the
Mutopia scores). `src/backing/` turns them into a deterministic pattern and synthesises it with
Web Audio; the events go into S4's `Session` scheduler, so they are timed on the AudioContext
clock with the same song timeline as the bells, highways and judging (no drift; tempo changes
followed beat by beat). Bass and inner bells of the chosen part — whether a phone or the TV
rings them — are kept out of the backing: the backing bass rests while a bass bell sounds, and
the pad leaves out pitch classes an inner bell is holding. The groove sits about 12–14 dB
under the bells at the default volume (`npm run audio-check`). Backing settings are read when a
song starts (change them in the lobby, not mid-song). Charts without `harmony` play as
before, with no backing (the count-in then uses the first tempo and meter).

## Other commands

| Command | What |
|---|---|
| `npm run dev` | Vite dev server (http://localhost:5173) — connects to an S1 host already running on port 8080 (`cd ../s1-phone-bell && npm start`). |
| `npm test` | Unit tests (chart → team chart mapping; backing chord timeline, count-in and patterns). |
| `npm run build` | Typecheck + build to `dist/` (also regenerates `public/charts/`). |
| `npm run e2e` | End-to-end without phones: real S1 host + S1 simulated phones (`tools/sim-phones.ts --game`) + headless Chrome. Add `-- --shots` for screenshots, `-- --channel=msedge` for Edge. |
| `npm run audio-check` | Renders the backing for four carols (one per style) with `OfflineAudioContext` in headless Chrome: no clipping, level under the bells, count-in/downbeat onsets on their scheduled sample, silence after stop. Writes `results/backing-render.md`. |
| `node scripts/controller-check.mjs` | Drives S1's real phone page (mobile emulation, touch mode) through a song. |
| `npm run charts` | Regenerate `public/charts/` from S5 (`-- --profile handbell --ringers 3,4,5` for the S5 defaults). |

URL parameters on the game page: `song`, `diff`, `ringers`, `sound` (`device`·`both`·`none`),
`start=play|autoplay` + `waitPhones=N` (kiosk/E2E autostart), `hgp=ws://host:port/hgp`,
`octave=0` (play written pitch instead of handbell sounding pitch), `bloom=0`, `particles=0`,
`dpr`, `vis`/`inp` (offsets, ms), `stats=1`, `backing=0|1`, `backingVol=0–100`, `countin=0|1`.

## Changes made to the other spikes (additive)

- **S1** host: `--game <dir>` serves a static game at `/game/`; dashboard commands
  `assign-bells` (explicit bells + optional `ringer` label, the `assign.ringer` field from I1)
  and `cues` (relayed to one phone). Controller: glows the next zone from `cues`; takes I1's
  `assign.ringer` label and lane-row zones verbatim. `tools/sim-phones.ts --game` rings cued
  notes (with jitter, misses, wrong zones, `--late`).
- **S4**: `Session` accepts any renderer/HUD with the same methods, an `onJudgement` hook and
  `hostRingSound`; `HighwayRenderer` `fitCanvas`/`fitLanes` options. Lane, gem and phone colours
  come from the shared pitch-class palette (`spikes/shared/pitch-palette.ts`, #12), so a bell
  keeps its colour on every highway and phone. S4's own app behaves as before.
  For the backing: `Session` options `extraEvents` (extra audio events on the chart's
  AudioContext timeline, negative times allowed for a count-in) and `leadIn`;
  `AudioEngine.connect(node, reverb)` mixes an external bus in with the bells.
- **S5**: charts carry an optional `harmony` block (format 0.2.0: chords, beat grid, backing
  style; chords inferred where the source has no chord symbols); see the S5 README.

## Licenses

Code: MIT (repo). No third-party assets: charts are generated from S5's CC0/public-domain
sources (licence per song in each chart's `song.license`); bell sound is S4's additive synth
on the TV and S1's synth on the phones. The backing track (sleigh bells, drums, bass, organ/pad,
count-in) is synthesised live with Web Audio from code in `src/backing/` — no samples or audio
files, so there is no media to register. npm dependencies: three (MIT), vite (MIT), vitest (MIT),
typescript (Apache-2.0), playwright-core (Apache-2.0).

Platform notes for the backing: it runs on the TV host only; phones are unchanged. Verified in
Chrome on Windows (unit tests, `npm run audio-check`, E2E); Edge/macOS/Linux/ChromeOS hosts use
the same standard Web Audio nodes and are expected to behave the same but are untested. A TV
over HDMI/Bluetooth delays the backing exactly like the host bells (same AudioContext), which
`getOutputTimestamp()` and the A/V offset already account for.
