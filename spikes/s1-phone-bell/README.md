# S1 — phones as handbells (spike harness)

Throwaway spike code for [S1](../../docs/spikes/README.md#s1--phone-bell-input-timing--transport).
Report: [docs/spikes/S1-report.md](../../docs/spikes/S1-report.md). Protocol draft:
[docs/protocol/hgp-v0.md](../../docs/protocol/hgp-v0.md). License: MIT (repo). No code was
copied from GACJ/handbellmanager (GPL-3.0); only its approach was studied.

| Path | What |
|---|---|
| `src/core/` | Engine-independent, DOM-free TypeScript: HGP v0 types, clock sync, ring + impact detectors, onset analysis, stats |
| `src/host/` | Node host: HTTPS/WSS (+ optional WebRTC via `werift`), QR code, test orchestration, logging, analysis; `yarg.ts` = I1 YARG sidecar (`--yarg`) |
| `src/web/` | Phone controller, PC dashboard, microphone latency meter (bundled by esbuild at start-up) |
| `sim/` | Synthetic motion traces + Wi-Fi/clock model → `results/sim-results.md` (`npm run sim`) |
| `tools/` | `sim-phones.ts` (fake phones over real WebSockets), `analyze.ts` (replay recorded traces), `sim-yarg-phones.ts` (fake phones in YARG mode) |
| `test/` | `node:test` unit tests (`npm test`) |

## Owner runbook (Pixel first, ~20 minutes)

**Once:** install Node 22+ (`winget install OpenJS.NodeJS.LTS`). PC and phones on the same
Wi-Fi (not a guest network: guest networks usually block phone→PC traffic). On guest,
corporate or school networks, or when the PC and phone are on different networks, use the
tunnel instead (`npm run tunnel`, or `npm start -- --tunnel` at the repo root for the I2 game).

```powershell
cd spikes\s1-phone-bell
npm install
npm start
```

1. The dashboard opens at `http://127.0.0.1:8080/dashboard` and the terminal prints a QR code.
   If Windows Firewall asks about Node.js, allow **Private networks**.
2. On the Pixel, scan the QR (Camera or Google Lens) → Chrome shows *Your connection is not
   private* (self-signed certificate) → **Advanced → Proceed to 192.168.x.x (unsafe)**. This is
   needed once per PC (the certificate is cached in `certs/` for 30 days).
3. Type a name, tap **Tap to start**, then **ring 6 times** (forward handbell stroke, phone in
   hand, screen towards you) to calibrate. The phone chimes on each ring.
4. Run the tests from the dashboard; each one prints a results table and appends it to
   `data/<session>/summary.md`:

| # | Test | Dashboard | What you do | Measures |
|---|---|---|---|---|
| A | Metronome, 1 bell | Bells per phone = 1, **Start metronome test** (80 bpm × 100) | Ring on every click (the phone clicks) | detection %, false %, timing spread, arrival delay, sample rate |
| B | False rings | **False-ring test** (120 s) | Don't ring: hold, wave, talk with your hands, walk, put down/pick up | false rings per minute |
| C | Clink (2 phones) | **Clink test** (60 s) | Lay both phones on a table, knock the table ~1×/s (or gently tap the phones together) | synced-timestamp error between phones |
| D | Multi-bell | Bells per phone = 4, tick *multi-bell melody*, metronome 60 bpm × 60 | Touch the glowing zone with your thumb, ring on the click | right-bell %, touch-to-ring lead, detection % with thumb on screen |
| E | Sound latency | Open `http://127.0.0.1:8080/meter` on the PC, **Record**; dashboard **Sound-latency test**, sound placement *phone* | Knock the phone on the table next to the PC microphone ~1×/s, 20×; **Stop & analyse**. Repeat with placement *host* (click **Enable host sound** first) | knock→sound latency for phone vs PC speaker |

Optional (5 min each): repeat **A** with `?api=generic` added to the phone URL (Chrome
Generic Sensor API: real sensor timestamps), with `?rtc=1` (WebRTC data channel instead of
WebSocket), and on an iPhone (Safari: tap **Show Details → visit this website**, then allow
*Motion & Orientation*; test with the silent switch on and off).

**Send back:** `data/<session>/summary.md` (paste into the PR or commit it under
`docs/spikes/S1-data/`). Raw traces (`raw-*.ndjson`) are only needed if detection looks wrong;
re-tune offline with `npm run analyze -- data/<session> --minDecel 4500`.

### Other modes

| Command | Transport | Notes |
|---|---|---|
| `npm start` | WSS on LAN, self-signed cert | One-time certificate warning per phone |
| `npm start -- --cert fullchain.pem --key privkey.pem --hostname bells.example.com` | WSS on LAN, publicly trusted cert | DNS A record → PC's LAN IP; cert via DNS-01 (see report) |
| `npm run tunnel` | Cloud relay (Cloudflare quick tunnel) | Needs `cloudflared` on `PATH` (`winget install --id Cloudflare.cloudflared`, or without admin: download the signed `cloudflared-windows-amd64.exe` from its GitHub releases into `%LOCALAPPDATA%\Programs\cloudflared`). No cert warning; works across guest/isolated networks; adds internet RTT (judging is unaffected: source timestamps) |
| `npm start -- --no-https` | Plain HTTP on LAN | Motion sensors **won't** work on phones; for CI/sim only |
| `npm start -- --ip 192.168.1.23` | — | Override the auto-detected LAN IP (VPN/virtual adapters) |
| `npm start -- --game ../i2-web-phones/dist` | — | I2: also serve a static game at `http://127.0.0.1:8080/game/` and open it instead of the dashboard (use `npm start` in `spikes/i2-web-phones`) |

Game hosts connect as `kind: "dashboard"` and use two extra commands (I2): `{type:"cmd",
cmd:"assign-bells", deviceId, bells:[{id,label,midi,color}], ringer?:{slot,title,song?}}` and
`{type:"cmd", cmd:"cues", deviceId, at:[hostMs], bells:[id]}` (relayed to the phone as HGP
`cues`, which makes the next zone glow). `npx tsx tools/sim-phones.ts --game --names A,B,C`
runs fake phones that ring whatever notes they are cued.

Phone URL parameters: `?api=generic`, `?rtc=1`, `?record=1` (always stream raw traces),
`?minDecel=4500&minPeakOmega=200…` (detector overrides), `?sens=quick` (Quick ring sensitivity; normally set per phone in the I2 lobby).

**Fast passages.** During a song the phone adapts the ring detector to its own upcoming notes
(from `cues`): in 8th/16th-note passages the refractory period follows the note spacing, smaller
"flick" strokes count and both halves of a back-and-forth shake ring. The status line shows
`rings: normal · fast 125 ms` while it is active. See [S1 report → Fast repeated rings](../../docs/spikes/S1-report.md#fast-repeated-rings-eighth-and-sixteenth-notes).

### YARG mode (I1: phones as ringers in the YARG fork)

`npm run yarg` runs the same host plus a sidecar that forwards rings to the YARG fork's
`HgpBridge` (UDP 127.0.0.1:47800). Each phone takes a ringer seat (Ringer 1–4 = YARG profile
"Ringer N"), and its thumb zones are that ringer's chart bells, one per YARG lane. Owner runbook
and results: [docs/spikes/I1-yarg-phones.md](../../docs/spikes/I1-yarg-phones.md).

| Option | Default | Meaning |
|---|---|---|
| `--song <id or title>` | — (YARG reports it on chart load) | Pre-select the chart whose bells the phones get |
| `--difficulty easy\|medium\|hard\|expert` | `expert` | Tier for `--song` (Expert = Hard) |
| `--charts <dir>` | `../s5-chart-pipeline/charts` | S5 chart JSON folder |
| `--yarg-phones N` | 4 | Ringer seats (max 5) |
| `--yarg-ringers N` | 4 | Ringer count of the exported chart part |
| `--yarg-port N` | 47800 | Bridge port (YARG `-hgp-port`) |

## Developer commands

```powershell
npm run typecheck   # tsc --noEmit
npm test            # unit tests (clock sync, detectors, onsets, analysis)
npm run sim         # emulated measurements → results/sim-results.md run sim:fast    # only section 5 (fast repeated rings), add -- --quick for a 5 s run
npx tsx tools/sim-phones.ts   # with `npm start -- --no-open` running: fake phones end-to-end
npx tsx tools/sim-yarg-phones.ts --churn --extra   # with `npm run yarg -- --no-https --no-open` (+ YARG -hgp) running
```

CI (`.github/workflows/s1-phone-bell.yml`) runs typecheck, tests, the simulator (posted to the
job summary) and the simulated-phone end-to-end test.

## Dependencies

MIT: `ws` 8.22, `qrcode` 1.5, `selfsigned` 5.5, `esbuild` 0.28, `tsx` 4.23; optional `werift`
0.25 (pure-TypeScript WebRTC, MIT). Dev: `typescript` 7.0 (Apache-2.0), `@types/*` (MIT).
