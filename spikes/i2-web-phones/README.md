# I2 — Phones → web host (integration spike code)

Real phones (S1 controller + HGP v0 host) play the S4 web-native host with S5 carol charts,
2–4 ringers on one TV. Report: [docs/spikes/I2-web-phones.md](../../docs/spikes/I2-web-phones.md).

```
phones ──WSS via cloud tunnel ──▶ S1 Node host ◀──WS (127.0.0.1)── game page on the TV
       ──WebRTC direct (same Wi-Fi, when it connects)──▶   (or WSS on the LAN, self-signed,
 (S1 controller: rings, zones,        (HGP v0 relay, QR,       when there is no tunnel)
  local bell sound, cue glow)          serves the game at /game/)  (this folder: S4 renderer/judge/
                                                                    session/audio + S5 charts)
```

How phones connect is [ADR-0012](../../docs/decisions/0012-auto-tunnel-direct-upgrade.md)
(Accepted 2026-11-09, amends ADR-0006); see [How phones connect](#how-phones-connect) below.

Code reuse (imported, not copied): S4 `HighwayRenderer`, `Session`, `Judge`, `Hud`,
`AudioEngine`, `KeyboardSource`; S1 `ClockSync` + HGP types; S5 `loadSong`/`buildChart`
(charts are generated at build time with the `phone-4zone` profile, 1–4 ringers).

## Owner runbook (TV playthrough, ~10 minutes)

**You need:** the Windows PC connected to the TV (HDMI), Node ≥ 22, Chrome or Edge, 1–4 phones,
and preferably [cloudflared](#how-phones-connect) (`winget install --id Cloudflare.cloudflared`)
plus an internet connection. Phones can then join from any network, with no certificate warning,
and they switch to a direct link when they are on the PC's Wi-Fi. Without cloudflared, phones must
be on the **same Wi-Fi** as the PC. The first run downloads npm packages (~1 min).

1. On the PC, at the **repo root** (a fresh clone is fine):
   ```sh
   npm start                      # checks the setup, installs, builds, starts the phone host, opens the game
   ```
   It first runs the [start-up checks](#start-up-checks-and-troubleshooting) and stops with a
   fix if something would get in the way (old Node, a busy port). Read any **!** warnings: they
   cover the wrong network adapter, the Windows Firewall and guest Wi-Fi. When the game is up it
   prints the **TV** and **Phones** addresses. **Ctrl+C** stops it.
   Options go after `--`, e.g. `npm start -- --ip 192.168.x.y` (another adapter),
   `npm start -- --lan-only` (no cloud tunnel) or `npm start -- --tunnel` (tunnel only, fail
   if it can't start). `npm start -- --help` lists them all. `npm start` in this folder does
   the same.
2. The browser opens **http://127.0.0.1:18900/game/** — drag it to the TV and press **F11**.
   (If port 18900 is busy, `npm start` uses the next free port and prints the TV address; see
   [#53](https://github.com/dcuccia/go-go-harmoniyo/issues/53).)
3. Each ringer scans the QR on the TV. With the cloud tunnel (a `trycloudflare.com` address)
   there is no warning. Without it (a `https://192.168…` address) the phone warns about the
   certificate **once** (Chrome: *Advanced → Proceed*; Safari: *Show Details → visit this
   website*). Type a name,
   tap **Tap to start**, allow motion, then **ring 6 times** to calibrate (the banner counts down).
   The status at the top shows whether the phone is connected and waiting for a part before it
   shows a playable bell.
4. **Ready to play** shows who has joined and assigns available parts automatically. **Round options →
   Edit seating → Player details** shows each phone's route: **direct** (same Wi-Fi, fastest),
   **via tunnel** (through the internet; fine to play) or **Wi-Fi** (no tunnel). Ring a phone:
   its detail row flashes and its lane lights on the TV.
   Each phone shows its part, song and its bells as coloured zones in the same order
   and colours as its highway on the TV.
5. Choose a **Song** (the first visit defaults to **Jingle Bells**; later visits remember your choice).
   Set **Difficulty** next to **Play**. Changing the song or level does not start the round.
   **Super easy** gives each ringer
   up to two bells with sparse cues. **Easy** gives up to two (lower left, higher right), **Medium** up
   to four, and **Hard** up to four with quicker changes and offbeat pickups. The TV plays the rest of
   the tune softly. Round options also has **Parts**, **Length**
   and **Ringers** (defaults to the number of phones that have joined). **Parts**: *Balanced*
   (default: each player has one role — Bass, Harmony or a slice of the tune — in one range of
   bells, with similar effort), *Chord split* (up to three players share each chord, one note
   each; the others play the tune) or *By range* (the older split). **Length**: *Full* (intro,
   verses that build up, an ending; about 2–3 minutes) or *Short* (the song once). **Who plays
   what** under **Edit seating** is a seating chart: one card per part, named by its role (*Bass*, *Harmony*, *Low/High
   melody*, *Chord low/middle/high*, *Descant*; *Ringer N* for charts without roles), with its bells in their colours, range and a 1–5 difficulty meter (notes and
   bell changes per second). Above the cards are the player chips: each phone, ⌨ **Keyboard**
   (A S D F) and 🤖 **TV plays** (the TV rings that part; any part nobody holds).
   - For a group of 1–4 first-timers, pick **Jingle Bells** or **Deck the Halls**, then
     **Round options → Round style → First Ring**. Each player gets one bell for a short round;
     the TV plays the rest of the melody. **Standard** restores your previous Difficulty, Parts
     and Length. Choosing a difficulty instead of First Ring explains the switch to Standard.
     Before opening a song that does not offer First Ring, the TV asks whether to switch. At rehearsal, try both
     songs on the TV to check the guide is audible and sparse parts are fun to play. If either
     does not work for your group, use **Standard → Super easy → Short**.
   - **On the TV:** drag a chip onto a part (onto a taken part = swap; drag a part's chip back to
     the chip row = sit out), or click a part and choose who plays it. TV remote / keyboard:
     in **Edit seating**, **← →** to move, **Enter** to open, **↑ ↓ Enter** to choose,
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
     TV is playing. A phone dropping out mid-song does not move anyone's part. Before the
     next count-in, either reconnect to restore the missing player's seat or confirm **Continue
     with fewer** to let the TV take that part.
   Bells beyond 4 per part are rung by the TV automatically.
   **Audio → Backing track** (on by default, volume 50 %) adds a festive groove from the song's chords
   on the TV — felt-like keys, plucked strings, bass and sparse percussion (see below).
   **Count-in** plays woodblock clicks on the beat before the first note (a pickup comes in on
   its beat). **Sound effects** (on by default, volume 50 %): sparkles for team streaks, a whoosh
   when the multiplier goes up, a fanfare for a perfect phrase, a soft "boop" for a miss and
   applause at the end — always quieter than the bells. All settings are saved on this PC.
   **Practice speed** (50–100 % in 5 % steps, default 100 %) slows the whole song down for
   first-time players: highways, the phones' next-zone glow, the backing groove and the count-in
   all follow, and the song list shows each song's length at that speed. Timing is judged the same
   in real time (a ring 40 ms late is as late at 50 % as at 100 %). The HUD, the results and the
   phones show the speed when it isn't 100 %. It is remembered until the browser closes (or
   `?speed=50` in the URL). It works with any difficulty: try **Easy at 60–70 %** for a first round.
   **Fast notes:** during a song each phone adapts its swing detection to its own notes, so in
   8th/16th-note passages a quick back-and-forth **shake** rings on both directions (like a real
   handbell). If a player still finds fast notes hard, click **Normal** next to their phone in
   **Player details** to switch it to **🐇 Quick** (smaller, quicker strokes ring everywhere; a
   few more stray rings). Saved per phone on this PC.
6. **▶ Play** (or Enter). Touch a zone to pick a bell (the next one glows), swing to ring.
   The phone makes the bell sound; the TV plays only the parts nobody holds, plus the backing.
   Change **Audio → Bell sound** to "Phones + TV" or "TV only" if a phone is silent (iPhone silent switch).
7. Results show the completed song and difficulty, team score and a row per ringer. **Play again**
   uses the completed round's settings. **Change difficulty** keeps the song and waits for **Play on
   [level]**. **Choose another song** opens the song list and returns to **Ready to play** after a
   choice. The room and joined phones stay connected. Phones can pick parts on the results screen
   too, and **Rotate + Again** intentionally moves seats. **Back / Esc** closes the current panel
   and restores focus, returns from Results to **Ready to play**, or asks to confirm ending a live
   round (the song is not paused).
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
one phone's screen off for a few seconds (its seat stays put), then reconnect before the next round;
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
| TV page port 18900 in use | i | Uses the next free port (18901, …) and says which program had it. The TV page is only used on this PC, so phones are not affected. A port you chose with `--http-port` is not moved: ✗ with the fixes below |
| Port 8443 (phones) in use | ✗ | Names the program (PID). An old host (`node.exe`): Ctrl+C in its window. Docker/WSL: stop the container. Or `--port` with a free port it suggests |
| No private IPv4 address (only VPN, virtual or 169.254.x.x adapters) | ! | Join the same Wi-Fi as the phones, or `--tunnel` |
| Several adapters | i | Prints the address phones will use and each alternative as `npm start -- --ip …`. Wi-Fi is preferred because phones are on Wi-Fi; virtual and VPN adapters (WSL, Hyper-V, Docker, NordLynx, Tailscale…) are ignored |
| Windows Firewall (reads the Node.js rules and the network's Private/Public type) | ! | Network is Public but Node is allowed only on Private: make the network Private (Settings → Network & internet → Wi-Fi → network → Private) or `--tunnel`. A *Block* rule (Cancel on the prompt): how to remove it. No rule yet: tick **Private networks** when Windows asks. If it can't tell, a reminder to allow Node on Private networks |
| Guest or work (domain) network | ! | Guest Wi-Fi keeps devices apart: use home Wi-Fi or `--tunnel` |
| cloudflared not found (default mode) | i | Phones join on this Wi-Fi with a certificate warning. Install it for the tunnel: `winget install --id Cloudflare.cloudflared` |
| `--tunnel` without cloudflared | ✗ | `winget install --id Cloudflare.cloudflared`. A portable copy in `%LOCALAPPDATA%\Programs\cloudflared` (or WinGet Links, Program Files) works without being on PATH |
| `--tunnel` with `--lan-only`/`--no-tunnel`, or a bad `--rtc` | ✗ | Pick one |

The Windows network and firewall checks can take a few seconds on a busy PC; they run while
the game builds, and if they take over 10 s more, their result is printed after the host starts.
In the default mode the QR shows the tunnel address once phones can open it: the host waits until
public DNS (1.1.1.1, 8.8.8.8, 9.9.9.9, 208.67.222.222) knows the new name and an HTTPS request
through the tunnel reaches it, then prints `Tunnel: ready at … after N s` (about 7 s in testing;
the TV says *starting the cloud tunnel…* meanwhile). Showing it any earlier makes a phone that
scans at once get "server not found", which its DNS then remembers for a minute. If every public
resolver says the name doesn't exist yet (each would then remember that for a minute), the host
gives up on that address after about 12 s and restarts cloudflared for a new one; the TV keeps
*starting…* during the restart. If the tunnel isn't ready within 60 s (`--lan-qr-after <s>`, or
`never` to wait until the tunnel gives up), or the internet is down, the QR shows the Wi-Fi
address, and switches to the tunnel when it is ready. With `--tunnel` the launcher warns if no
address arrives in 45 s.

Not detected: client isolation on a Wi-Fi that isn't named like a guest network, and third-party
firewalls. If the phones can't open a Wi-Fi join page, install cloudflared (or try
`npm start -- --tunnel`). The certificate
warning on the phones and help on the TV are [#26](https://github.com/dcuccia/go-go-harmoniyo/issues/26)
(the host prints the certificate tip in the console).

**macOS and Linux (untested):** the same command and checks run. Port owners come from `lsof`
(if installed). Wi-Fi is recognised as `en0` (macOS) or `wl*`/`wlan*` (Linux). Instead of the
Windows Firewall check there is a reminder: macOS asks whether `node` may accept incoming
connections (click Allow); on Linux, open TCP 8443 in `ufw`/`firewalld` if a firewall is
on. cloudflared is found on PATH or in `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`,
`~/.local/bin`. The browser opens with `open` / `xdg-open`.

### How phones connect

Nobody has to choose a route in advance ([ADR-0012](../../docs/decisions/0012-auto-tunnel-direct-upgrade.md), Accepted):

1. **Cloud tunnel first.** If cloudflared is found and the internet is reachable, the host starts
   a Cloudflare quick tunnel and the QR shows its `https://….trycloudflare.com` address. It has a
   real certificate (no warning) and works on guest Wi-Fi, through client isolation and on mobile
   data. The address is new each run, so the QR on the TV is always the one to scan.
2. **Then direct.** After joining, a phone tries to send its rings over a WebRTC data channel
   straight to the PC, set up through the tunnel. On a normal home Wi-Fi this connects in a
   second or two. The phone shows *connected (direct)* and the TV shows **direct**. If it can't
   (guest Wi-Fi, mobile data, a firewall blocking UDP), the phone stays on the tunnel and the TV
   shows **via tunnel**. The game is the same either way: rings are judged by when they were
   rung on the phone, so the route only changes how quickly the TV reacts (the tunnel adds
   roughly 20–100 ms). Rings are sent on both paths and the host keeps the first copy, so
   switching paths mid-song doesn't lose a ring. The tunnel stays open for everything else
   (lobby, parts, clock sync).
3. **No cloudflared or no internet:** the QR shows the Wi-Fi address (`https://192.168…:8443`)
   with its one-time certificate warning, as before. The TV shows **Wi-Fi**.

| Option | Effect |
|---|---|
| *(none)* | Auto: tunnel if possible, direct upgrade, Wi-Fi fallback |
| `--lan-only` (or `--no-tunnel`) | Never start the tunnel; Wi-Fi QR only |
| `--tunnel` | Tunnel only; stop with an error if cloudflared is missing |
| `--rtc auto\|on\|off` | Direct upgrade: only for tunnel phones (default), for every phone, or never |
| `--lan-qr-after <s>\|never` | How long the TV waits for the tunnel before showing the Wi-Fi QR (default 60 s, the owner's choice in [ADR-0012](../../docs/decisions/0012-auto-tunnel-direct-upgrade.md)) |
| `--cloudflared <path>` | Use this cloudflared |

**Where cloudflared is found:** `--cloudflared <path>`, then the `GOGOHARMONIYO_CLOUDFLARED`
environment variable, then next to the running program (`cloudflared.exe` beside
`go-go-harmoniyo.exe` in the portable Windows zip, [#43](https://github.com/dcuccia/go-go-harmoniyo/issues/43)),
then PATH, then the usual install folders (above).

**If phones stay "via tunnel" on home Wi-Fi:** check that they are on the same Wi-Fi as the PC
(not mobile data), and that the Windows Firewall allows Node.js on Private networks (the direct
link uses UDP). It still plays fine via the tunnel. If the PC's internet drops mid-session, all
phones lose their connection, including those on a direct link, which is tied to the tunnel
connection for now. They reconnect when the same tunnel comes back. If cloudflared restarts
with a new address, or the TV falls back to the Wi-Fi QR, everyone rescans the QR. If the internet
stays down, restart with `npm start -- --lan-only`.

### Backing track (procedural)

Try it first with **Jingle Bells · Easy · 1 ringer** (sleigh-ride groove under the melody),
then **Silent Night · Easy** (gentle), **We Wish You a Merry Christmas** (waltz) and **Joy to
the World** (march). *Autoplay demo* plays the bells and the backing together without phones.

| Style | Songs | What plays |
|---|---|---|
| Sleigh ride | Jingle Bells, Deck the Halls | Felt-like keys, soft offbeat shakes and a restrained bass pulse. |
| March | Joy to the World, Good King Wenceslas | Felt-like keys and warm bass, with a soft downbeat tap in fuller sections. |
| Waltz | We Wish You a Merry Christmas, The Holly and the Ivy | Nylon-like chords and short weak-beat answers that leave fresh chord attacks clear. |
| Gentle | Silent Night, It Came Upon the Midnight Clear | Felt-like keys and downbeat bass, without a continuous percussion part. |

The host marks **4-bar phrases** with a quiet brush instead of pitched fills that anticipate
the next chord. The **ritardando ending** steps down the final chord with soft plucks, leaving
the song's own tempo and judging untouched.

Code layout (modular so song-form/key changes in the timeline flow through): `timeline.ts`
(chart → chords + beats), `score-corrections.ts` (reviewed host-only fixes),
`styles.ts` (presets), `patterns.ts` (groove), `synth.ts` (Web Audio voices), and `track.ts`
(one play-through). Practice speed uses the already-stretched chart (`src/speed.ts`); the
backing, count-in and ending follow it. See [the score audit and matched auditions](#score-audit-and-audition).

#### Private catalog audition (local Node only)

With the private sidecar already installed in this worktree, launch from the repository root in
PowerShell:

```powershell
npm start -- --backing-preview (Join-Path $PWD.Path '.backing-preview')
```

Open the printed TV address (`http://127.0.0.1:18900/game/?backingPreview=1` by default).
The lobby's **Local audition** picker selects **Candidate** or **Baseline**. To compare the same
round, change **Backing for next round** on the results screen and select **Play again**.
Both use the existing Backing volume, Count-in and Practice speed. First Ring always uses
baseline. Phones scan the regular QR and join the same Wi-Fi over HTTPS; the phone page does
not receive candidate notes or samples. The audition does not support tunnels or the portable
package. The launcher builds the audition UI in its own ignored directory; without the opt-in
flag, `npm start` uses the ordinary build.

The ignored worktree-root `.backing-preview` holds `manifest.json` and `samples\`. Never copy it
to `public`, `dist`, a package, or another hosted directory. Per [ADR-0011](../../docs/decisions/0011-ai-assisted-arranging.md),
resemblance review is still required before promotion. The manifest uses `schema:
"backing-preview-v1"`, the exact built `charts/index.json` `sourceHash`, and a `songs` map
covering every catalog ID with `short` and `full` arrays. Each entry is
`[beatIndex, offsetBeats, lengthBeats, midi, voice, velocity]`: zero-based index into that
form's `harmony.beats`, fractional offset in `[0,1)`, length in `(0,16]`, final MIDI pitch
(including any written transposition), `harp`/`bass`/`pad`, and velocity in `(0,1]`.
The end is interpolated on the beat grid, whose final boundary is the chart's duration.
The host validates the catalog and sample hashes before launch; the TV filters doubles and
nearby clashes against the selected part's player and guide notes, without changing their cues.
If the bells occupy the entire part, the TV labels it as such and plays no candidate notes
instead of substituting the baseline.

Recorded harp input: VSCO-2 CE, Sam Gossner and Simon Dalzell (Elan Hickler/Soundemote sample
cutting), [CC0 at the pinned revision](https://github.com/sgossner/VSCO-2-CE/blob/440300901dfe9275fd84e0b7763af1f8443ae62e/LICENSE).
The exact `KSHarp_*_mf.wav` inputs under `Strings/Harp` and SHA-256 pins are listed in
[`preview-samples.ts`](src/backing/preview-samples.ts). Keep the WAVs and private provenance local.

#### Score audit and audition

The overlay affects only the backing, not the underlying chart harmony, assigned notes, TV guides,
or cue times. The numbers below are 1-based source measures and beats; Holly's one-beat pickup
is not measure 1. This was a targeted audit, not a catalog-wide reharmonization.

| Source passage | Shipped chart → backing | Evidence in the source |
|---|---|---|
| Wenceslas 1.4 / 5.4 | F♯m → E/G♯ | B–E–B above G♯. The inferred half-bar F♯m was correct at beat 3 but carried through this change. |
| Wenceslas 2.2 / 6.2 | A → D | A–F♯–D above D; beat 1 stays on A, beat 3 still moves to E. |
| Wenceslas 3.2 / 7.2 | D → A/C♯ | E–E–A above C♯, between the D chords on beats 1 and 3. |
| Wenceslas 3.4 / 7.4 | D → E7/B (no root doubled or added) | G♯–D–B above B before the A cadence; the score omits E. |
| Holly 4.3 / 12.3 | C7 → C7/E | Soprano C then B♭, alto E, tenor G and bass E. The C7 after F/C at 7.3 / 15.3 really has C in the bass and stays unchanged. |

Wenceslas uses the [registered public-domain Mutopia #905 edition](../../ATTRIBUTION.md#mutopia-good-king-wenceslas),
James Kilfiger's typesetting of C. L. Hutchins, *Carols Old and Carols New* (1916), #415:
see the upper and lower voice lines in its [LilyPond source](../s5-chart-pipeline/sources/mutopia/GoodKingWenceslas.ly).
Holly uses the repository's [reviewed CC0 SATB ABC](../s5-chart-pipeline/songs/the-holly-and-the-ivy.abc),
not the melody-only Mutopia edition or an experimental S6 arrangement. The fixes follow repeated
verses and the optional transposition; the generated modulation bars are not changed.

For level and timing checks, see [the offline render](results/backing-render.md). Run
`npm run audio-check -- --audition-dir=<outside-worktree-directory>` from this directory to generate
two sets of matched clips (Short form, 6.1 s Wenceslas / 8.9 s Holly). `harmony-before` and
`harmony-after` use the same new synth and same bell stem, with only the backing score overlay
switched. Compare `harmony-after`, `legacy-timbre` (voices from `0c0cb51`), and `sample-bank` with
identical corrected bass/key events. All are matched to −30 dBFS backing RMS before adding the same
bell stem. This isolates those two factors; it is not a recording of the complete game mix.

| Excerpt | Pitched events, before → after | Offline render: legacy / new / short samples | Mixed peak, all variants |
|---|---:|---:|---:|
| Wenceslas | 13 → 22 | 411 / 128 / 76 ms | 0.842–0.861 |
| Holly | 27 → 27 | 803 / 242 / 115 ms | 0.738–0.809 |

Wenceslas adds the missing beat-level attacks at the new changes; Holly changes the bass
pitch without adding attacks. On the fixed harmony, the new synth and samples had nearly
identical 2 kHz high-pass RMS (within 0.1 dB). That is one spectral check, not a listening verdict.
The sample experiment used six original 1.6 s mono voices at 24 kHz with pitch shifting: about
461 kB as PCM16 WAV or 922 kB decoded float data, with 32 ms to synthesize the bank in this run.
The bank rendered the excerpts faster but retained more audio in memory. We kept live synthesis:
no recorded instruments,
new media or dependencies, no audio downloads, and only a shared 57.6 kB noise buffer at 48 kHz
when percussion plays, plus three periodic-wave tables on demand. The production I2 host JS
shrunk from 620.79 kB to 613.45 kB (gzip 169.03 → 166.92 kB); the S9 host JS from 671.08 kB to
663.74 kB (gzip 187.57 → 185.45 kB). Render measurements are from headless Chrome on Windows,
not real TV speakers, Safari or a human listening panel.

### Performance sound effects

`src/sfx/director.ts` decides (pure, unit-tested), `src/sfx/synth.ts` plays (synthesised):

| Moment | Sound |
|---|---|
| Team streak 10, 25, 50, then every 50 | rising sparkle pings above the bells; from 25 a two-note chime |
| Multiplier goes up (×2, ×3, ×4) | filtered-noise whoosh with a rising tone |
| A miss (at most one cue per 3 s; stray rings none) | a soft, low two-note "boop-boo" — friendly, not a buzzer |
| Every note of a 4-bar phrase Perfect or Great | a short brass "da-da-da DAA" on the chord sounding then, below the bells' register; its pickup follows the beat |
| End of the song | applause, denser and longer with team accuracy (everyone gets some); cheering whistles from 80 % |

Bells stay the hero: at the default volume the effects sit 10–25 dB under a single bell, start
80 ms after the ring that triggered them, and the SFX bus ducks 9 dB for 0.2 s whenever a phone's
ring arrives. Effects are event-driven, so they follow any tempo or practice speed. The results
JSON lists how many of each played (`sfx.cues`). URL parameters `sfx=0|1`, `sfxVol=0–100`.

How it works: the S5 pipeline writes each song's chords and beat grid into the chart
(`harmony`, chart format 0.2; chords come from the lead sheet, or are inferred from the
Mutopia scores). `src/backing/` turns them into a deterministic pattern and synthesises it with
Web Audio; the events go into S4's `Session` scheduler, so they are timed on the AudioContext
clock with the same song timeline as the bells, highways and judging (no drift; tempo changes
followed beat by beat). Bass and inner bells of the chosen part — whether a phone or the TV
rings them — are kept out of the backing: the backing bass rests while a bass bell sounds, and
the keys leave out pitch classes an inner bell is holding. The groove sits below the bells at
the default volume in the measured excerpts (`npm run audio-check`). Backing settings are read when a
song starts (change them in the lobby, not mid-song). Charts without `harmony` play as
before, with no backing (the count-in then uses the first tempo and meter).

## Other commands

| Command | What |
|---|---|
| `npm run dev` | Vite dev server (http://localhost:5173) — connects to an S1 host already running on port 8080 (`cd ../s1-phone-bell && npm start`; the S1 host's own default stays 8080). For a game started with `npm start` (port 18900), add `?hgp=ws://127.0.0.1:18900/hgp`. |
| `npm test` | Unit tests (chart → team chart mapping; seating chart: claim/swap, seeded shuffle, rotate, balance, persistence across ringer-count changes, late join, disconnect/reconnect; drop-in join queue: mid-song joiners wait and are seated first come first served; practice speed: 5 % steps, chart/tempo/beat-grid stretching, judging windows in real time, backing and count-in follow, slow-motion scroll, every generated tier; part names and difficulty; backing chord timeline, count-in and patterns; start-up checks: adapters, ports, firewall rules, cloudflared). |
| `npm start -- --check` | Start-up checks only (same as `npm run preflight` at the repo root). `npm start -- --help` lists the options. |
| `npm run build` | Typecheck + build to `dist/` (also regenerates `public/charts/` and copies the brand files to `public/brand/`). |
| `npm run e2e` | End-to-end without phones: real S1 host + S1 simulated phones (`tools/sim-phones.ts --game`) + headless Chrome. Five scenarios, one at 50 % practice speed (the stretched song, rings still judged in real time against the same offset tolerances). Add `-- --shots` for screenshots, `-- --channel=msedge` for Edge. Hosts use ports 18080+ (`-- --port=N`), so a game you are running (`npm start`, port 18900) or an S1 host on 8080 is not in the way. Flake hunting: `node scripts/e2e.mjs --repeat=50 [--load=16] [--bail]` runs the suite N times (optionally with N busy CPU threads) and appends one row per scenario to `results/e2e-repeat.ndjson`. A failing scenario prints its timing evidence (cue-anchor drift, audio clock re-anchorings, host clock-sync jumps, long frames, ring arrival latency, strays, each phone's ring plan); see [#18](https://github.com/dcuccia/go-go-harmoniyo/issues/18). Runs in CI (`.github/workflows/i2-web-phones.yml`). |
| `npm run e2e:seating` | Seating chart end-to-end: real S1 host, two S1 phone pages in mobile emulation (Alice, Bob) and one S1 simulated phone (Cara, `--claim`/`--ready`): phone claim, swap, Ready, TV picker by keyboard, drag, 🔁/🎲, late join, disconnect → TV → reconnect reclaims, Play without everyone Ready, and the regression for the collapsing dropdown (the picker survives device broadcasts). Also checks First Ring selection, return to Standard, and a complete Deck the Halls autoplay. Writes `results/seating-e2e.json`; `-- --shots` captures `i2-seating-lobby.png` and `i2-phone-part-picker.png`. |
| `npm run e2e:dropin` | Drop-in + practice speed end-to-end (port 18600): the lobby speed control (5 % steps, kept across a reload), Alice plays at 50 % (HUD badge, phone label, stretched song, results line), Bob joins mid-song from a phone page (*You're in!*, TV corner QR + *+1 waiting*, seats unchanged), results (*Joining: Bob*, he can pick a part), **Again** seats him in the TV's part, the corner QR hides in the lobby and with `?joinQr=0`. Writes `results/dropin-e2e.json`; `-- --shots` captures `i2-ingame-join-qr.png`, `i2-results-join-qr.png` and `i2-phone-waiting.png`. |
| `npm run e2e:takeover` | Reconnect/takeover end-to-end (port 18800), the regression for the 2026-10-25 joining thrash (two tabs of one phone kicking each other off): a second tab of a joined phone shows *connected in another tab — Use this tab* without connecting; **Use this tab** takes over exactly once and stays stable (the TV never sees the phone offline, seats unchanged, device broadcasts at heartbeat level); the TV's QR scanned again mid-song leaves the playing tab connected and ringing; two pages that can't see each other (separate profiles, same deviceId) end after one host `replaced`; and the same with Web Locks removed (iOS Safari < 15.4: localStorage heartbeat). Counts hellos/replacements in the host's event log. Writes `results/takeover-e2e.json`. |
| `npm run audio-check` | Offline Chrome render: peaks, bell balance, count-in/downbeat onsets, 0.75× speed, closing tag, stop/replay and SFX. Writes `results/backing-render.md`; `-- --audition-dir=<outside-worktree-directory>` writes the optional loudness-matched A/B WAVs and sample-bank metrics. |
| `node scripts/controller-check.mjs` | Drives S1's real phone page (mobile emulation, touch mode) through a song. |
| `node scripts/webkit-controller-check.mjs` | WebKit smoke test (#27): S1's phone page in Playwright **WebKit** with an iPhone profile (`--device="iPhone 15"`) over HTTPS with the self-signed certificate, TV page in Chrome. Tap to start (stubbed `DeviceMotionEvent.requestPermission`), Web Audio unlock, joining and *Pick your part*, zones and the next-zone glow, and synthetic `devicemotion` rings (calibration, lobby practice, then the song's notes) reaching the host. Needs `npm run build` and, once, `npx playwright-core install webkit` (Linux: `--with-deps`; use `playwright-core`, already a dev dependency, so the browser matches its version). Writes `results/webkit-controller-check.{json,md}`, including what emulation can't show. An early signal, not a substitute for a real iPhone. |
| `npm run charts` | Regenerate `public/charts/` (full form) and `public/charts/short/` from S5: every arrangement and tier, 1–4 ringers; skipped when nothing changed (`-- --force`). `-- --key-change` adds the step up in the last verse (off by default; it can move more notes to the TV guide because phone pitch sets stay fixed). Use `-- --profile handbell --ringers 3,4,5` for the S5 defaults. URL: `?form=short`, `?parts=chord-split`, `?diff=super-easy`. |

CI ([`.github/workflows/i2-web-phones.yml`](../../.github/workflows/i2-web-phones.yml)) runs on changes to
this folder, S1, S4, S5, `spikes/shared` or the palette: `npm ci`, `typecheck`, `test`, `build`, the
S4 and S5 unit tests, `e2e:seating`, `e2e:dropin` and `e2e:takeover`, plus `npm run e2e` in its own job (all gating; the timing
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

### Branding

The TV wears the Go Go HarmoniYo identity ([brand guide §3](../../docs/design/brand.md#3-logo-and-visual-identity)):
the stacked lockup (G2) heads the lobby, a phone's detail row
shows Yo ringing (Y4) for a moment when that phone rings, the corner join card carries the Yo
mark with *Join Go Go HarmoniYo*, and the results panel has Yo cheering: Y5 (hands up) from 80 %
team accuracy, Y2 (joy) below that. Every outcome gets a celebration. The UI accent (`--gold`) is
candlelight `#f3b01d` and the page is the stage `#0b0d17`; the note highways keep their darker
`#05040d`, which the pitch-class palette's contrast checks use. Yo's motion stops with
`prefers-reduced-motion`. Favicon, app icons and `theme-color` come from the same files.

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
  Fast rings: `assign-bells` also relays `ring` (`{sens, ioi}`) → HGP `assign.ring`; the controller
  adapts its ring detector to its `cues` (fast passages) and to Normal/Quick sensitivity.
  Branding: the host serves `docs/design/brand/` at `/brand/`, `/favicon.ico` and the phone's
  `/manifest.webmanifest`; the controller, dashboard and meter carry the lockup, favicon and stage colours.
- **S4**: `Session` accepts any renderer/HUD with the same methods, an `onJudgement` hook and
  `hostRingSound`; `HighwayRenderer` `fitCanvas`/`fitLanes` options. Lane, gem and phone colours
  come from the shared pitch-class palette (`spikes/shared/pitch-palette.ts`, #12), so a bell
  keeps its colour on every highway and phone. S4's own app behaves as before.
  For the backing: `Session` options `extraEvents` (extra audio events on the chart's
  AudioContext timeline, negative times allowed for a count-in) and `leadIn`;
  `AudioEngine.connect(node, reverb)` mixes an external bus in with the bells.
  For practice speed: `HighwayRenderer.setScroll(speed, lookAhead)` (scroll rate + shader uniform).
- **S5** format 0.3.0: song form (`form.sections`, beat `section` → the backing's groove builds from a
  light intro to the full last verse), part `arrangement`, ringer `role`/`name` (the part cards use
  them), `super-easy` + host-played `guide` notes (added to the TV's backing notes).
- **S5**: charts carry an optional `harmony` block (format 0.2.0: chords, beat grid, backing
  style; chords inferred where the source has no chord symbols); see the S5 README.

## Licenses

Code: MIT (repo). No third-party assets: charts are generated from S5's CC0/public-domain
sources (licence per song in each chart's `song.license`); bell sound is S4's additive synth
on the TV and S1's synth on the phones. The backing track (felt-like keys, plucked strings,
bass, percussion, count-in) and the performance SFX (sparkles, whoosh, boop, fanfare, applause)
are synthesised live with Web Audio from code in `src/backing/` and `src/sfx/` — no samples or
audio files, so there is no media to register. The brand files (lobby lockup, Yo states, favicon,
app icons) are copied at build time from [`docs/design/brand/`](../../docs/design/brand/README.md)
into `public/brand/` (gitignored) by `npm run brand` (part of `prebuild`/`predev`); the sources are
registered as `brand-identity` and `brand-yo-defaults` (CC BY 4.0), and the copies are never edited.
`public/manifest.webmanifest` makes the TV page installable with those icons. npm dependencies: three (MIT), vite (MIT), vitest (MIT),
typescript (Apache-2.0), playwright-core (Apache-2.0).

Platform notes for the backing: it runs on the TV host only; phones are unchanged. Verified in
Chrome on Windows (unit tests, `npm run audio-check`, E2E); Edge/macOS/Linux/ChromeOS hosts use
the same standard Web Audio nodes and are expected to behave the same but are untested. A TV
over HDMI/Bluetooth delays the backing exactly like the host bells (same AudioContext), which
`getOutputTimestamp()` and the A/V offset already account for.
