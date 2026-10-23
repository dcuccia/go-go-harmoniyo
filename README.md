# Handbell Hero

A Guitar Hero–style rhythm game for **handbell ringers** — solo, family, or a whole
classroom ringing together in front of one shared screen.

Notes scroll down per-ringer lanes; players *ring* real (or virtual) bells in time; the game
judges timing, keeps team streaks, and makes learning ensemble music feel like a concert.

> **Status: planning + spikes (October 2026).** No playable build yet.
> First target: **holiday 2026** — 3–5 people playing Christmas carols in a living room,
> using their **phones as handbells** and a PC driving the TV.

## Guiding principles

1. **Engaging first.** The bar is the feel of commercial rhythm games (Guitar Hero,
   GuitarFreaks, Rock Band): responsive, juicy visuals and sound, not a worksheet.
2. **Educational through-line.** Every feature should also work for a low-budget classroom
   with a projector and a handbell/handchime choir.
3. **Cross-platform is high value.** Hosts on Windows/macOS/Linux/ChromeOS (and ideally a
   browser); controllers on iOS and Android with no app install. Different rendering
   engines are acceptable *if* they share an engine-agnostic core (chart format, scoring,
   timing, input protocol). Web and Avalonia-style portability are preferred patterns.
4. **Decoupled from hardware.** The game talks to a standardized gesture-input protocol.
   Phones, the [digital-handbell](https://github.com/dcuccia/digital-handbell) ESP32-S3
   variant, MIDI, keyboards, and a microphone "listener" are all just input adapters.
5. **Precise timing.** Inputs are timestamped at the source on a synchronized clock and
   judged against the audio clock — never by packet arrival time.
6. **Build on the community where it makes sense.** Prefer forks of and upstream
   contributions to existing open-source rhythm games over reinvention; respect licenses;
   no copyrighted game assets or music.

## Map of this repository

| Path | Purpose |
|---|---|
| [docs/roadmap.md](docs/roadmap.md) | Milestones, dates, and the current decision gate |
| [docs/epics/](docs/epics/README.md) | Long-lived workstreams (input, engine, songs, audio, …) |
| [docs/spikes/](docs/spikes/README.md) | Time-boxed experiments with explicit questions and kill criteria |
| [docs/decisions/](docs/decisions/README.md) | Architecture decision records (ADRs) |
| [docs/research/landscape.md](docs/research/landscape.md) | Prior art: open-source rhythm games, handbell software, DIY bells |
| [docs/protocol/](docs/protocol/README.md) | Handbell Gesture Protocol (HGP) — the hardware-agnostic input contract |
| `spikes/` | Throwaway spike code (one folder per spike) |
| [AGENTS.md](AGENTS.md) | How agents (and humans) work in this repo |

## License

[MIT](LICENSE), matching digital-handbell. Forks of third-party projects keep their own
licenses (e.g. YARG is LGPL-3.0) and live in separate repositories.
