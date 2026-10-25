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
on the **same Wi-Fi** as the PC (or any network with `--tunnel`). First run downloads npm packages
(~1 min).

1. On the PC, at the **repo root** (a fresh clone is fine):
   ```sh
   npm start                      # checks the setup, installs, builds, starts the phone host, opens the game
   ```
   It first runs the [start-up checks](#start-up-checks-and-troubleshooting) and stops with a
   fix if something would get in the way (old Node, a busy port). Read any **!** warnings: they
   cover the wrong network adapter, the Windows Firewall and guest Wi-Fi. When the game is up it
   prints the **TV** and **Phones** addresses. **Ctrl+C** stops it.
   Options go after `--`, e.g. `npm start -- --ip 192.168.x.y` (another adapter) or
   `npm start -- --tunnel` (guest/work Wi-Fi, or phones on mobile data). `npm start` in this
   folder does the same.
2. The browser opens **http://127.0.0.1:8080/game/** — drag it to the TV and press **F11**.
3. Each ringer scans the QR on the TV. The phone warns about the certificate **once**
   (Chrome: *Advanced → Proceed*; Safari: *Show Details → visit this website*). Type a name,
   tap **Tap to start**, allow motion, then **ring 6 times** to calibrate (the banner counts down).
4. The TV lobby lists the phones. Ring a phone: its row flashes and its lane lights on the TV.
   Each phone shows its part, song and its bells as coloured zones in the same order
   and colours as its highway on the TV.
5. Pick **Song**, **Difficulty** (start with Easy) and **Ringers** (defaults to the number of
   phones that have joined). **Who plays what** is a seating chart: one card per part, named
   musically where the arrangement allows (*Melody*, *Bass*, *Harmony*, *Low/High melody*…, else
   *Ringer N*), with its bells in their colours, range and a 1–5 difficulty meter (notes and
   bell changes per second). Above the cards are the player chips: each phone, ⌨ **Keyboard**
   (A S D F) and 🤖 **TV plays** (the TV rings that part; any part nobody holds).
   - **On the TV:** drag a chip onto a part (onto a taken part = swap; drag a part's chip back to
     the chip row = sit out), or click a part and choose who plays it. TV remote / keyboard:
     **↓** to reach the part cards, **← →** to move, **Enter** to open, **↑ ↓ Enter** to choose,
     **Esc** to close.
   - **On the phones:** the phone shows **Pick your part** with each part's name, bells, range,
     difficulty and who has it. Tap a part the TV plays to take it; tap someone's part and then
     **⇄ Swap with Bob?** (their name) to swap at once. **I'm ready** toggles ✓ Ready (shown on the TV);
     **▶ Play** works whether or not everyone is ready.
   - **🎲 Shuffle** deals random parts, **🔁 Rotate** moves everyone one part to the right, and
     **⚖️ Balance** gives the easiest part to whoever has the lowest accuracy in this session's
     earlier rounds (random before the first round).
   - Seats stick across songs and difficulties. If the number of ringers changes, players keep
     a part with the same name (or position). A phone that joins late takes the first part the
     TV is playing; if a phone drops out the TV plays its part until it reconnects and takes it
     back.
   Bells beyond 4 per part are rung by the TV automatically.
   **Backing track** (on by default, volume 50 %) adds a festive groove from the song's chords
   on the TV — sleigh bells, light drums, bass and an organ/pad, styled per song (see below).
   **Count-in** plays woodblock clicks on the beat before the first note (a pickup comes in on
   its beat). Both settings are saved on this PC.
   **Practice speed** (50–100 % in 5 % steps, default 100 %) slows the whole song down for
   first-time players: highways, the phones' next-zone glow, the backing groove and the count-in
   all follow, and the song list shows each song's length at that speed. Timing is judged the same
   in real time (a ring 40 ms late is as late at 50 % as at 100 %). The HUD, the results and the
   phones show the speed when it isn't 100 %. It is remembered until the browser closes (or
   `?speed=50` in the URL). It works with any difficulty: try **Easy at 60–70 %** for a first round.
6. **▶ Play** (or Enter). Touch a zone to pick a bell (the next one glows), swing to ring.
   The phone makes the bell sound; the TV plays only the parts nobody holds, plus the backing.
   Change *Bell sound* to "Phones + TV" or "TV only" if a phone is silent (iPhone silent switch).
7. Results show the team score and a row per ringer (hits, misses, timing). **Again**,
   **🔁 Rotate + Again** (everyone moves one part) or **Lobby**. Phones can pick parts on the
   results screen too; changes apply to the next round. Esc returns to the lobby any time.
8. **Joining mid-game:** during a song and on the results screen a small QR code and the join
   address stay in the top-left corner of the TV. Someone who scans it while a song plays sees
   **You're in!** on their phone (a part comes when the next song starts) and the TV shows
   **+1 waiting** with their name. When the next round starts (Again, 🔁 Rotate + Again, or a new
   song from the lobby) they get the first part the TV is playing (or their old part if they
   rejoin); on the results screen they can also pick a part themselves. Nobody's part changes
   mid-song. The corner QR hides in the lobby (the big one is there), while `--tunnel` is still
   getting its address, and if the phone host stops. `?joinQr=0` turns it off,
   `?joinQrCorner=tr|bl|br` moves it, `?joinQrSize=200` sets its size in pixels.

**With 2+ phones, please try:** take the part the TV is playing from a phone; swap two phones
from a phone (*Swap with …?*) and by dragging on the TV; open a part's chooser on the TV and keep
it open while someone presses Ready (it must stay open); 🔁 Rotate + Again after a round; turn
one phone's screen off for a few seconds (the TV takes its part) and back on (it gets it back);
a first round at **60 % practice speed**; and have someone scan the **corner QR during a song**
(their phone says *You're in!*, the TV *+1 waiting*; press **Again** and they play the TV's part).

Tips: if hits feel consistently early/late on the TV, use ←/→ (A/V offset, 5 ms steps;
Shift = 20 ms) — it is saved. `` ` `` shows timing stats (clock sync, ring→TV latency).
Please send back: the results JSON (*Copy JSON*), the host's `data/<session>/` folder from
`spikes/s1-phone-bell/data/`, and how it felt.

### Start-up checks and troubleshooting

`npm start` (repo root or this folder) runs `scripts/start.mjs`: it checks the setup, installs
missing packages (`npm ci` in `spikes/s1-phone-bell`, `spikes/s4-web-host` and here, when
`node_modules` is missing or older than `package-lock.json`), builds the game, then runs the S1
host with `--game dist`. `npm run preflight` at the root (or `npm start -- --check`) runs only
the checks and exits with 1 if something blocks the start. The checks only read the system; each
problem prints a fix for you to run.

| Check | ✗ stops / ! warns | What it says to do |
|---|---|---|
| Node.js older than 22 | ✗ | `pwsh tools/setup/setup-web.ps1 -AllowElevation`, or install the LTS from nodejs.org |
| Port 8080 (TV page) or 8443 (phones) in use | ✗ | Names the program (PID). An old host (`node.exe`): Ctrl+C in its window. Docker/WSL: stop the container. Or `--http-port`/`--port` with a free port it suggests |
| No private IPv4 address (only VPN, virtual or 169.254.x.x adapters) | ! | Join the same Wi-Fi as the phones, or `--tunnel` |
| Several adapters | i | Prints the address phones will use and each alternative as `npm start -- --ip …`. Wi-Fi is preferred because phones are on Wi-Fi; virtual and VPN adapters (WSL, Hyper-V, Docker, NordLynx, Tailscale…) are ignored |
| Windows Firewall (reads the Node.js rules and the network's Private/Public type) | ! | Network is Public but Node is allowed only on Private: make the network Private (Settings → Network & internet → Wi-Fi → network → Private) or `--tunnel`. A *Block* rule (Cancel on the prompt): how to remove it. No rule yet: tick **Private networks** when Windows asks. If it can't tell, a reminder to allow Node on Private networks |
| Guest or work (domain) network | ! | Guest Wi-Fi keeps devices apart: use home Wi-Fi or `--tunnel` |
| `--tunnel` without cloudflared | ✗ | `winget install --id Cloudflare.cloudflared`. A portable copy in `%LOCALAPPDATA%\Programs\cloudflared` (or WinGet Links, Program Files) works without being on PATH |

The Windows network and firewall checks can take a few seconds on a busy PC; they run while
the game builds, and if they take over 10 s more, their result is printed after the host starts.
The QR code works as soon as the tunnel address arrives (#19); if cloudflared gives no address in
45 s, the launcher says so.

Not detected: client isolation on a Wi-Fi that isn't named like a guest network, and third-party
firewalls. If the phones can't open the join page, try `npm start -- --tunnel`. The certificate
warning on the phones and help on the TV are [#26](https://github.com/dcuccia/go-go-harmoniyo/issues/26)
(the host prints the certificate tip in the console).

**macOS and Linux (untested):** the same command and checks run. Port owners come from `lsof`
(if installed). Wi-Fi is recognised as `en0` (macOS) or `wl*`/`wlan*` (Linux). Instead of the
Windows Firewall check there is a reminder: macOS asks whether `node` may accept incoming
connections (click Allow); on Linux, open TCP 8080 and 8443 in `ufw`/`firewalld` if a firewall is
on. cloudflared is found on PATH or in `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`,
`~/.local/bin`. The browser opens with `open` / `xdg-open`.

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
| `npm test` | Unit tests (chart → team chart mapping; seating chart: claim/swap, seeded shuffle, rotate, balance, persistence across ringer-count changes, late join, disconnect/reconnect; drop-in join queue: mid-song joiners wait and are seated first come first served; practice speed: 5 % steps, chart/tempo/beat-grid stretching, judging windows in real time, backing and count-in follow, slow-motion scroll, every generated tier; part names and difficulty; backing chord timeline, count-in and patterns; start-up checks: adapters, ports, firewall rules, cloudflared). |
| `npm start -- --check` | Start-up checks only (same as `npm run preflight` at the repo root). `npm start -- --help` lists the options. |
| `npm run build` | Typecheck + build to `dist/` (also regenerates `public/charts/`). |
| `npm run e2e` | End-to-end without phones: real S1 host + S1 simulated phones (`tools/sim-phones.ts --game`) + headless Chrome. Five scenarios, one at 50 % practice speed (the stretched song, rings still judged in real time against the same offset tolerances). Add `-- --shots` for screenshots, `-- --channel=msedge` for Edge. Hosts use ports 18080+ (`-- --port=N`), so a host you are running on 8080 is not in the way. Flake hunting: `node scripts/e2e.mjs --repeat=50 [--load=16] [--bail]` runs the suite N times (optionally with N busy CPU threads) and appends one row per scenario to `results/e2e-repeat.ndjson`. A failing scenario prints its timing evidence (cue-anchor drift, audio clock re-anchorings, host clock-sync jumps, long frames, ring arrival latency, strays, each phone's ring plan); see [#18](https://github.com/dcuccia/go-go-harmoniyo/issues/18). Runs in CI (`.github/workflows/i2-web-phones.yml`). |
| `npm run e2e:seating` | Seating chart end-to-end: real S1 host, two S1 phone pages in mobile emulation (Alice, Bob) and one S1 simulated phone (Cara, `--claim`/`--ready`): phone claim, swap, Ready, TV picker by keyboard, drag, 🔁/🎲, late join, disconnect → TV → reconnect reclaims, Play without everyone Ready, and the regression for the collapsing dropdown (the picker survives device broadcasts). Writes `results/seating-e2e.json`; `-- --shots` captures `i2-seating-lobby.png` and `i2-phone-part-picker.png`. |
| `npm run e2e:dropin` | Drop-in + practice speed end-to-end (port 18600): the lobby speed control (5 % steps, kept across a reload), Alice plays at 50 % (HUD badge, phone label, stretched song, results line), Bob joins mid-song from a phone page (*You're in!*, TV corner QR + *+1 waiting*, seats unchanged), results (*Joining: Bob*, he can pick a part), **Again** seats him in the TV's part, the corner QR hides in the lobby and with `?joinQr=0`. Writes `results/dropin-e2e.json`; `-- --shots` captures `i2-ingame-join-qr.png`, `i2-results-join-qr.png` and `i2-phone-waiting.png`. |
| `npm run audio-check` | Renders the backing for four carols (one per style) with `OfflineAudioContext` in headless Chrome: no clipping, level under the bells, count-in/downbeat onsets on their scheduled sample, silence after stop. Writes `results/backing-render.md`. |
| `node scripts/controller-check.mjs` | Drives S1's real phone page (mobile emulation, touch mode) through a song. |
| `node scripts/webkit-controller-check.mjs` | WebKit smoke test (#27): S1's phone page in Playwright **WebKit** with an iPhone profile (`--device="iPhone 15"`) over HTTPS with the self-signed certificate, TV page in Chrome. Tap to start (stubbed `DeviceMotionEvent.requestPermission`), Web Audio unlock, joining and *Pick your part*, zones and the next-zone glow, and synthetic `devicemotion` rings (calibration, lobby practice, then the song's notes) reaching the host. Needs `npm run build` and, once, `npx playwright-core install webkit` (Linux: `--with-deps`; use `playwright-core`, already a dev dependency, so the browser matches its version). Writes `results/webkit-controller-check.{json,md}`, including what emulation can't show. An early signal, not a substitute for a real iPhone. |
| `npm run charts` | Regenerate `public/charts/` from S5 (`-- --profile handbell --ringers 3,4,5` for the S5 defaults). |

CI ([`.github/workflows/i2-web-phones.yml`](../../.github/workflows/i2-web-phones.yml)) runs on changes to
this folder, S1, S4, S5, `spikes/shared` or the palette: `npm ci`, `typecheck`, `test`, `build`, the
S4 and S5 unit tests, `e2e:seating` and `e2e:dropin`, plus `npm run e2e` in its own job (all gating; the timing
e2e has gated since [#18](https://github.com/dcuccia/go-go-harmoniyo/issues/18)); the WebKit smoke
test runs in an informational job (results in the job summary).

URL parameters on the game page: `song`, `diff`, `ringers`, `sound` (`device`·`both`·`none`),
`start=play|autoplay` + `waitPhones=N` (kiosk/E2E autostart; waits for a tight host clock sync and a settled audio clock), `hgp=ws://host:port/hgp`, `missGrace` (ms a note waits for an in-flight phone ring before it is a miss; default 250, stretched to recent ring latency),
`octave=0` (play written pitch instead of handbell sounding pitch), `bloom=0`, `particles=0`,
`dpr`, `vis`/`inp` (offsets, ms), `stats=1`, `backing=0|1`, `backingVol=0–100`, `countin=0|1`,
`speed=50–100` (practice speed, %), `joinQr=0` (no corner QR during play), `joinQrCorner=tl|tr|bl|br`,
`joinQrSize=px`, `seed=N` (deterministic 🎲 Shuffle / ⚖️ Balance, for tests).

### Drop-in joining and practice speed: how they work

**Drop-in.** `src/join-queue.ts` (pure, unit-tested) notes phones that *arrive* while a round is
on screen (song or results) and are not in it; phones already in the round (a screen that went off
and back on) and phones that chose to sit out are not queued. The game sends the queue to the S1
host with `parts` (`waiting`); the host tells each of those phones `next: true` and the controller
shows *You're in!* during the song (and a hint above *Pick your part* on the results screen). When
the next round is set up, the queue is seated first, in join order, with the seating chart's
normal rules (`Seating.join`: home part if the TV plays it, else the first TV-played part); if
there is no free part they go to the bench like a late joiner in the lobby. Follow-up, not built:
taking over a TV-played part in the middle of a song (needs cues and a highway handover mid-round).

**Practice speed.** `src/speed.ts` stretches the S5 chart once: every song time and duration
(`time` and `…Sec` fields, the schema's seconds) × 1/speed and every tempo × speed; ticks, beats,
bars, pitches and parts are unchanged. Everything downstream already reads song seconds from that
chart — team chart and highways, the judge, the phones' cues, the backing groove and count-in (from
the stretched beat grid), the miss sweep — so it all slows down together and the judging windows
(± 45/90/140 ms) stay the same in real time. The highways scroll at speed × their normal rate and
show notes 1/speed earlier, so the picture looks the same in slow motion
(`HighwayRenderer.setScroll`). Bell pitches and the synthesised backing are not resampled. Difficulty
tiers are independent: speed applies to whichever part the lobby picks.

### Seating chart: how it works

`src/seating.ts` is the model (pure, unit-tested): a seat per part holding a phone's deviceId,
`keyboard` or `tv`, plus each player's "home" (last part name + index) for reconnects and
arrangement changes. `src/parts.ts` names the parts from the S5 note roles (majority role per
ringer; repeated roles are qualified low → high) and rates difficulty as
(notes + ½ bell changes) per second → 1–5. `src/seating-view.ts` renders the TV chart **in place**:
part cards are rebuilt only when the arrangement changes, everything else is patched per element,
and the picker is a separate element that stays open across updates. The game rebuilds the lobby
only when phones join, leave or are renamed; Ready/sync/heartbeat broadcasts patch it in place.
(The old lobby rebuilt every ringer `<select>` on each 1 s device broadcast, which closed an open
dropdown within a second.) Phones talk to the seating through HGP `parts` / `claim` / `ready`
([hgp-v0.md](../../docs/protocol/hgp-v0.md)).

## Changes made to the other spikes (additive)

- **S1** host: `--game <dir>` serves a static game at `/game/`; dashboard commands
  `assign-bells` (explicit bells + optional `ringer` label, the `assign.ringer` field from I1)
  and `cues` (relayed to one phone). Controller: glows the next zone from `cues`; takes I1's
  `assign.ringer` label and lane-row zones verbatim. `tools/sim-phones.ts --game` rings cued
  notes (with jitter, misses, wrong zones, `--late`).
  Seating chart: HGP `claim` / `ready` from phones (relayed to the game; Ready kept per device and
  in `devices`), dashboard command `parts` → HGP `parts` to every phone (also on join); device list
  broadcast on change + 3 s heartbeat instead of every second. Controller: **Pick your part** list,
  *Swap with …?*, **I'm ready**, *Sit out*. `tools/sim-phones.ts --claim N --ready`.
  Drop-in: `parts.waiting` from the game → `next` per phone; controller **You're in!** screen.
- **S4**: `Session` accepts any renderer/HUD with the same methods, an `onJudgement` hook and
  `hostRingSound`; `HighwayRenderer` `fitCanvas`/`fitLanes` options. Lane, gem and phone colours
  come from the shared pitch-class palette (`spikes/shared/pitch-palette.ts`, #12), so a bell
  keeps its colour on every highway and phone. S4's own app behaves as before.
  For the backing: `Session` options `extraEvents` (extra audio events on the chart's
  AudioContext timeline, negative times allowed for a count-in) and `leadIn`;
  `AudioEngine.connect(node, reverb)` mixes an external bus in with the bells.
  For practice speed: `HighwayRenderer.setScroll(speed, lookAhead)` (scroll rate + shader uniform).
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
