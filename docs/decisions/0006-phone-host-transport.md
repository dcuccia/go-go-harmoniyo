# 0006 — Phone ↔ host transport

- Status: Accepted (owner, 2026-10-25; [#32](https://github.com/dcuccia/go-go-harmoniyo/issues/32))
- Date: 2026-10-23
- Deciders: @dcuccia (owner); proposed by the S1 spike session

## Context

Phones act as handbells through a web page (ADR-0003). iOS and Android expose motion sensors
only in a **secure context**, so the controller page must be served over HTTPS, or from
`localhost`, which a phone can't use for the PC. The host is a PC on home Wi-Fi for the alpha
(Nov 15, Pixel phones) and holiday release. Later it is a classroom machine on a managed network
that often isolates clients. Judging uses source timestamps on a synchronised clock (ADR-0002),
so transport latency affects feedback but not scoring. See the
[S1 report](../spikes/S1-report.md).

## Options considered

| Option | Pros | Cons |
|---|---|---|
| (a1) WSS on LAN, auto-generated self-signed cert | Free, no domain, no cloud, works offline; lowest latency; built and tested | One certificate warning per phone (30-day cert cached); managed devices may block the bypass; iOS post-bypass behaviour unverified |
| (a2) WSS on LAN, publicly trusted cert (DNS-01, LAN hostname) | No warnings for players; lowest latency | Owner needs a domain + DNS API + renewal automation; DNS-rebinding protection on some routers; not viable for schools |
| (b) WebRTC data channel (page from GitHub Pages, cloud signalling) | No warnings; LAN P2P; unordered/unreliable channel avoids head-of-line blocking | Signalling service to run; ICE fails on isolated networks (then needs TURN); WebRTC stack in every host engine |
| (c) Cloud relay (e.g. Cloudflare quick tunnel) | No warnings, zero LAN config, **works through client isolation** | Internet dependency, +~50 ms feedback latency, third-party best-effort service |

## Decision

Accepted (owner, 2026-10-25):
1. **Alpha:** (a1) WSS on the LAN with a self-signed certificate as the default, and (c) the
   cloud tunnel as a one-flag fallback (`--tunnel`). HGP over WebSocket is mandatory for every
   host (`/hgp`); the WebRTC data channel stays optional.
2. **Holiday release:** after the physical tests, choose between (a2) if the owner wants a
   domain, and (b) to remove the warning, based on the iPhone results.
3. **Classroom:** (c), or (b) with TURN, because client isolation is common.

## Consequences

- Any host engine must speak HGP v0 over WSS and answer `sync` immediately. Engines that can't
  serve TLS themselves can sit behind the Node harness or a tunnel.
- The runbook must explain the one-time certificate warning (with screenshots for iOS/Android).
- Timing judgements must allow an arrival lookahead (~200 ms worst case on Wi-Fi power-save),
  which matters most for the relay.

## Owner decision (2026-10-25)

Accepted as proposed ([#32](https://github.com/dcuccia/go-go-harmoniyo/issues/32)). Point 2 is
settled for the holiday release by [#35](https://github.com/dcuccia/go-go-harmoniyo/issues/35):
keep the **self-signed certificate as the default**, with the **cloud tunnel (`--tunnel`) as the
one-flag fallback** for guests. A publicly trusted certificate (a2) comes later, once a domain
exists ([#45](https://github.com/dcuccia/go-go-harmoniyo/issues/45)). The TV page help (#26) and the
how-to-play page (#38) cover both paths.

## Evidence

- [S1 report](../spikes/S1-report.md): transport table, emulated sync error per network, browser E2E
- [spikes/s1-phone-bell](../../spikes/s1-phone-bell/): `npm start`, `npm run tunnel`, `?rtc=1`
- Pending physical tests on Pixel/iPhone (runbook tests A–E)
