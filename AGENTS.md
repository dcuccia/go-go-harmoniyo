# Working in handbell-hero

This repo is the **durable plan and memory** for a multi-session, multi-agent project. No
single session is expected to finish it. Leave the repo so the next session can continue
without your conversation history.

## Before you start

1. Read [README.md](README.md), [docs/roadmap.md](docs/roadmap.md), and the epic or spike
   brief you were assigned.
2. Read accepted ADRs in [docs/decisions/](docs/decisions/README.md). Do not contradict an
   accepted ADR; propose a superseding ADR instead.

## Rules

- **Stay in scope.** A spike answers its stated questions within its time box. If you hit
  the time box or a kill criterion, stop and write the report — a clear "no" is a success.
- **Owner decides the stack.** Spikes produce evidence and recommendations; technology
  choices are recorded as ADRs with status `Proposed` until the owner (@dcuccia) accepts.
- **Evidence over opinion.** Record measurements (latency, frame times, detection rates),
  devices/browsers/versions used, and how to reproduce.
- **Licenses and assets ([ADR-0008](docs/decisions/0008-assets-ip-and-attribution.md)).** Code
  is MIT; original art/audio/models/charts CC BY 4.0; AI-generated assets CC0. No YARG, Clone
  Hero or commercial game code/assets/shaders in this repo (fetch YARG, never vendor it); no
  ripped audio or copyrighted songs/arrangements. Public-domain melodies are fine only when the
  specific *arrangement/file* is also free to use. Every asset goes in
  [`attribution/register.json`](attribution/register.json) in the same PR (source, license,
  author, pinned hash, AI provenance) and you regenerate `ATTRIBUTION.md`; dependencies must be
  allowlisted or have an ADR exception. Run `node tools/licensing/attribution.mjs`,
  `node tools/licensing/license-gate.mjs` and `reuse lint` before opening the PR.
- **Inspired, never copied.** Use game ideas freely; never copy other games' expression, names
  or distinctive looks (e.g. fret-colour order — use the
  [pitch-class palette](docs/design/visual-identity.md)). Gen-AI prompts describe the feeling, not
  the asset: no franchise/artist names, no img2img from copyrighted art; log tool, model,
  version, terms and prompt; a human resemblance review is required before merge. See
  [CONTRIBUTING.md](CONTRIBUTING.md).
- **Sign off commits** (`git commit -s`, DCO).
- **Cross-platform.** Note platform limits (iOS Safari, Android Chrome, Windows/macOS/
  Linux/ChromeOS hosts) for anything you build or evaluate.
- **Spike code** goes in `spikes/<spike-id>-<slug>/` and is allowed to be throwaway. Product
  code locations will be set by ADR after the decision gate.
- **Reports** go in `docs/spikes/<spike-id>-report.md` using the brief's "Report must
  answer" list as headings. Update the spike's status in
  [docs/spikes/README.md](docs/spikes/README.md) and anything you learned in the
  relevant epic's "Open questions".
- **Upstream etiquette.** Don't open issues/PRs on third-party repos without owner approval;
  draft them in the report instead.
- Deliver work as a pull request to `main` unless told otherwise.
