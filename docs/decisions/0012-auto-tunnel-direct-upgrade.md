# 0012 — Auto tunnel with a direct-LAN upgrade (amends ADR-0006)

- Status: Proposed
- Date: 2026-11-09
- Deciders: @dcuccia (owner); proposed by the auto-tunnel session (S6 coordinator)
- Amends: [ADR-0006](0006-phone-host-transport.md), decision point 1 and the 2026-10-25 holiday
  default. If accepted, ADR-0006 becomes "Amended by 0012". The owner changes ADR-0006's status
  when accepting this ADR.

## Context

ADR-0006 made WSS on the LAN with a self-signed certificate the default, and the Cloudflare quick
tunnel (`--tunnel`) a one-flag fallback. Before the holiday release the owner asked:

> can you envision how we might make the tunnel always an option, but prefer the local direct
> route, such that the runner wouldn't have to decide a-priori?

and then chose "auto tunnel with direct-LAN upgrade". The target is a family Thanksgiving game
(2026-11-26) run by someone who should not have to know about certificates, client isolation or
flags. Two facts set the design:

- Phones need a secure context for motion sensors. The tunnel URL is publicly trusted, so the QR
  opens with no warning and works through guest-Wi-Fi client isolation and on mobile data. The
  LAN URL is self-signed: one warning per phone, and it fails on isolated networks.
- A page loaded from `https://*.trycloudflare.com` can't silently open `wss://192.168.x.x` on
  the self-signed LAN host. Mixed-origin requests to an untrusted certificate fail without a
  prompt. The only browser path from a tunnel-loaded page to the PC on the same Wi-Fi without a
  certificate is **WebRTC**: DTLS needs no CA, and the browser negotiates it after signalling.

Judging uses gesture source timestamps over the synchronised clock (ADR-0002), so the route
changes feedback latency only (tunnel ≈ +50 ms; see the
[connectivity research](../research/connectivity-and-deployment.md)), not scores.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| (0) Keep ADR-0006: self-signed by default, `--tunnel` by choice | Built; no internet needed; lowest latency | The runner must decide in advance; guests see a certificate warning; it fails silently on isolated Wi-Fi |
| (1) Tunnel always, no upgrade | Simple; no warnings; works anywhere with internet | Every gesture's feedback crosses the internet (+~50 ms, jitter); it depends entirely on a best-effort service |
| (2) **Tunnel join, then upgrade to a WebRTC data channel on the LAN** (this ADR) | No warning and no choice to make; P2P on a normal LAN (LAN latency); falls back to the tunnel by itself; LAN self-signed QR when there's no cloudflared or internet | More moving parts (cloudflared supervision, ICE); WebRTC behaviour differs between iOS and Android; the downlink still uses the WebSocket |
| (3) Tunnel page that redirects to the LAN HTTPS URL | No WebRTC | The redirect lands on the certificate warning again, which defeats the point; it still fails on isolated networks |
| (4) Publicly trusted LAN certificate (ADR-0006 a2) | No warnings, LAN latency, no internet at play time | Needs a domain + DNS-01 automation ([#45](https://github.com/dcuccia/go-go-harmoniyo/issues/45)); not ready for 2026-11-26; still fails on isolated networks |

## Decision (proposed)

Option (2). The runner just runs `npm start` (or the portable package, #43). Nobody chooses a
route in advance.

1. **Transport mode** (`transportMode` in
   [`transport.ts`](../../spikes/s1-phone-bell/src/host/transport.ts)):
   - `auto` (default).
   - `tunnel` with `--tunnel`: tunnel only, never falls back to the LAN QR. This is today's flag.
   - `lan` with `--lan-only` / `--no-tunnel`, or implied by `--no-https`, `--public-url` and
     `--cert`, which name a LAN address explicitly.
   - `--tunnel` together with `--lan-only` is an error.
2. **Auto join URL** (`chooseJoinUrl`):
   - When cloudflared is found and `api.trycloudflare.com` resolves, the host starts a quick
     tunnel. Once cloudflared reports a registered connection (or 8 s after the URL appears),
     the host checks the address is reachable before showing it (`waitTunnelReady`):
     - Wait 3 s, then ask public resolvers (1.1.1.1, 8.8.8.8, taking turns; never the OS
       resolver) until the hostname has an A/AAAA record.
     - Then `GET /tunnel-check` over HTTPS, connecting to that address, until it returns 200
       with this host's per-run token (≈ 45 s budget for both steps).
     - Only then does the QR/join URL become the tunnel URL, and the console prints the time to
       ready. If the check fails, cloudflared is restarted for a fresh address.
     - Why: measured 2026-11-09 (cloudflared 2026.10.7, Windows), the hostname resolves about
       2 s after cloudflared prints it. Any query in the first ~1 s gets NXDOMAIN, and every
       resolver (1.1.1.1, 8.8.8.8, the phone's and the OS's cache) keeps that answer for the
       zone's 60 s negative TTL. Publishing the URL at once made a scan straight away fail for a
       minute. With the check, a live run was ready 7.3 s after start-up (URL at 3.7 s, DNS
       answered on the first query at +3.0 s, HTTPS 0.5 s), and the first navigation from
       Windows (OS resolver, curl, Chrome) worked.
   - The TV shows "Starting the cloud tunnel…" for up to 15 s.
   - With no cloudflared, no internet, or a tunnel that is not ready after 15 s, the QR is the
     LAN self-signed URL, as in ADR-0006 (a1). It switches to the tunnel URL once that is ready.
   - The LAN HTTPS listener always runs. Phones that already joined over the LAN keep working
     if the tunnel appears later.
   - cloudflared is supervised: up to 3 restarts, 5 s apart. A new tunnel URL changes the QR.
3. **cloudflared lookup**, in this order (host and preflight share it; agreed with #43):
   1. `--cloudflared <path>`
   2. `$GOGOHARMONIYO_CLOUDFLARED`
   3. next to the running executable: `dirname(process.execPath)`, where the portable zip ships
      `cloudflared.exe`
   4. `PATH`
   5. the usual install folders (winget, Program Files, Homebrew, `/usr/local/bin`)
4. **Direct upgrade:**
   - The host offers `upgrade: 'rtc'` in the `welcome` to phones whose WebSocket arrived
     through the tunnel. The `cf-ray` / `cf-connecting-ip` headers mark them.
   - The phone creates a data channel (`ordered: false, maxRetransmits: 0`) and signals the
     offer/answer over that WebSocket. The host (werift, optional dependency) uses no STUN or
     TURN, so only host and peer-reflexive candidates are tried: a direct path on the same LAN
     or nothing.
   - If the channel doesn't open within 10 s, or ICE fails, the phone stays on the WebSocket and
     reports `rtc: failed` with a reason. If an open channel closes, the phone retries after 5 s,
     up to 3 attempts per connection.
   - `--rtc auto|on|off`: `on` offers the upgrade to LAN phones too (testing); `off` disables it.
     `?rtc=1` / `?rtc=0` on the phone overrides.
5. **Gestures during the upgrade:**
   - While the channel is open, gestures go over **both** the data channel and the WebSocket.
     The host drops the second copy by `(seq, th)` (`GestureDedupe`). A migration in either
     direction never loses a gesture, and the data channel being unreliable is safe.
   - Host→phone traffic (cues, parts, config, tests) stays on the WebSocket. The data channel is
     an uplink accelerator tied to that WebSocket session: when the WebSocket closes, the host
     closes the peer connection.
6. **Clock sync:**
   - Sync keeps running on the WebSocket.
   - When the channel opens, the phone runs a sync burst over it and then prefers the
     channel's (lower-RTT) samples. A small offset step can happen; judging is unaffected
     because gestures carry source timestamps.
7. **Visibility:**
   - The host prints the mode, the cloudflared path and each phone's `rtc-open` / `rtc-closed`.
   - The dashboard and the TV game show each phone's route: `direct`, `via tunnel`,
     `via tunnel (trying direct…)`, `Wi-Fi`, `offline`, and the tunnel state.
   - `npm start` preflight reports which mode will be used and why.

## Consequences

- The normal path has no certificate warning, and guest Wi-Fi or mobile-data phones just work.
  Home-Wi-Fi phones get LAN latency after a few seconds.
- The internet is needed for the first page load in auto mode. If it drops mid-session, phones
  on the tunnel WebSocket lose their connection and must rescan. Phones with a direct channel
  also lose it, because the channel is tied to the WebSocket. Without internet at start-up the
  LAN QR is used, as before.
- The game is safe to start with either route. Gestures carry source timestamps, so mixed routes
  in one game are fine.
- Any future host engine must offer the same `welcome.upgrade` and accept duplicate gestures
  (dedupe by `seq`/`th`), or simply not offer the upgrade. HGP over WebSocket remains mandatory.
- The portable package (#43) must ship `cloudflared.exe` beside the executable (or set
  `GOGOHARMONIYO_CLOUDFLARED`). cloudflared is Apache-2.0, shipped as a separate executable.
- ADR-0006 point 3 (classroom: tunnel, or WebRTC with TURN) is unchanged. This ADR is the
  no-TURN version of it.

### Platform limits

- **iOS Safari:** host candidates are mDNS-obfuscated (`*.local`) unless the page has camera or
  microphone permission. werift resolves mDNS names, and the phone's packets to the host's
  real-IP candidate should produce peer-reflexive candidates, so ICE should still connect on
  the same LAN. **Not yet verified on an iPhone (owner check).** If it fails, iPhones simply
  stay on the tunnel.
- **Android Chrome:** standard WebRTC; host candidates may also be mDNS. The same reasoning
  applies, and this also needs an owner check.
- **Guest Wi-Fi / client isolation / mobile data:** ICE fails by design, and the phone stays on
  the tunnel (the reason is shown).
- **Windows Firewall:** the direct path needs inbound UDP for Node.js. Accepting Windows' "allow
  access" prompt covers TCP and UDP. If UDP is blocked, the phone stays on the tunnel.
- **No werift** (optional dependency missing): no upgrade is offered; tunnel or LAN only.
- **Corporate networks** that block `*.trycloudflare.com` or UDP: the tunnel doesn't start, so
  the LAN QR is shown after 15 s.

### Future work

- Keep the direct channel alive through a tunnel outage: move host→phone messages to it and
  treat it as the session, so a home-Wi-Fi game survives an internet drop.
- When the tunnel restarts with a new URL, push the new URL over the channel so phones move
  without rescanning.
- ADR-0006 a2 (trusted LAN certificate, #45) would remove the internet dependency of the first
  load.

## Owner checks before accepting

These need real devices, cloudflared and a real network; they can't be done in CI:

1. iPhone (Safari) and Android (Chrome) on home Wi-Fi: scan the QR. The page opens with no
   warning, the route shows `via tunnel`, then `direct` within ~10 s.
2. The same phones on guest Wi-Fi or mobile data: they stay `via tunnel` and the game plays.
3. Pull the PC's internet mid-session: note what phones do (expected: they disconnect; rescan
   after the LAN QR appears or the tunnel returns).
4. Rename or remove cloudflared: the TV shows the LAN QR with the certificate warning, as
   before.
5. Windows Firewall: after a fresh "allow access" prompt, phones reach `direct`. With UDP blocked
   they stay `via tunnel`.
6. Portable zip (#43): `cloudflared.exe` beside `go-go-harmoniyo.exe` is found (`cloudflared:
   … (next to the program)` in the start-up lines).

## Evidence

- Implementation: `spikes/s1-phone-bell/src/host/{transport,tunnel,server}.ts`,
  `src/web/hgp-client.ts`; launcher `spikes/i2-web-phones/scripts/{preflight,launch}.mjs`.
- Unit tests: `spikes/s1-phone-bell/test/transport.test.ts` (mode, lookup order, join-URL choice,
  route classification, upgrade policy, dedupe, cloudflared output parsing, supervisor),
  `spikes/i2-web-phones/test/preflight.test.mjs` (modes, lookup order, findings).
- Local smoke test, 2026-11-09, Windows 11, Node 22.18, Chrome via playwright-core with Pixel 7
  emulation, host on 127.0.0.1 with `--lan-only --rtc on`
  (`node spikes/i2-web-phones/scripts/controller-check.mjs --rtc=on`):
  - The data channel opened and the phone showed `connected (direct)`; it stayed open for the
    whole song.
  - Silent Night (easy): 30/32 hits, 28 perfect, timing offset p50 9.4 ms, 2 strays.
  - Ring→TV latency p50 17 ms. This was on loopback, so it doesn't measure the tunnel.
  - The same check without `--rtc` (WebSocket only) also passed. No cloudflared on that PC, so
    the tunnel itself is an owner check.
- Background: [ADR-0006](0006-phone-host-transport.md), [S1 report](../spikes/S1-report.md)
  options a/b/c, [connectivity research](../research/connectivity-and-deployment.md).
