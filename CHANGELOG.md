# Changelog

All notable changes to Go Go HarmoniYo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html) with a pre-release label
for alphas (`0.1.0-alpha`, then `0.1.0-alpha.2`). The version lives in
`spikes/i2-web-phones/package.json` and is shown in the lobby footer.

## [Unreleased]

## [0.1.0-alpha] - 2026-11-10

The first playable alpha: a party rhythm game where the PC shows the game on the TV and 1–4
people ring bells with their phones. Milestone:
[v0.1.0-alpha](https://github.com/dcuccia/go-go-harmoniyo/milestone/1). Release notes:
[docs/release/v0.1.0-alpha.md](docs/release/v0.1.0-alpha.md).

### Added

- One-command start from a clone: `npm start` at the repo root checks the setup (Node version,
  ports, network adapter, Windows Firewall, guest networks, cloudflared), installs, builds and
  starts the game; `npm start -- --check` runs the checks only
  ([#25](https://github.com/dcuccia/go-go-harmoniyo/issues/25), #52).
- Phones join by scanning a QR code on the TV. By default the game uses a Cloudflare quick
  tunnel (a real certificate, works on any network) and upgrades phones on the same Wi-Fi to a
  direct WebRTC link; without internet it falls back to the Wi-Fi address. `--lan-only` and
  `--tunnel` force one route ([ADR-0012](docs/decisions/0012-auto-tunnel-direct-upgrade.md), #78).
- Portable Windows zip: no Node.js, npm or install needed. Double-click
  `Play Go Go HarmoniYo.cmd` ([#43](https://github.com/dcuccia/go-go-harmoniyo/issues/43), #77).
  Tagged builds attach the zip and `SHA256SUMS.txt` to a draft GitHub release.
- 16 public-domain Christmas carols: 5 self-encoded lead sheets and 11 hymnal settings from the
  Mutopia Project, each with full and short forms (#57, #65, #68).
- Difficulties Super easy, Easy, Medium and Hard; 1–4 ringers; arrangements Balanced
  (role-aware parts), Chord split and By range; songs that develop over 2–3 minutes (#65).
- Seating chart lobby: drag players onto parts, or let phones pick their own part (#23).
- Drop-in joining with an always-visible corner QR, and practice speed from 50 % to 100 % (#61).
- Procedural backing track from the chord symbols, plus performance sound effects (#22, #64).
- Fast repeated rings (eighths and sixteenths), with Normal and Quick ring sensitivity (#64).
- Bells coloured by pitch class, the same on the TV and the phones
  ([#12](https://github.com/dcuccia/go-go-harmoniyo/issues/12), #16).
- Go Go HarmoniYo branding in the game: logo, Yo mascot states and favicon (#70, #71).
- Version shown in the lobby footer.
- CI for the web game, a WebKit smoke test for the phone controller, and the Windows package
  build and smoke test ([#24](https://github.com/dcuccia/go-go-harmoniyo/issues/24), #50, #77).

### Changed

- The TV TCP port defaults to 18900, with automatic fallback when it's busy (#60).
- The TV waits up to 60 s for the tunnel before it shows the Wi-Fi QR (`--lan-qr-after`, the
  owner's choice in ADR-0012; it was 15 s in #78).
- One browser tab per phone: a second tab takes over instead of fighting the first (#66).

### Fixed

- Phone reconnect ping-pong when two tabs share one device ID (#66).
- Flaky end-to-end test ([#18](https://github.com/dcuccia/go-go-harmoniyo/issues/18), #51).
- Crash when the QR code was requested before the tunnel address existed (#19).
- Collapsing part dropdown in the lobby (#23).
- Wrong notes in Jingle Bells, Deck the Halls (#57) and the refrain of O Come, All Ye Faithful
  (#68).
- iPad: the "Undo Typing" popup and pinch-zoom during play; tunnel start-up when the new address
  isn't resolvable yet (#78).

### Known issues

- The Windows exe isn't code-signed: SmartScreen asks *More info → Run anyway*, and Smart App
  Control blocks it.
- No carol has been proofread by the owner yet
  ([#30](https://github.com/dcuccia/go-go-harmoniyo/issues/30)); some may have wrong notes.
- iPhone wasn't tested directly (an iPad Pro was).
- The tunnel needs internet; without it, phones must be on the PC's Wi-Fi and each shows a
  one-time certificate warning. Help next to the QR on the TV is
  [#26](https://github.com/dcuccia/go-go-harmoniyo/issues/26).
- Up to 4 ringers ([#33](https://github.com/dcuccia/go-go-harmoniyo/issues/33)); swing to ring
  only, Tap mode is [#20](https://github.com/dcuccia/go-go-harmoniyo/issues/20).
- A phone that reconnects mid-song loses the next-bell glow
  ([#36](https://github.com/dcuccia/go-go-harmoniyo/issues/36)); one A/V offset for the whole TV
  ([#37](https://github.com/dcuccia/go-go-harmoniyo/issues/37)).
- The TV host was tested on Windows 11 only.

[Unreleased]: https://github.com/dcuccia/go-go-harmoniyo/compare/v0.1.0-alpha...HEAD
[0.1.0-alpha]: https://github.com/dcuccia/go-go-harmoniyo/releases/tag/v0.1.0-alpha
