# 0014 — Store-era host: the TV or tablet app is the host

- Status: Proposed. The S9 working prototype (run in a separate session) informs acceptance.
- Date: 2026-11-09; revised 2026-11-10 to the owner's direction
- Deciders: @dcuccia (owner); proposed by the S8 spike session
- Related: [ADR-0004](0004-host-strategy.md) (web-first host), [ADR-0005](0005-shared-core-language.md)
  (TypeScript core), [ADR-0006](0006-phone-host-transport.md) and
  [ADR-0012](0012-auto-tunnel-direct-upgrade.md) (transport), [ADR-0009](0009-product-name.md)
  (name clearance), [S8 report](../spikes/S8-report.md) §2

## Context

The owner wants iOS, Android and Android TV (DIRECTV Gemini) app delivery. On 2026-11-10 he
said: "thin wrappers that require a host pc avoid the main benefit of packaging/distributing as
an app." So the app itself must be the host. **No PC is involved.**

His direction, 2026-11-10: "Online is fine for the app: TV/tablet app hosts, phones scan a QR to
a trusted web page, small free cloud service connects them; PC zip stays the offline option."

Today the TV page is a client of a **Node host** that provides:

- HTTPS and WebSocket HGP;
- clock sync;
- werift WebRTC;
- cloudflared supervision.

None of these moves easily into an app:

- nodejs-mobile's official release is Node 18 (end-of-life);
- cloudflared has no Android build;
- iOS allows servers only in the foreground;
- tvOS has no web view.

A native host in Kotlin or Swift would be a second implementation of the host, against
ADR-0005's single TypeScript core.

The game and the host logic are TypeScript and already run in a browser. Android TV's WebView is
Chromium, updated through Play. iPadOS's WKWebView supports WebRTC data channels (`RTCPeerConnection`)
from iOS 11.

The owner's Gemini is probably the V2 (Android TV 14). It has **no browser**, so it needs an
app. He is checking whether it allows sideloading.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| (a) Node host inside the app (nodejs-mobile) | Reuses host code | End-of-life runtime; cloudflared and werift packaging; high risk on iOS and Android TV |
| (b) Native host per platform (Kotlin/Ktor + libwebrtc; Swift + NWListener) | Full control; works offline on the LAN | 10–25 agent-days per platform; a second host to keep in sync with HGP |
| (c) **The app hosts in its WebView** (details under Decision) | One TypeScript host; no server in the app; no certificate warnings; the same game on every device | Needs internet to load the controller and to signal; TURN on isolated networks (e.g. some guest Wi-Fi); WebView WebRTC must be proven on the Gemini and iPad; a hosted service to run |
| (d) Thin wrapper that loads the game from a PC host | Smallest app | **Rejected by the owner:** it still needs a PC |
| (e) Cast receiver only | Cheapest TV path | Still needs a host somewhere |

## Decision

Proposed: **(c)**, with test builds first and public store listings later.

1. **The app is the host.** An Android TV app (Gemini and other boxes), an Android tablet app and
   an iPad app each bundle:
   - the game;
   - the TypeScript host logic: session, clock-sync server side, HGP handling.

   Both run in the app's WebView. There is no PC and no server inside the app.
2. **Phones keep the web controller.** They scan the QR on the TV and open a **trusted public
   web page**, the web controller on static HTTPS hosting (e.g. GitHub Pages or Cloudflare Pages).
   There is nothing to install and no certificate warning. Native controller apps are not
   planned.
3. **A small free cloud service connects them.** It is a signalling service, e.g. a Cloudflare
   Worker with a Durable Object on the free tier. It introduces each phone to the host app. Then
   **WebRTC data channels** between phone and app carry HGP and clock sync. TURN is used only
   where a direct path fails.
4. **The PC zip and `npm start` stay the offline option.** They keep the local Node host and the
   LAN fallback (ADR-0006/0012).
5. **The S9 working prototype** runs in a separate session. It builds the shell, the hosted
   controller and the signalling service. Its results inform acceptance:
   - join time;
   - connection success on home Wi-Fi, guest Wi-Fi and mobile data;
   - round-trip time and clock-sync quality over the data channel;
   - whether TURN is needed;
   - WebView WebRTC and WebGL on the Gemini and an iPad.

   S9 also picks the shell framework. The candidates:
   - Expo/React Native with `react-native-webview`: the owner's stripe-m2-pos stack. Expo builds
     Android TV through `react-native-tvos`.
   - Capacitor.
   - Minimal native WebView shells.
6. **Distribution:**
   - Test builds go out as soon as S9 works:
     - sideloaded APKs on GitHub Releases (Gemini, Android TV boxes, Android tablets);
     - TestFlight for the iPad.
   - **Only public store listings** (Google Play, App Store, Microsoft Store) wait for name
     clearance (ADR-0009).
7. **Rejected:**
   - (d) thin wrappers that need a PC;
   - a native Apple TV host (tvOS has no web view);
   - (a) and (b) unless S9 fails.

## Consequences

- If accepted, this amends ADR-0006/0012: HGP gets a data-channel transport whose signalling
  isn't the host's own WebSocket. Version it in the HGP contract (ADR-0005 golden vectors).
- The game in the app needs internet: to load the controller page, to signal and, sometimes,
  for TURN. Offline play stays on the PC.
- A hosted signalling service, and possibly TURN, becomes something to run. It is free at our
  scale, but it is a privacy item:
  - a privacy statement;
  - no logging of gesture data;
  - decisions on the domain and the hosting account.
- The web controller gets a public origin. This ties into the ADR-0009 domain reservations.
- Android TV apps need D-pad navigation, a leanback launcher entry and a banner. iPad builds
  need an Apple build machine or a cloud build service. Store listings need privacy forms and age
  ratings ([S8 report](../spikes/S8-report.md) §3).

## Evidence

- [S8 report](../spikes/S8-report.md) §2: Gemini hardware and Play, nodejs-mobile status,
  cloudflared on Android, iOS foreground and local-network limits, tvOS, Cast receiver.
- Expo, [Build Expo apps for TV](https://docs.expo.dev/guides/building-for-tv/) (modified
  2026-11-02, accessed 2026-11-10).
- [Connectivity and deployment research](../research/connectivity-and-deployment.md): the
  packaging options and the hosted-PWA plan.
