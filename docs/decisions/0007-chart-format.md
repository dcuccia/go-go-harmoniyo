# 0007 — Chart format

- Status: Proposed
- Date: 2026-10-23
- Deciders: @dcuccia (owner); proposed by the S5 spike session (agent)

## Context

Every host engine candidate (YARG fork, web-native, Avalonia, …) must play the same songs, and
the shared-core language is still open (ADR-0005). Charts are generated automatically from
public-domain MIDI/MusicXML/ABC carols (ADR-0003) and must carry per-file license/provenance.
A handbell chart differs from a guitar chart: notes are **pitched bells**, the bell→ringer
mapping depends on how many people play and on their controllers, and the same song needs
several difficulty tiers.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| Engine-neutral JSON (`go-go-harmoniyo.chart`, S5 schema; was `handbell-hero.chart` until 2026-10-23) | Language-neutral, readable, JSON-Schema validated; bells first-class; parts per difficulty × ringer count × controller profile; ticks + seconds; license inside | New format; needs exporters for other games |
| Rock Band/Clone Hero-style `.mid` (one 5-lane track per ringer) | Existing tooling (Moonscraper, YARG, CH); YARG can play it today | Lanes lose pitch; ≤ 5 ringers × ≤ 5 bells; one assignment per file; no license/role metadata; binary |
| RB3 Pro Keys `.mid` | Keeps real pitches | One player, 25-key window, ≤ 4 simultaneous notes |
| MusicXML as the chart | Standard notation interchange | No ringer assignment/difficulty/profile concepts; verbose; heavy to parse at runtime |

## Decision (proposed)

Adopt the S5 engine-neutral JSON format v0.1 (`spikes/s5-chart-pipeline/schema/chart.schema.json`)
as the source of truth for charts. Source music stays in MIDI/MusicXML/ABC with a per-file
license register; the pipeline generates charts. RB/CH-style `.mid` is an **export target**
(for play-testing in YARG/Clone Hero and for a possible YARG-based host), not the master.

## Consequences

- Hosts in any language read one JSON file per song and pick the part matching player count and
  controller profile; no tempo-map math needed (times pre-computed in seconds).
- The bell list per ringer maps directly to HGP host→device bell assignment (S1).
- The schema moves out of `spikes/` to a product location set after M2; v0.x may change freely.
- A YARG-based host would need a reader for this JSON or a generated `PART HANDBELL`-style track.
- The format id is `go-go-harmoniyo.chart` since the 2026-10-23 rename
  ([ADR-0009 amendment](0009-product-name.md#amendment-2026-10-23-repository-renamed)). Readers
  also accept the earlier id `handbell-hero.chart`.
- v0.2.0 (2026-10-23) adds an optional `harmony` block (chord symbols, beat grid, backing
  style) for game-side backing tracks; additive, so v0.1 readers and charts keep working.

## Evidence

- [S5 report](../spikes/S5-report.md), generated charts and metrics in
  [`spikes/s5-chart-pipeline/`](../../spikes/s5-chart-pipeline/README.md).
- Community `.mid` conventions: [GuitarGame_ChartFormats](https://github.com/TheNathannator/GuitarGame_ChartFormats) (CC0-1.0).
