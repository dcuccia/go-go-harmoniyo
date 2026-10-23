# 0008 — Assets, IP and attribution

- Status: Accepted (2026-10-23). Exceptions EX-001, EX-002 and EX-005 are pending owner sign-off
  (see [Exceptions](#exceptions)).
- Date: 2026-10-23
- Deciders: @dcuccia (owner); drafted by the asset/IP policy session

## Context

handbell-hero is an MIT open-source project that wants the feel of the best music, instrument,
percussion and dance rhythm games. Those games are built on ideas anyone may use, but their art,
sounds, code, names and looks belong to their owners.

Several things prompted this ADR:

- YARG's README takes a firm stand against piracy and ripped assets. We share that stance and
  want to show it in how we work.
- The spikes run next to LGPL-3.0-or-later code. S2 and S3 build against YARG.Core and the YARG
  fork, and the fork is our community track ([ADR-0004](0004-host-strategy.md)).
- Gen-AI tools can now produce good art and audio. That raises questions about rights, honesty
  and resemblance to existing games.
- Until now, licenses lived in prose (S5's `manifest.json`, the report text). Nothing checked
  them, and the repo had no attribution file, contributor guide or disclaimer.

We want an OSS project that gives full credit, avoids "sketchy vibes", and never takes a
copyleft or non-commercial dependency by accident.

This ADR records project practice. It is not legal advice.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| Keep MIT for everything, track licenses in prose | No work | Unchecked; MIT doesn't fit art/audio or AI output; third-party notices get lost |
| **MIT code + CC BY 4.0 original assets + CC0 AI assets, enforced by REUSE, an asset register and a dependency gate** | Standard and machine-readable; CI catches drift; credits can be generated for the game | Some process for each asset and dependency |
| Copyleft (GPL/CC BY-SA) for everything | Matches YARG's spirit | Breaks the MIT promise (ADR-0001); limits classroom and partner reuse |
| No AI-generated assets | Simplest rights story | Gives up a big productivity lever; the problems are manageable with provenance and review |

## Decision

### 1. Licenses for our own work

| Material | License |
|---|---|
| Code, docs, configs, test data | MIT ([LICENSE](../../LICENSE)) |
| Original human-made art, audio, 3D models and charts | CC BY 4.0 |
| AI-generated assets (copyright may not attach) | CC0 1.0 |

Every file's license is machine-readable using [REUSE](https://reuse.software): `REUSE.toml`
plus full texts in `LICENSES/`. CI runs `reuse lint`.

### 2. Ideas are free; expression, names and looks are not

- **Free to use:** game ideas and mechanics. Examples: a note highway, timing windows,
  streaks and multipliers, phrase bonuses, DDR-style arrows, star-power-like team meters.
- **Not ours to take:** expression. That includes art, models, textures, shaders, sounds,
  music recordings, UI layouts, code, chart files and arrangements from other games.
- **Avoid trademarks and trade dress.** Don't use their product names, logos or naming patterns
  (for example "[instrument] Hero"). Don't copy a distinctive look. Guitar Hero's
  green/red/yellow/blue/orange fret order is one such look. Our own palette is in
  [visual identity](../design/visual-identity.md).
- **Mentioning other games is fine** in docs ("inspired by games like…") when we only name them,
  don't use their logos, and keep the non-affiliation disclaimer nearby.
- **Patents:** some older rhythm-game patents may still be in force. We don't draw legal
  conclusions here. If a mechanic closely follows a specific patented design, flag it for the
  owner before building it.

### 3. No YARG, Clone Hero or commercial-game material in this repository

- This MIT repository contains no YARG, YARG.Core or Clone Hero code, assets or shaders, and no
  commercial game assets of any kind.
- The YARG fork stays a separate LGPL-3.0-or-later repository.
- Code meant for the fork is written here first, under MIT and our copyright, and then
  contributed outbound. The fork's existing HGP code is LGPL there. Before any of it moves into
  this repo, it must be re-authored here or confirmed to be entirely our own work.
- S2 and S3 keep *fetching* YARG.Core and the fork into gitignored `external/` folders and never
  vendor them. The license gate checks this: no tracked files under those folders, no
  `namespace YARG` sources, no `YARG.Core/` paths.

### 4. Inspiration practice

- Describe the feeling, not the asset. For example, "a warm brass bell flash that blooms on a
  perfect hit," not "make it look like <game>."
- Never put franchise, studio or living-artist names into gen-AI prompts. Never use img2img,
  style transfer or reference conditioning on copyrighted screenshots or art. The register
  rejects prompts that contain obvious franchise names.
- Don't commit third-party screenshots. Private mood boards stay out of the repo.
- Resemblance review: before an asset merges, a human compares it with the games it might
  evoke. If it looks like a specific asset, redo it.

### 5. Gen-AI tools

- Allowed when the tool's terms grant us rights to the output and permit redistribution.
- For each asset, log the tool, model, version, terms URL and terms version/date, and the full
  prompt. Record the human resemblance reviewer and the review date.
- AI-generated assets are licensed CC0 1.0 (copyright may not attach).

### 6. Dependencies and third-party assets

- **Allowlist:** MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0, CC-BY-4.0,
  OFL-1.1, Zlib, Python-2.0, BlueOak-1.0.0. Public-domain dedications without an SPDX id (such as
  the Mutopia Project's) are allowed for assets when the register records the evidence.
- **Anything else** (LGPL/GPL/AGPL, MPL, CC BY-SA, any NC or ND, proprietary, or unknown) needs an
  explicit exception that names this or a later ADR. Exceptions live in
  [`tools/licensing/exceptions.json`](../../tools/licensing/exceptions.json).
- CI checks every `package-lock.json` and every direct NuGet `PackageReference`. It regenerates
  [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) and fails if anything is off the
  allowlist without an exception.

### 7. Asset register and attribution

- Every non-code asset has an entry in
  [`attribution/register.json`](../../attribution/register.json), validated by its JSON Schema.
  An entry records the path, title, author, source URL, SPDX license, modifications, reuse limits,
  pinned SHA-256 for third-party files, and AI provenance where relevant.
- `tools/licensing/attribution.mjs` generates [ATTRIBUTION.md](../../ATTRIBUTION.md) and
  `attribution/credits.json`, which the game can render. CI fails if:
  - an asset file isn't in the register;
  - a pinned third-party file changes;
  - `REUSE.toml` disagrees with the register; or
  - the generated files are stale.
- Attribution follows the
  [digital-handbell style](https://github.com/dcuccia/digital-handbell/blob/main/ATTRIBUTION.md):
  - pin sources;
  - keep original notices next to the files, unmodified;
  - record reuse limits; and
  - credit generously without implying endorsement.

### 8. Contributions

Contributors certify the [DCO](https://developercertificate.org) with `git commit -s`. The PR
template includes an asset/IP checklist. See [CONTRIBUTING.md](../../CONTRIBUTING.md).

## Exceptions

| Id | Component | License | Scope | Status |
|---|---|---|---|---|
| EX-001 | `mediabunny` (npm, optional transitive via `werift`) | MPL-2.0 | `spikes/s1-phone-bell` | **Pending owner.** Spike-only and unmodified. Revisit before shipping WebRTC |
| EX-002 | `tweetnacl` (npm, optional transitive via `werift`, `@fidm/x509`) | Unlicense | `spikes/s1-phone-bell` | **Pending owner.** Recommend adding Unlicense (a public-domain dedication) to the allowlist |
| EX-003 | YARC-Official/YARG.Core, fetched at a pinned commit (S2) or as a submodule (S3) | LGPL-3.0-or-later | S2, S3 | Accepted: fetched into gitignored `external/` and never vendored (§3) |
| EX-004 | dcuccia/YARG `handbell-spike`, fetched by S3 and `tools/setup` | LGPL-3.0-or-later | S3, setup | Accepted: separate repository (§3) |
| EX-005 | `spikes/s2-yarg-core/patches/0001-yarglogger-no-thread-on-browser.diff` | LGPL-3.0-or-later | S2 | **Pending owner.** The diff's context lines are YARG.Core code, so it's labeled LGPL in `REUSE.toml`. Keep it, or delete it (the fetch script applies the same change) |

Until the owner decides, CI allows the pending exceptions and prints a warning for each one.

## Consequences

- **Every PR that adds an asset must also add a register entry.** CI enforces this. Adding a
  dependency may need an exception.
- Product builds must also ship full license texts and notices for bundled dependencies. The
  notices file lists them today, but no product bundle exists yet.
- The 2026-10-23 audit found:
  - The S4/I1/I2 lane colors are close to Guitar Hero trade dress. Issue
    [#12](https://github.com/dcuccia/handbell-hero/issues/12) moves them to the pitch-class
    palette.
  - The "Handbell Hero" name follows the "[instrument] Hero" pattern. Issue
    [#13](https://github.com/dcuccia/handbell-hero/issues/13) tracks choosing a product name
    before any public release. "handbell-hero" can stay as the repository codename.
  - Full findings are in the [IP audit](../research/ip-audit-2026-10-23.md).
- S5's agent-encoded lead sheets predate this ADR. They're registered as legacy AI assets with
  recorded provenance gaps, and each still needs a proofread against a public-domain edition.

## Evidence

- [IP audit 2026-10-23](../research/ip-audit-2026-10-23.md): per-file findings for S1–S5, I1,
  I2 and docs.
- Mutopia piece pages for ids 1231, 905 and 644 (checked 2026-10-23) all say
  "Copyright: Public Domain". Our six files are byte-identical to the Mutopia downloads
  (SHA-256 pinned in the register).
- YARG and YARG.Core READMEs: "LGPL-3.0 (or later)". YARG also ships BASS (non-commercial) and
  CC BY-NC crowd sounds ([S3 report](../spikes/S3-report.md)).
- `reuse lint` (reuse 6.2.0): compliant with REUSE 3.3. License gate: 225 npm package
  versions in 4 projects, no direct NuGet references, all allowed or excepted.
