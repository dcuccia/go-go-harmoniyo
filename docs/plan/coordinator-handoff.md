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
  Start with `npm start` from the repo root (preflight checks). Use `--tunnel` on guest or
  corporate networks.
- **Features in place:** seating chart and phone part picker; drop-in join with a corner QR;
  practice speed 50–100 %; Super easy / Easy / Medium / Hard; balanced role-aware parts with
  a chord-split option; 2–3 minute songs that develop; fast-ring detection (Normal/Quick);
  richer backing and SFX; one tab per phone with takeover; Go Go HarmoniYo branding (G2
  lockup, Yo Y1 mark, dark first).
- **Songs on main:** 16. The 9 self-encoded carols in #62 would bring it to 24.
- **Decisions:** ADRs 0001–0011 are all Accepted. See [docs/decisions](../decisions/README.md).
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
| #29: alpha playtest with 2+ phones | Gates the `v0.1.0-alpha` tag (Nov 15) | Owner |
| #30: proofread carols | Jingle Bells, Deck the Halls and O Come All Ye Faithful fixed | Owner |
| #31: first iPhone test | WebKit emulation passes 15/15 | Owner |
| #45: reserve domain and handles | gogoharmoniyo.com and handles were free on 2026-10-23 | Owner |
| #47: AI node token | **Done**: User env vars set on the laptop 2026-10-24 (`CUCCIA_AI_BASE_URL=https://north.local`, `CUCCIA_AI_CA_CERT`, `CUCCIA_AI_TOKEN`; the token is never logged). Can close once the node is verified live | Coordinator |
| AI node live runs (S6) | The node sleeps and Wake-on-LAN from sleep did not work. qwen3:8b experiments and AMT on GPU are still pending | Owner wakes the node; owner submits the AMT manifest to cuccia-infra |
| #26: TV cert/network help | Held for the owner (new TV UI) | Coordinator, after owner OK |
| #28: alpha release | After #29 | Coordinator |
| Holiday milestone (#17, #20, #33, #34, #36–#39, #41–#44, #48, #55, #59) | v0.2 holiday, Dec 18 | Mixed |
| #58: bring-your-own MIDI import | Follow-up | — |

## AI compute node (cuccia-infra contract v0)

- Base `https://north.local` (private CA; ca.crt fingerprint SHA-256
  `78F6AA75…3357CC`, file in `%USERPROFILE%\.cuccia\ai-worker\`). The node is at
  192.168.70.202, MAC `08-BF-B8-29-4D-46`.
- LLM `qwen3:8b` via `/v1` (`reasoning_effort: "none"`). Batch jobs via `/jobs`.
- Containers must be registered by infra from a manifest.
- AMT image: `ghcr.io/dcuccia/go-go-harmoniyo-amt@sha256:a3df25660696ed39d9c12f4e156738b906858891b341f822ec21f94c28a0f097`.
  The manifest and the handoff text for infra are in `spikes/s6-ai-arranging/amt/`.
- S6 finding: qwen3:8b can't arrange; procedural/rule-based is the path. The owner's
  blind-listening favourite was Deck the Halls B (LLM intro/ending only).
- Infra follow-ups: dcuccia/cuccia-infra#8 (wake, VPN, registry, CA, larger LLM tier).

## Owner preferences

- Wants to be involved in technology choices; otherwise "lean on your recommendations".
- Values cross-platform reach, zero-friction joining, license hygiene with no "sketchy
  vibes", and engaging, kid-friendly play.
- Prefers that UI changes not be made without discussion when he flags something as an
  idea (#20 was handled that way).
- Is often away from the home network. LAN-only resources (the AI node) are then
  unavailable.
