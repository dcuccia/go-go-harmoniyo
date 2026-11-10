# Coordinator handoff

Written 2026-10-27, when coordination moved from the original Copilot App chat (2026-10-22 to
2026-10-27, started before this repo existed) to a coordinator session in the
`go-go-harmoniyo` project. Read this first, then [AGENTS.md](../../AGENTS.md),
[docs/roadmap.md](../roadmap.md) and [the alpha plan](v0.1-alpha.md).

## Role of the coordinator

The owner (@dcuccia, CTO) sets direction and makes decisions. Agents do the work. The
coordinator:

- turns owner requests into child sessions with self-contained kickoffs (quote the owner
  verbatim, give context, set scope limits, list which files parallel sessions are editing,
  ask for a ready-for-review PR and a report back);
- reviews reports and **merges PRs itself when CI is green and the work stays in the agreed
  scope** (owner's standing instruction), using merge commits and keeping branches;
- never merges anything that needs an owner decision or review: ADR status changes,
  pending AI/asset resemblance reviews, policy changes, publishing or registering anything
  outside this repo;
- never fakes a human review (ADR-0008);
- keeps the owner's to-do list short and current.

Working conventions learned so far:

- New child sessions often need the owner to type `/allow-all` before they can use the shell.
- Parallel sessions that touch the same files: tell each which files the other owns, merge
  in order, and send "main moved, rebase" notes after each merge.
- Practice speed stretches every S5 field named `time` or ending in `Sec` and multiplies
  `bpm`. New time fields must follow that naming.
- E2E tests use non-default ports (18080+ and others; see the port test). The owner's TV
  host defaults to **18900** (loopback, falls back to the next free port).
- Docker/WSL on the owner's PC holds port 8080.
- `gh` here uses `GH_TOKEN`, which can't push packages. Publish images through GitHub
  Actions (see `.github/workflows/s6-amt-image.yml`).
- With `gh issue create`/`gh pr create`, pass bodies via `--body-file`; inline bodies with
  quotes break on PowerShell.

## Where things stand

- **Product:** the web game in `spikes/i2-web-phones`, built on S1 (phone host, controller
  and the HGP protocol), S4 (renderer, judge), S5 (chart pipeline) and procedural backing.
  Start with `npm start` from the repo root (preflight checks). With cloudflared installed it
  joins phones through a cloud tunnel and upgrades them to a direct WebRTC link on the same
  Wi-Fi,   falling back to the LAN QR without it or when the tunnel isn't ready within 60 s (ADR-0012, Accepted 2026-11-09; 60 s chosen 2026-11-10). `--lan-only` / `--tunnel`
    force one route. Friends without a clone can use the portable Windows zip (#77).
- **Features in place:** seating chart and phone part picker; drop-in join with a corner QR;
  practice speed 50–100 %; Super easy / Easy / Medium / Hard; balanced role-aware parts with
  a chord-split option; 2–3 minute songs that develop; fast-ring detection (Normal/Quick);
  richer backing and SFX; one tab per phone with takeover; Go Go HarmoniYo branding (G2
  lockup, Yo Y1 mark, dark first).
- **Songs on main:** 16. The 9 self-encoded carols in #62 would bring it to 24.
- **Decisions:** ADRs 0001–0013 are Accepted; ADR-0014 (TV/tablet app hosts, no PC) is
  Proposed until a device check. See [docs/decisions](../decisions/README.md).
  The YoYo origin story (brand.md) is approved. Brand: G2 candlelight 1.5×, Y1 Wink mark,
  Y8 favicon, Yo states Y3/Y4/Y2–Y5.
- **Policies:** code MIT; original art/audio/charts CC BY 4.0; AI-generated assets CC0 with
  provenance and a human resemblance review before merge; no NC/ND licences. Copyleft only
  through the adoption gate in ADR-0008. "Real arrangements": PD hymnal SATB is fine;
  published modern arrangements need publisher licensing. Copyrighted songs (Guaraldi,
  Wilhousky's Carol of the Bells, fan charts) are excluded.
- **YARG:** community/experimental track. Fork `dcuccia/YARG@handbell-spike` (tag
  `handbell-spike-2026-10-23`), built at `C:\Projects\YARG-handbell-build`. No product
  dependency on it.

## Open work

| Item | Status | Who |
|---|---|---|
| #62: 9 self-encoded carols | CI red only on the 9 pending reviews, by design | Owner reviews, then coordinator records and merges |
| #29: alpha playtest with 2+ phones | **Closed 2026-11-10 on the owner's call**: played #78 on an M1 iPad Pro and a Pixel. Reopen if a playtest shows problems | — |
| #30: proofread carols | Jingle Bells, Deck the Halls and O Come All Ye Faithful fixed | Owner |
| #31: first iPhone test | **Closed 2026-11-10 on the owner's call**: the iPad (same WebKit engine) stands in for the iPhone. Reopen if an iPhone shows problems | — |
| #45: reserve domain and handles | gogoharmoniyo.com and handles were free on 2026-10-23 | Owner |
| #47: AI node token | **Closed 2026-10-27** after a live authenticated smoke (healthz, models, chat, `smoke-file` job) | — |
| AI node live runs (S6) | qwen3:8b chord/descant experiments **done on the node 2026-10-27** (S6 report §d; verdict unchanged). AMT image `sha256:93e86a83…ec21` (duration clamp, #73/#74) registered by cuccia-infra 2026-10-27. **AMT 3 carols × 3 seeds run on the node 2026-11-10**: 9/9 succeeded, ~18–21 s per carol, 1.5 GiB VRAM, but the medium model's output is nearly empty (0–18 notes, almost all in the first ~4 s). fp16, drum filtering and top_p 0.98 were ruled out; `history_seconds` raises inside `anticipation`. S6 report "Live node runs" has the details. All outputs are candidates, review pending | None now. AMT follow-up (history fix, seeding with S5 accompaniment) is optional, post-Thanksgiving |
| #26: TV cert/network help | Held for the owner (new TV UI) | Coordinator, after owner OK |
| Thanksgiving family event (2026-11-26) | Owner's goal (asked 2026-11-09). The owner hosts with `npm start` from a clone; phones scan the QR. #78, #29 and #31 are done; the venue is the owner's home Wi-Fi (verified). The owner also wants to share the Windows zip with friends and colleagues (2026-11-10), via the `v0.1.0-alpha` GitHub pre-release | Owner; coordinator supports |
| #78: auto tunnel + direct WebRTC upgrade, [ADR-0012](../decisions/0012-auto-tunnel-direct-upgrade.md) **Accepted 2026-11-09**, **merged 2026-11-10** | Owner tested on an M1 iPad Pro (iPadOS 26.7.1) and a Pixel: both reached direct. Fixes before merge: the iPad "Undo Typing" popup (5751621: clears the WebKit undo stack on Start and blocks multi-touch/gesture defaults) and tunnel readiness (8a25c07 and 5751621: 4 public resolvers, NXDOMAIN gives a fresh address after ~12 s, the TV stays on "starting"). The owner rechecked the iPad fixes after merge (no undo popup, pinch ignored). **LAN-QR wait decided 2026-11-10: option B, 60 s** ("60s sounds good"); the default changes in the #28 release-prep PR | — |
| #43: portable Windows zip | **Merged as #77 on 2026-11-09**: `windows-package.yml` builds a Node SEA exe, pinned `cloudflared.exe`, the `.cmd` launcher, notices and SHA256SUMS. Nothing was published, tagged or signed. **Owner approved a GitHub release with the zip (2026-11-10).** On a `v*` tag the workflow now attaches the zip and SHA256SUMS to a draft pre-release | Owner: clean-account test in Windows Sandbox (harness ready in `%USERPROFILE%\GoGoHarmoniYo-sandbox\`; needs the pending restart). Signing: see S8 |
| #28: alpha release | **Published 2026-11-10** as the pre-release [v0.1.0-alpha](https://github.com/dcuccia/go-go-harmoniyo/releases/tag/v0.1.0-alpha) (#83; tag on 0104264). The tag build attached `go-go-harmoniyo-0.1.0-alpha-windows-x64.zip` and SHA256SUMS. The notes mark all 16 carols "Proofread by the owner: Not yet" (#30). #26 (TV help) is still open | Owner: clean-account (Windows Sandbox) test of the release zip; proofread carols (#30) and update the notes table |
| S8: store delivery and code signing | **Done.** #84 merged 2026-11-10: [report](../spikes/S8-report.md); **ADR-0013 Accepted 2026-11-10** (SignPath Foundation now, Certum ~€49/yr fallback, Microsoft Store later; Azure rejected on cost). #86 put the SignPath line in the v0.1.0-alpha notes; #87 added the privacy notice to the zip's README.txt and launcher output (SignPath terms) | Owner: check GitHub MFA, **submit the SignPath application** (report §1, ready-to-paste table), publisher name and IP vs the Modulim employment agreement (report §4), name clearance (ADR-0009) before public listings. Agents, after SignPath accepts: `build.mjs` signing hook + SignPath release workflow (~1.5 agent-days) |
| S9: TV/tablet app hosts, no PC (ADR-0014 prototype) | **Merged as #88 on 2026-11-10** ([report](../spikes/S9-report.md)). `HostSession` extracted from the S1 Node host (shared with the page; a review found no regressions in `npm start` or the zip). Cloudflare Worker + Durable Object signalling in `spikes/s9-page-host/worker` (run only locally; nothing deployed); WebRTC data channels; Capacitor 8 shells: `s9-page-host.yml` builds a debug Android TV/tablet APK and an unsigned iPad simulator build. Emulated: join 22 ms p50, sync error < 1 ms p95, Silent Night 32/32. No real device has run it | Owner: `npx wrangler login` + `npx wrangler deploy` in `spikes/s9-page-host` (personal Cloudflare account), set the repo variable `S9_SIGNAL_ORIGIN`, run `s9-page-host`, sideload the APK on the Gemini (report §5), then decide ADR-0014. Agents after acceptance: report §6 (HGP data-channel contract, productise, release keystore, TestFlight job, Maven notices) |
| Holiday milestone (#17, #20, #33, #34, #36–#39, #41–#44, #48, #55, #59) | v0.2 holiday, Dec 18 | Mixed |
| #58: bring-your-own MIDI import | Follow-up | — |

## AI compute node (cuccia-infra contract v0)

- Base `https://north.local` (private CA). The published value `78F6AA75…3357CC` is the CA
  certificate's SHA-256 **fingerprint**, not a hash of the PEM file; since #73 the client
  accepts either. The file is in `%USERPROFILE%\.cuccia\ai-worker\`. User-scope env vars
  `CUCCIA_AI_BASE_URL`, `CUCCIA_AI_CA_CERT` and `CUCCIA_AI_TOKEN` are set on the laptop. The
  client reads them from the User scope if the process lacks them. Never print the token.
- The node `dcuccia-north` resolves to **192.168.70.11** (192.168.70.202 was stale), RTX 3080 Ti
  12 GB, VRAM budget 10 GiB. It **drops ICMP echo**, so ping fails while HTTPS works. ARP answers
  from MAC `A0-36-9F-A2-89-B6`, but `/node/status` advertises Wake-on-LAN MAC
  `08-BF-B8-29-4D-46` (another NIC), which may be why wake from sleep failed. The node is
  LAN-only and may sleep.
- LLM `qwen3:8b` via `/v1` (`reasoning_effort: "none"`): ~110 tokens/s, 1–1.6 s median per
  call. Batch jobs via `/jobs`.
- Containers must be registered by infra from a manifest. There's no endpoint to list
  registered workloads, so the owner confirms registration.
- AMT image: `ghcr.io/dcuccia/go-go-harmoniyo-amt@sha256:93e86a83279711321a9e85c931ba5e0107c36fe621862acd24879c8578fcec21`
  (run 40565289683, with the duration clamp). The old `a3df2566…f097` crashes on over-long
  durations; don't use it. The manifest and the note for infra are in
  `spikes/s6-ai-arranging/amt/`. Run per seed with
  `node scripts/amt-run.ts --node --songs … --seed N --out amt-node/seed-N`.
- S6 finding (local and live): qwen3:8b can't arrange; procedural/rule-based is the path. The
  owner's blind-listening favourite was Deck the Halls B (LLM intro/ending only).
- Infra follow-ups: dcuccia/cuccia-infra#8 (wake, VPN, registry, CA, larger LLM tier).

## Owner preferences

- Wants to be involved in technology choices; otherwise "lean on your recommendations".
- Values cross-platform reach, zero-friction joining, license hygiene with no "sketchy
  vibes", and engaging, kid-friendly play.
- Prefers that UI changes not be made without discussion when he flags something as an
  idea (#20 was handled that way).
- Is often away from the home network. LAN-only resources (the AI node) are then
  unavailable.
- Accounts (all personal, under the owner's own login): Google Play Console (it also has a
  separate Modulim work organisation; keep this project out of it), Apple Developer (also used
  for stripe-m2-pos) and **Cloudflare** (not used by the repo so far; the join QR uses anonymous
  quick tunnels). The owner runs every login (`wrangler login` and so on); agents never create
  accounts, deploy or upload builds.
- App direction (2026-11-10): "Online is fine for the app": the TV/tablet app hosts, phones
  scan a QR code to a trusted web page, and a small free cloud service connects them. The PC
  zip stays the offline option. Test distribution only (sideloaded APKs and TestFlight, shared
  via GitHub Releases) until name clearance.
