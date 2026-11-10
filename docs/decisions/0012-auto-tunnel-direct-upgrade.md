# 0012 — Auto tunnel with a direct-LAN upgrade (amends ADR-0006)

- Status: Accepted (owner, 2026-11-09; [#78](https://github.com/dcuccia/go-go-harmoniyo/pull/78)).
  The LAN-QR wait ("Open follow-up" below) is not part of the accepted decision.
- Date: 2026-11-09
- Deciders: @dcuccia (owner); proposed by the auto-tunnel session (S6 coordinator)
- Amends: [ADR-0006](0006-phone-host-transport.md), decision point 1 and the 2026-10-25 holiday
  default. ADR-0006 is now "Accepted, amended by 0012".

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

## Decision

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
     - Wait before the first DNS query: 3 s for the first address, then 6, 9, 12 s for later ones
       (`tunnelFirstQueryDelayMs`).
     - Ask public resolvers run by different operators (1.1.1.1, 8.8.8.8, 9.9.9.9,
       208.67.222.222), never the OS resolver, until the hostname has an A/AAAA record. A
       resolver that answers "no such name" is never asked again (it would only repeat its cached
       answer for 60 s); the next one is asked 2, 3, then 4 s later. Once all four have said
       "no", the check fails at once (≈ 12 s) and cloudflared is restarted after 1 s for a fresh
       address. Only when no public resolver can be reached at all (a network that blocks them)
       is the OS resolver used.
     - Then `GET /tunnel-check` over HTTPS, connecting to that address, until it returns 200
       with this host's per-run token (≈ 45 s budget for both steps).
     - Only then does the QR/join URL become the tunnel URL, and the console prints the time to
       ready.
     - Why: measured 2026-11-09 (cloudflared 2026.10.7, Windows), the hostname resolves about
       2 s after cloudflared prints it. Any query in the first ~1 s gets NXDOMAIN, and every
       resolver (1.1.1.1, 8.8.8.8, the phone's and the OS's cache) keeps that answer for the
       zone's 60 s negative TTL. Publishing the URL at once made a scan straight away fail for a
       minute. With the check, a live run was ready 7.3 s after start-up (URL at 3.7 s, DNS
       answered on the first query at +3.0 s, HTTPS 0.5 s), and the first navigation from
       Windows (OS resolver, curl, Chrome) worked.
     - The owner's run on 2026-11-10 (data dir `2026-11-10T04-06-16`) showed the other case: the
       first address did not exist yet at +3 s, both resolvers then cached NXDOMAIN for longer
       than the 45 s budget, and the address was abandoned only after 45 s; the second address
       was ready at about 63 s. Since then, an all-"no" answer gives up after ≈ 12 s and the next
       address waits 6 s before its first query, so the same sequence should be ready in about
       25–30 s. A live run after the change was ready after 7.7 s (DNS at +3.0 s via 1.1.1.1).
       Residual risk: a router or ISP that intercepts port-53 traffic to public resolvers shares
       one cache for all four, and phones behind it could cache our early "no" too.
   - The TV shows "Starting the cloud tunnel…" for up to 15 s (`--lan-qr-after`, see "Open
     follow-up" below). A restart for a fresh address within that time keeps showing it instead of
     flashing the LAN QR.
   - With no cloudflared, no internet, or a tunnel that is not ready after 15 s, the QR is the
     LAN self-signed URL, as in ADR-0006 (a1). It switches to the tunnel URL once that is ready.
   - The LAN HTTPS listener always runs. Phones that already joined over the LAN keep working
     if the tunnel appears later.
   - cloudflared is supervised: up to 3 restarts, 5 s apart after a crash, 1 s apart after an
     address that never became reachable. A new tunnel URL changes the QR.
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
8. **Controller on iPad/iPhone:** typing the player name must leave nothing for iOS to undo.
   Ringing a bell is a shake, and "Shake to Undo" (or a three-finger swipe/tap) brought up the
   system "Undo Typing" dialog over the bells (owner, iPad Pro, 2026-11-10). On Start the name
   field is blurred and replaced, and a hidden iframe is attached and removed, which clears
   WebKit's page-wide undo stack (`forget-typing.ts`). Multi-finger touches and pinch gestures on
   the play surface are cancelled.

## Open follow-up for the owner: how long the TV waits for the tunnel

Not part of the decision accepted on 2026-11-09: the accepted default stays 15 s. Changing it is
a separate owner choice (a one-line default change, or `--lan-qr-after` per run).

While the tunnel is getting ready, the TV either shows "Starting the cloud tunnel…" (no QR) or
falls back to the Wi-Fi QR (self-signed: each first-time phone gets a certificate warning, and
in iPad Chrome a full-page "Your connection is not private"). In the owner's 2026-11-10 run the
Wi-Fi QR was on screen from 15 s to 63 s, which is how a phone got the warning. The flag
`--lan-qr-after <seconds>|never` exists now; the default is unchanged (15 s) until the owner
picks one:

- **(A) Keep 15 s.** Fastest QR when the tunnel is slow or blocked, but a slow tunnel start shows
  the warning-prone QR to whoever scans early, and those phones stay on the Wi-Fi route.
- **(B) 60 s.** Covers a fresh-address restart (≈ 12 s check + 1 s + second address ≈ 10–20 s)
  and most slow starts. When the tunnel truly can't work (blocked network), the QR appears after
  a minute instead of 15 s. *Recommended for the event.*
- **(C) `never`.** The Wi-Fi QR appears only when the tunnel has given up (3 restarts) or there
  is no cloudflared/internet. No certificate warning unless the tunnel is impossible, but if
  cloudflared hangs without printing an address the TV waits indefinitely (the runner can
  restart with `--lan-only`).

No cloudflared and no internet are detected within ~3 s at start-up, and they show the Wi-Fi QR
at once under every option.

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
  the same LAN. **Owner-verified 2026-11-10:** an M1 iPad Pro (iPadOS 26.7.1) in Safari and in
  Chrome reached `direct` (host log `rtc-open` via the tunnel). iPhone not yet tried. If it
  fails, the device simply stays on the tunnel.
- **Android Chrome:** standard WebRTC; host candidates may also be mDNS. **Owner-verified
  2026-11-10** on a Pixel: reached `direct`.
- **iOS editing gestures:** Shake to Undo and three-finger undo are system gestures a page can't
  cancel. The controller keeps the undo stack empty during play (decision 8); verified in
  Playwright WebKit (`document.queryCommandEnabled('undo')` true after typing, false after Start),
  and on a real iPad by the owner.
- **Guest Wi-Fi / client isolation / mobile data:** ICE fails by design, and the phone stays on
  the tunnel (the reason is shown).
- **Windows Firewall:** the direct path needs inbound UDP for Node.js. Accepting Windows' "allow
  access" prompt covers TCP and UDP. If UDP is blocked, the phone stays on the tunnel.
- **No werift** (optional dependency missing): no upgrade is offered; tunnel or LAN only.
- **Corporate networks** that block `*.trycloudflare.com` or UDP: the tunnel doesn't start, so
  the LAN QR is shown after 15 s (`--lan-qr-after`).

### Future work

- Keep the direct channel alive through a tunnel outage: move host→phone messages to it and
  treat it as the session, so a home-Wi-Fi game survives an internet drop.
- When the tunnel restarts with a new URL, push the new URL over the channel so phones move
  without rescanning.
- ADR-0006 a2 (trusted LAN certificate, #45) would remove the internet dependency of the first
  load.

## Owner checks (before the event)

Accepted 2026-11-09; item 1 is partly done (iPad and Pixel, see Platform limits). The rest stay
as pre-event checks.

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
7. iPad/iPhone: type a name, Start, then play with hard shakes and three/four-finger taps and
   swipes over the bells. No "Undo Typing" dialog appears (Settings → Accessibility → Touch →
   Shake to Undo left on). Repeat in Chrome on the iPad.
8. Start-up a few times: note the "Tunnel: ready … after N s" line, and that the TV never shows
   the Wi-Fi QR while the tunnel is restarting for a fresh address (unless it takes longer than
   `--lan-qr-after`). Then pick option A, B or C in the open follow-up above.

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
- Owner test, 2026-11-10, of 8a25c07: M1 iPad Pro (iPadOS 26.7.1, Safari and Chrome) and a Pixel
  (Android Chrome) both reached `direct` (host log `rtc-open` via the tunnel). Two issues found
  and fixed: the iPad "Undo Typing" dialog during play (decision 8) and the 45 s readiness
  failure described under decision 2.
- iPad undo fix: `node spikes/i2-web-phones/scripts/webkit-controller-check.mjs` (Playwright
  WebKit, iPhone 15 profile) types the name key by key; `document.queryCommandEnabled('undo')` is
  true before Start and false after. Replacing the element alone was enough in Chrome but not in
  WebKit, whose undo stack is per page; the iframe attach/detach clears it there.
- Background: [ADR-0006](0006-phone-host-transport.md), [S1 report](../spikes/S1-report.md)
  options a/b/c, [connectivity research](../research/connectivity-and-deployment.md).
