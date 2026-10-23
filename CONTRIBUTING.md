# Contributing to Go Go HarmoniYo

Thanks for helping! Issues, ideas, songs, art, sounds and code are all welcome. Please read
[AGENTS.md](AGENTS.md) for how work is organized (spikes, ADRs, reports). This guide covers
licensing, assets and sign-off. The policy behind it is
[ADR-0008](docs/decisions/0008-assets-ip-and-attribution.md).

## Licenses at a glance

| What you contribute | License |
|---|---|
| Code, docs, configs, tests | MIT |
| Original art, audio, 3D models, charts you made yourself | CC BY 4.0 |
| Assets made with a gen-AI tool | CC0 1.0 |
| Someone else's work | Only if its license is on the allowlist (or has an ADR exception), with its notices intact |

Licenses are machine-readable with [REUSE](https://reuse.software). New files get the MIT
default from `REUSE.toml`. Add an annotation there, or an `SPDX-License-Identifier` header in the
file, when a file needs a different license.

## Sign your commits (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org). Sign off every
commit to certify you have the right to submit it under the project's licenses:

```sh
git commit -s -m "Add bell sample"
```

This adds a line like `Signed-off-by: Your Name <you@example.com>`. Agents sign off on behalf of the
person who directed the work.

## Inspiration without copying

We want the feel of the best rhythm games, built entirely from our own work.

- **Use ideas freely:** note highways, timing windows, streaks, multipliers, phrase bonuses,
  arrows, team meters.
- **Don't copy expression:** another game's art, models, shaders, sounds, music, UI layouts,
  code, charts or arrangements.
- **Avoid names and looks:** no franchise names or logos in our UI, no "[instrument] Hero"-style
  naming, and no copying a distinctive look such as a fixed five-lane fret-colour order. Use our
  [pitch-class palette](docs/design/visual-identity.md).
- **Mentioning games in docs is fine** ("inspired by games like …"), with no logos.
- **Don't commit third-party screenshots.** Keep private mood boards out of the repo.
- **No YARG, Clone Hero or commercial-game code, assets or shaders** in this repository. Code for
  the YARG fork is written here first (MIT) and contributed to the fork from here.

## Gen-AI rules

1. Use a tool whose terms grant you rights to the output and allow redistribution. Note the terms
   URL and the version or date of the terms.
2. **Describe the feeling, not the asset.** Prompts talk about mood, materials, light and motion.
   **Never** name a franchise, studio or artist, and never ask for something "in the style of" one.
   The register check rejects obvious franchise names.
3. **No img2img, style transfer or reference images** from copyrighted screenshots or art.
4. Record the tool, model, version, terms URL and date, and the **full prompt** in the asset register.
5. A **human resemblance review** is required before merge: compare the result with the games it
   might evoke, and redo it if it looks like a specific existing asset. Record the reviewer and
   date.
6. AI-generated assets are licensed **CC0 1.0**.

AI-assisted *code* follows the normal code rules (MIT, DCO). Don't paste code from projects with
incompatible licenses into prompts, and don't accept output that reproduces such code.

## Adding assets

Every non-code asset (image, audio, MIDI/score, chart, font, model, shader, video) needs an entry
in [`attribution/register.json`](attribution/register.json) **in the same PR**. CI fails if
any asset file is missing from the register.

Checklist:

- [ ] Add the file in the right place. Third-party files stay **unmodified**, with their original
      notices and README/license next to them.
- [ ] Add a register entry with:
  - `paths`, `title`, `kind`, `origin` (`original` / `ai-generated` / `third-party` / `derived`),
    `authors`, `copyright`, SPDX `license`, and `modifications`.
  - Third-party: `source.url`, `retrieved`, `licenseEvidence`, pinned `files[]` with `sha256` of
    the upstream file, exact `attribution` text, and `reuseLimits`.
  - AI-generated: the full `ai` block (tool, model, version, termsUrl, termsDate, prompt,
    reviewer, reviewDate).
- [ ] If the license isn't MIT, add a `REUSE.toml` annotation (or an SPDX header). Add the license
      text with `reuse download <SPDX-ID>` if `LICENSES/` lacks it.
- [ ] Run the tools and commit the generated files:

  ```sh
  node tools/licensing/attribution.mjs     # validates the register, regenerates ATTRIBUTION.md + attribution/credits.json
  node tools/licensing/license-gate.mjs    # checks dependency licenses, regenerates THIRD_PARTY_NOTICES.md
  pipx run reuse lint                      # or: pip install reuse && reuse lint
  ```

**Songs:** public-domain melodies are fine only if the specific *file or arrangement* is free to
use too. Record the source and license per file. No copyrighted songs, arrangements or ripped
audio.

## Adding dependencies

Allowed licenses: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0, CC-BY-4.0,
OFL-1.1, Zlib, Python-2.0, BlueOak-1.0.0, Unlicense, MPL-2.0. MPL-2.0 is file-level copyleft: use
MPL files unmodified, or publish your modified MPL files under MPL-2.0. Anything else, including
LGPL/GPL/AGPL, CC BY-SA, NC/ND or unknown, needs an entry in
[`tools/licensing/exceptions.json`](tools/licensing/exceptions.json) that points at an ADR. The
owner decides. Commit the lockfile; CI runs the license gate on every `package-lock.json` and
NuGet `PackageReference`.

Copyleft components (MPL, LGPL and so on) are fine in spikes, but each non-dev one must be tracked
with a `gate` status in `exceptions.json`. Shipping one needs a compliance ADR first (see the
[copyleft adoption gate](docs/decisions/0008-assets-ip-and-attribution.md#copyleft-adoption-gate)).

## Pull requests

Open PRs against `main`. The [PR template](.github/pull_request_template.md) includes the
asset/IP checklist. Upstream issues or PRs to third-party projects need owner approval first;
draft them in your report instead.
