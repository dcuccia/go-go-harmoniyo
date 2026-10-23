# 0005 — Shared core: TypeScript; HGP and chart JSON as language-neutral contracts

- Status: Accepted
- Date: 2026-10-23
- Deciders: @dcuccia (owner); proposed by the M2 consolidation session (agent), from the
  [M2 decision brief](m2-decision-brief.md)

## Context

The roadmap allows multiple hosts only if they share an engine-agnostic core: chart format,
scoring/judging, timing model, and input protocol. Two candidates came out of the spikes:

- **C# YARG.Core everywhere.** S2 shows it runs unmodified on desktop and, after a 5-line
  logger patch, in browser-WASM with bit-identical scores (~107 KB brotli, ~1.7 MB with the
  .NET runtime).
- **TypeScript.** S1 (phone controller and host), S4 (web judge and renderer), S5 (chart
  pipeline, Node, zero dependencies) and I2 (team judge) are already TypeScript/JavaScript,
  and they already work together.

[ADR-0004](0004-host-strategy.md) makes the product host a web game on an engine we own. The
YARG fork is a community track with no product dependency.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| C# YARG.Core everywhere (WASM in the browser) | YARG/CH chart parsing and judging for free; same scores as YARG | TS↔C# bridge (`[JSExport]`); +1.7 MB download; LGPL-3.0 in the web bundle (S2 notes); per-player multiplier penalizes split parts (S2: 23,160 → 15,360); no team multiplier; we don't own the roadmap |
| **TypeScript core + language-neutral contracts** | One language for host, phone controller and tooling; MIT; fast CI; already integrated in I2; other languages (YARG fork C#, ESP32 C/C++ firmware) interoperate through the contracts | Our own judge must stay well-tested; YARG/CH chart import is our code (S5 exports to them today) |
| Two cores (TS web + C# YARG) with no contract tests | No upfront work | Scores and charts drift between hosts; ruled out by the roadmap |

## Decision

**The shared core is TypeScript.** Chart model, judging and scoring, timing and clock mapping,
and the HGP host/controller logic are written in TypeScript. They run in the browser and on
Node.

The boundaries between components, and to anything not written in TypeScript, are
**language-neutral contracts**:

1. **HGP** (Handbell Gesture Protocol): versioned JSON messages over a transport.
   [docs/protocol/hgp-v0.md](../protocol/hgp-v0.md) is the draft spec. The YARG fork's UDP
   `hgp0` bridge (I1) and future ESP32-S3 firmware are other-language implementations.
2. **Chart JSON**: the S5 schema
   ([`chart.schema.json`](../../spikes/s5-chart-pipeline/schema/chart.schema.json)). Format
   details stay in [ADR-0007](0007-chart-format.md) (Proposed).

Each contract ships **golden test vectors**: checked-in input files and expected outputs that
every implementation must pass in CI.

- HGP: message examples, plus clock-sync and ring sequences with the expected host-clock
  timestamps.
- Chart JSON: sample charts and schema validation.
- Judging: a chart plus a timestamped ring stream, with the expected verdicts and team score.

The TypeScript core is the reference implementation that generates and checks the vectors.
The YARG fork's C# HGP code and firmware check against the same files.

## Consequences

- YARG.Core is **not** a product dependency. S2's WASM path stays documented as an option for a
  future "YARG-compatible scoring" mode, behind an LGPL review.
- One codebase serves the TV host and the phone controller, as I2 already does. Agents work in
  plain TS/Node with fast tests.
- Golden vectors still have to be written. The seeds already exist: S1's `test/` (host, core,
  detectors, YARG sidecar), S5's `test/fixtures` and schema, and I2's e2e scenarios.
  - Collecting them into one contracts folder is the first task after the product-layout ADR.
  - CI should run them against the TS core and the S3 C# harness (`S3Harness selftest`).
- Team play is a core concept: one team judge across ringers. YARG's per-player multiplier
  model doesn't apply.
- HGP changes (e.g. `assign.ringer`, `cues`, added by I1 and I2) are made in the spec and the
  vectors first, then in implementations.

## Evidence

- [S2 report](../spikes/S2-report.md): YARG.Core on console + browser-WASM; bit-identical
  fingerprints; size; LGPL notes; split-part multiplier penalty.
  Re-run on 2026-10-23 during consolidation: console fingerprint `C47FDEC481506BDA`.
- [S4 report](../spikes/S4-report.md): TS judge; event-timestamp judging with key → judgement
  p50 1.4 ms; `getOutputTimestamp()` mapping jitter < 0.12 ms.
- [S1 report](../spikes/S1-report.md) and [hgp-v0.md](../protocol/hgp-v0.md): TS controller
  and host; NTP-style clock sync with LAN sync error ≈ 1 ms p95 (emulated).
- [S5 report](../spikes/S5-report.md): zero-dependency JS pipeline, JSON schema, YARG/CH MIDI
  export.
- [I1 report](../spikes/I1-yarg-phones.md): the C# YARG fork consumes the TS host's rings over a
  language-neutral wire format (`hgp0` UDP); 182/182 rings registered.
- [I2 report](../spikes/I2-web-phones.md): S1 + S4 + S5 combine with additive changes only;
  4/4 e2e scenarios pass.
- [Connectivity and deployment research](../research/connectivity-and-deployment.md), §2: the
  web version of the YARG experience is our web host, optionally scoring with YARG.Core.
