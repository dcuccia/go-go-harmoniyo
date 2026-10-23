# Architecture decision records

Format: one file per decision, `NNNN-short-title.md`, using [the template](0000-template.md).
Status: `Proposed` → `Accepted` (owner only) → optionally `Superseded by NNNN`.

| ADR | Title | Status |
|---|---|---|
| [0001](0001-planning-repo.md) | Dedicated planning/product repo, MIT | Accepted |
| [0002](0002-decouple-app-from-hardware.md) | Decouple the game from hardware via a gesture protocol | Accepted |
| [0003](0003-holiday-v1-scope.md) | Holiday 2026 v1 scope | Accepted |
| [0004](0004-host-strategy.md) | Host strategy: web-first host on an engine we own; YARG fork as a community/experimental track | Accepted (2026-10-23) |
| [0005](0005-shared-core-language.md) | Shared core: TypeScript; HGP + chart JSON as language-neutral contracts with golden test vectors | Accepted (2026-10-23) |
| [0006](0006-phone-host-transport.md) | Phone ↔ host transport | Proposed (S1); pending owner |
| [0007](0007-chart-format.md) | Chart format | Proposed (S5); pending owner |
| [0008](0008-assets-ip-and-attribution.md) | Assets, IP and attribution: MIT code, CC BY 4.0 original assets, CC0 AI assets; REUSE, license gate, asset register | Accepted (2026-10-23), incl. copyleft adoption gate |
| [0009](0009-product-name.md) | Product name: Go Go HarmoniYo (mascot HarmoniYo, "Yo"); repository `dcuccia/go-go-harmoniyo` | Accepted (2026-10-23); amended 2026-10-23 (repository renamed, code name retired) |

Background for 0004–0007: [M2 decision brief](m2-decision-brief.md) and
[connectivity and deployment research](../research/connectivity-and-deployment.md).
