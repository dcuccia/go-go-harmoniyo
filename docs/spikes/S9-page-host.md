# S9 — The host in the page: TV/tablet app, no PC (brief)

- Feeds: E03 (host), E02 (phone controller), E11 (distribution), E01 (transport)
- Requested: 2026-11-10 by the owner, via the coordinator session, to inform Proposed
  [ADR-0014](../decisions/0014-store-era-host-architecture.md)
- Time box: a working prototype in about 3 agent-days
- Report: [S9-report.md](S9-report.md); prototype: [`spikes/s9-page-host/`](../../spikes/s9-page-host/README.md)

## Why

The owner, verbatim (2026-11-10):

> thin wrappers that require a host pc avoid the main benefit of packaging/distributing as an app
> ... i got something x-plat in apple testflight and .apk side-load from scratch in less than a
> week for the stripe-m2-pos project

He chose: "Online is fine for the app: TV/tablet app hosts, phones scan a QR to a trusted web
page, small free cloud service connects them; PC zip stays the offline option."

Targets: a DIRECTV Gemini (probably the V2: Android TV 14, Amlogic S905X5, no browser, so a
sideloaded APK) and an M1 iPad Pro (TestFlight). Distribution is test-only for now: APKs on
GitHub Releases and TestFlight for colleagues, under the owner's personal Play Console, Apple
Developer and Cloudflare accounts.

## Question

Can the TV or tablet page host the game with **no PC**: the TypeScript host logic in the page,
phones on a trusted HTTPS controller, introduced by a small free signalling service, and HGP plus
clock sync over WebRTC data channels? What does that cost in join time, connection success and
timing, compared with today's Node host?

## Do

1. **Host logic in the page.** Reuse the S1 host and I2 game code (extract, don't rewrite). Carry
   HGP messages and clock sync over WebRTC data channels between the phone controller page and
   the TV page.
2. **Trusted controller + signalling.** Phones load the controller from a trusted HTTPS origin (no
   certificate warning; motion sensors need a secure context) and are introduced through a small
   free-tier signalling service (e.g. a Cloudflare Worker + Durable Object). Evaluate whether TURN
   is needed: home Wi-Fi, guest/AP-isolated Wi-Fi, phone on mobile data.
3. **App shells.** An Android TV shell (WebView, Capacitor or Expo, with reasons) with a leanback
   launcher entry and D-pad support, producing a debug- or self-signed APK sideloadable on the
   Gemini. An iPad shell buildable for TestFlight, or a written plan if no Mac is available. Note
   the CI options (EAS, GitHub macOS runners).
4. **Measure** join time, connection success, data-channel RTT and jitter versus today's
   WebSocket and direct (werift) WebRTC paths, and the timing-judgement impact. Record devices and
   versions; use emulation or headless browsers where real devices aren't available, and say so.

**Don't:** create accounts, log in, deploy (Worker, Pages), enable GitHub Pages, upload to Play or
TestFlight, or register a domain. Run the signalling service locally (`wrangler dev` or a Node
stand-in) and use a local trusted HTTPS option or the cloudflared quick tunnel for phones. List
the owner's deploy steps instead. Keep the Node host, the Windows zip and CI working; don't change
ADR-0014's status.

## Kill criteria

- If the host logic can't run in a browser page without a rewrite, stop and say what blocks it.
- If data-channel clock sync is materially worse than the WebSocket path (p95 sync error beyond
  S1's 15 ms budget), or connections fail on ordinary networks without TURN and TURN can't be had
  on a free tier, report that ADR-0014 (c) doesn't hold.

## Report must answer

1. **Does the host run in the page?** What was extracted and reused, what changed in S1/I2, and
   how HGP and clock sync ride the data channels.
2. **Trusted controller and signalling.** The design, its free-tier fit and limits, privacy, and
   whether TURN is needed on home Wi-Fi, guest/AP-isolated Wi-Fi and mobile data.
3. **App shells.** The framework choice with reasons; the Android TV APK (leanback, banner, D-pad);
   the iPad path to TestFlight; CI options.
4. **Measurements.** Join time, connection success, RTT and jitter versus today's paths, clock-sync
   error and the timing-judgement impact; devices, versions and what was emulated.
5. **Owner steps.** Deploying the signalling Worker (and TURN), getting the APK onto the Gemini,
   and the TestFlight path.
6. **Recommendation for ADR-0014** and the next steps (without changing its status).
