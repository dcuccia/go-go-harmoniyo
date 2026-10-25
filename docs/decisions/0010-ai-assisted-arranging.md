# 0010 — AI-assisted arranging: validated candidates, never replacements

- Status: Proposed
- Date: 2026-10-24
- Deciders: @dcuccia (owner); proposed by the S6 spike session

## Context

[S6](../spikes/S6-report.md) tried two kinds of generative help with the S5 carol corpus on the
household AI compute node (cuccia-infra contract v0): a small general LLM (qwen3:8b,
Apache-2.0) writing chord symbols, descants and intros/endings as text, and a symbolic music
model (the Anticipatory Music Transformer, AMT, Apache-2.0) writing accompaniment MIDI. Both
produce material that is neither ours (ADR-0008 treats it as CC0 AI output) nor checked
by a musician. ADR-0008 also requires a human resemblance review *before an AI asset merges*,
but spike output is mostly evidence for the owner, and much of it never ships.

Key S6 findings:

- qwen3:8b chord inference from a melody was worse than S5's 150-line template matcher on every
  measure (chord-tone fit 0.53–0.66 vs 0.83–0.97; agreement with SATB-derived chords ≤ 0.41 vs
  0.44). Proofreading mostly returned its input unchanged.
- qwen3:8b descants were not usable: 7 of 24 outputs passed bar/range/variety checks after up
  to 2 repair turns; the "valid" ones loop the prompt's format example or copy the tune a 3rd
  higher. A 30-line rule-based descant scored higher on every metric.
- Intros/endings were valid only in 4/4 (4 of 5 for Deck the Halls, 0 of 5 for 3/4 Holly); the
  valid ones quote the tune's first phrase.
- AMT ran on CPU only (no node token yet): chord fit 0.30–0.40 and 33–38 % clashes with the
  melody with the small model, across 14–15 GM instruments. Weak, but a GPU run with the
  medium model is still to do.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| Use LLM output directly in charts | Fast | Fails basic checks most of the time; unreviewed AI material in the product |
| **Generate → validate deterministically → keep as candidates; promote only after owner listening + resemblance review** | Evidence without risk; the validators are reusable for human-authored arrangements too | Most AI output is discarded; review work for anything promoted |
| No generative arranging | Simplest rights story | Gives up AMT before a fair GPU test, and future, better models |

## Decision

1. **Arranging stays algorithmic for the alpha.** S5's realizer and inference plus I2's
   procedural backing remain the source of harmony and accompaniment. qwen3:8b is not used for
   arranging.
2. **Generated music enters only as a candidate.** Every output passes the S5 ABC parser and the
   S6 checks (bar lengths, key, range, chord-tone fit, verticals/parallels, handbell
   playability) before it is kept, and it never replaces an original chart.
3. **Candidate assets (amends ADR-0008 §5 for spikes):** the asset register gets a
   `candidate: true` flag. A candidate must have complete AI provenance (tool, model, version,
   terms, full prompt or prompt log) and `"credit": false`; its human resemblance review may be
   pending. Promoting a candidate (using it in any build, or removing the flag) requires the
   review first. `tools/licensing/attribution.mjs` enforces this.
4. **AMT stays on the table** until the owner has published the container and run the medium
   model on the node's GPU and listened to the blind set. Re-decide with that evidence.
5. **Node access** uses the contract's HTTPS base URL with the private CA pinned by SHA-256, and
   the token only from the environment; never disable TLS verification.

## Consequences

- S6's two candidates (Deck the Halls intro/ending, Holly and the Ivy descant), their charts,
  the AMT outputs and the blind-listening clips are registered as candidates with review pending.
- Owner actions: listen to the blind set, do (or waive) the resemblance review for anything to
  promote, set the node token + CA, publish the AMT image and send its manifest to infra.
- If this ADR is rejected, the candidate flag must go: then either review the S6 assets before
  merge or remove them from the PR.

## Evidence

- [S6 report](../spikes/S6-report.md), `spikes/s6-ai-arranging/results/` (metrics, JSONL prompt
  and reply logs), `spikes/s6-ai-arranging/previews/` (blind set).
