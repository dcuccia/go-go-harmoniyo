# 0015 — Reviewed, fixed backing arrangements for public S9

- Status: Accepted by @dcuccia on 2026-11-25; takes effect when this ADR merges.
- Date: 2026-11-25
- Deciders: @dcuccia (owner); proposed by the coordinator
- Amends: [ADR-0011](0011-ai-assisted-arranging.md), decision point 1, only for the release described below. The candidate and review gates still apply.

## Context

Public S9 uses procedural accompaniment. In a private blind comparison, the owner
preferred the revised note-level arrangements and the recorded harp for both *Shchedryk*
and *The Holly and the Ivy*. After testing the 24-song Node preview, the owner preferred
the candidate backing, requested a public S9 release, and separately confirmed that he
completed the resemblance review for all 24 candidates and found no concerns.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| Keep the revised backing local-only | No public asset or runtime change | Public players cannot use the reviewed backing |
| **Release this fixed set as S9 backing, with the procedural fallback** | Preserves the reviewed music and timing without a live model | Adds download, decode, and asset maintenance costs |
| Allow general or live AI arranging | Supports more variation | Outside this approval; unlike fixed scores, runtime output cannot be reviewed before play |

## Decision

1. Public S9 may use the fixed 24-song Short/Full accompaniment set reviewed in the Node
   preview. Its source `manifest.json` has SHA-256
   `78be33e61d3613ea8532acb6670570e37c75be08beab540faa89924fddcf1c4d`.
   Use only the verified CC0 VSCO-2 Community Edition harp samples needed to play that
   set. Register the exact shipped assets, source and license evidence, AI provenance
   and owner review under [ADR-0008](0008-assets-ip-and-attribution.md).
2. This is backing for the S9 host, not a replacement chart. Keep player and guide
   bells, timing, and judging unchanged. Apply the existing protection for occupied bell
   parts; an intentionally empty accompaniment stays bells-only. First Ring keeps its
   procedural backing. Node and native app defaults are not changed by this decision.
3. Keep the procedural backing as a fallback when the reviewed score or samples cannot
   be loaded or played. Do not require an AI service during play. This approval does
   not cover other S6 candidates, new arrangements, or future revisions to this set.

## Consequences

- The implementation and rollout are separate from this decision. Verify the shipped
  set against the reviewed source, validate the assets, and check playback and fallback
  before deploying to public S9.
- The local preview remains available for comparison. No candidate assets or code are
  included in this ADR.

## Evidence

- [S6 report](../spikes/S6-report.md) for earlier experiments and the candidate workflow.
- 2026-11-25 private listening comparison and 24-song Node audition. The owner
  confirmed the human resemblance review and approved the narrow S9 exception
  separately from the listening preference.
