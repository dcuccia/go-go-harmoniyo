# Licensing tools

Zero-dependency Node.js (≥ 20) scripts that enforce
[ADR-0008](../../docs/decisions/0008-assets-ip-and-attribution.md). CI runs them in
[`.github/workflows/licensing.yml`](../../.github/workflows/licensing.yml).

| Command | What it does |
|---|---|
| `node tools/licensing/attribution.mjs` | Validates [`attribution/register.json`](../../attribution/register.json) against its [schema](../../attribution/register.schema.json) and the policy. Checks coverage, pinned hashes, REUSE agreement and AI provenance. Regenerates [`ATTRIBUTION.md`](../../ATTRIBUTION.md) and [`attribution/credits.json`](../../attribution/credits.json) |
| `node tools/licensing/license-gate.mjs` | Checks every npm lockfile and NuGet `PackageReference` against the allowlist and exceptions, and checks that fetched YARG sources stay unvendored. Regenerates [`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md). Add `--offline` to skip NuGet lookups |
| add `--check` to either | CI mode: change nothing, and fail if generated files are stale |
| `node --test tools/licensing/test/licensing.test.mjs` | Unit tests for the SPDX, glob and schema helpers, plus an end-to-end sync check |
| `reuse lint` | REUSE compliance (`pip install reuse` or `pipx run reuse lint`) |

Files:

- [`policy.json`](policy.json): the license allowlist, accepted public-domain marks, the license
  for each asset origin, and the AI prompt blocklist.
- [`exceptions.json`](exceptions.json): ADR-referenced exceptions. `pending-owner` entries pass CI
  with a warning.
- `lib/`: helpers (git file listing, globs with REUSE semantics, SPDX expressions, a small JSON
  Schema validator).

What the asset check enforces:

- Every file with an asset extension (images, audio, MIDI/scores, fonts, models, shaders, video)
  or matching `coverage.include` (chart JSON, `song.ini`) is claimed by exactly one register
  entry.
- Pinned third-party files still match their upstream SHA-256. Text is compared with LF line
  endings.
- `REUSE.toml` gives each asset file the same license as the register.
- Licenses for our own work by origin: `original` → CC-BY-4.0, `ai-generated` → CC0-1.0.
- New AI assets have complete provenance and a dated human resemblance review. Legacy entries
  are listed as warnings.
- AI prompts contain none of the blocklisted franchise names.
