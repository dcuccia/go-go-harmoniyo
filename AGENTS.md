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
- **Licenses.** Check and record the license of anything you vendor, fork, or copy. No
  commercial game assets, ripped audio, or copyrighted songs/arrangements. Public-domain
  melodies are fine only when the specific *arrangement/file* is also free to use — record
  the source and license per file.
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
