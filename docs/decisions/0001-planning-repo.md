# 0001 — Dedicated planning/product repo, MIT

- Status: Accepted
- Date: 2026-10-22
- Deciders: @dcuccia

## Context

The project spans game software, input protocols, songs/charts, and hardware, and will be
carried out by many agent sessions over months. Plans must outlive any one session.

## Decision

Create public repo `dcuccia/handbell-hero` (MIT, matching digital-handbell) to hold the
vision, roadmap, epics, spike briefs/reports, ADRs, the gesture-protocol spec, and (after
M2) product code. Forks of third-party projects (e.g. YARG) live in separate repositories
under their own licenses and are linked from here.

> Note (2026-10-23): the repository was renamed `dcuccia/go-go-harmoniyo`; old URLs redirect. See
> the [ADR-0009 amendment](0009-product-name.md#amendment-2026-10-23-repository-renamed).

## Consequences

- Agents start from [AGENTS.md](../../AGENTS.md) and the roadmap.
- License boundaries stay clear between MIT code and copyleft forks.
