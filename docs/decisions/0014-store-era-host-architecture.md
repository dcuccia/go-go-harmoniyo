# 0014 — Store-era host: host in the page, thin store shells

- Status: Proposed. Needs the S9 spike before it can be accepted.
- Date: 2026-11-09
- Deciders: @dcuccia (owner); proposed by the S8 spike session
- Related: [ADR-0004](0004-host-strategy.md) (web-first host), [ADR-0005](0005-shared-core-language.md)
  (TypeScript core), [ADR-0006](0006-phone-host-transport.md) and
  [ADR-0012](0012-auto-tunnel-direct-upgrade.md) (transport), [S8 report](../spikes/S8-report.md) §2

## Context

The owner wants iOS, Android and Android TV (DIRECTV Gemini) store delivery as a stretch goal.

Today the TV page is a client of a **Node host** that provides:

- HTTPS and WebSocket HGP;
- clock sync;
- werift WebRTC;
- cloudflared supervision.

None of these runs well inside a store app:

- nodejs-mobile's official release is Node 18 (end-of-life);
- cloudflared has no Android build;
- iOS allows servers only in the foreground;
- tvOS has no web view.

A native host (Kotlin or Swift) would be a second implementation of the host, against ADR-0005's
single TypeScript core.

The connectivity research had already planned "a hosted PWA with WebRTC" as the step after the
local host.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| (a) Node host inside apps (nodejs-mobile) | Reuses code | End-of-life runtime; cloudflared and werift packaging; high risk on iOS and Android TV |
| (b) Native host per platform (Kotlin/Ktor + libwebrtc; Swift + NWListener) | Full control, works offline on the LAN | 10–25 agent-days per platform; a second host to keep in sync with HGP |
| (c) **Host in the page**: the TV/tablet page runs the host logic (session, clock-sync server side, relay to the game); phones connect over WebRTC data channels; a small hosted signalling service (e.g. a Cloudflare Worker/Durable Object) introduces them; the game is a static site with a trusted certificate | No server on the device; any modern browser or WebView can host (Gemini WebView shell, iPad Safari, Chromebook, Cast receiver); one TypeScript host; no certificate warnings | Internet needed to load and signal; TURN needed on isolated networks (guest Wi-Fi), at a cost; browser↔browser ICE (mDNS candidates) must be proven on iOS and Android; HGP over WebSocket is no longer the only transport (amends ADR-0006/0012); a hosted service to run |
| (d) Cast receiver only | Cheapest TV path | Still needs a host somewhere |

## Decision

Proposed: **(c)**, staged.

1. Keep the desktop Node host as the supported host for 2026: `npm start` and the portable zip.
2. Run **S9** (~2–3 agent-days) to prove the following before this ADR is accepted:
   - the existing host logic running in the TV page;
   - a phone ↔ page data channel through a hosted signalling Worker, on home Wi-Fi, guest Wi-Fi
     and mobile data;
   - the same HGP messages and clock sync carried over the data channel.

   Report join time, connection success rates, RTT and the TURN need.
3. If S9 passes:
   - store apps become **thin shells** around the hosted page: an Android TV WebView app with
     leanback and D-pad, sideloaded on the Gemini first; later a Play listing and a Cast
     receiver;
   - an iPad can host from Safari with no app.
4. Phones keep the **web controller via QR**. Native controller apps are not planned.
5. **Rejected:** a native Apple TV host. A native Android TV or iPad host is considered only if
   S9 fails.

## Consequences

- Amends ADR-0006/0012 if accepted: HGP gets a data-channel transport whose signalling isn't the
  host's own WebSocket. Version it in the HGP contract (ADR-0005 golden vectors).
- A hosted signalling service and possibly TURN become running costs and a privacy item.
  Needed: a privacy statement, no logging of gesture data, and a decision on the domain and
  hosting account.
- The game would need a public origin (GitHub Pages or a domain). This ties into the ADR-0009
  name reservations.
- Offline LAN play stays available through the desktop Node host.

## Evidence

- [S8 report](../spikes/S8-report.md) §2: Gemini hardware and Play, nodejs-mobile status,
  cloudflared on Android, iOS foreground and local-network limits, tvOS, Cast receiver.
- [Connectivity and deployment research](../research/connectivity-and-deployment.md): the
  packaging options and the hosted-PWA plan.
