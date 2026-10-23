# Handbell Hero

A rhythm game for **handbell ringers**, inspired by games like Guitar Hero and Rock Band. Play
solo, as a family, or as a whole classroom ringing together in front of one shared screen.

> "Handbell Hero" is a working codename; a product name is still to be chosen
> ([#13](https://github.com/dcuccia/handbell-hero/issues/13)). This independent open-source project
> is not affiliated with, endorsed by, or sponsored by the makers of any game it mentions. All
> trademarks belong to their owners.

Notes scroll down per-ringer lanes; players *ring* real (or virtual) bells in time; the game
judges timing, keeps team streaks, and makes learning ensemble music feel like a concert.

> **Status (2026-10-23): spikes done; host decided.** Spikes S1–S5 and integrations I1/I2
> are merged, with posterity tags `spike/*` and `integration/*`.
> - **Host:** a web-first host on an engine we own, with a TypeScript core
>   ([ADR-0004](docs/decisions/0004-host-strategy.md),
>   [ADR-0005](docs/decisions/0005-shared-core-language.md)). The YARG fork continues as a
>   community/experimental track.
> - **Prototype:** phones (simulated so far) drive 1–4 ringers on one TV
>   ([I2](docs/spikes/I2-web-phones.md)).
> - **Top alpha bug:** real-phone rings don't register yet
>   ([#10](https://github.com/dcuccia/handbell-hero/issues/10)).
>
> Alpha: **Nov 15, 2026**. First real target: **holiday 2026** — 3–5 people playing
> Christmas carols in a living room, using their **phones as handbells** and a PC driving the
> TV. Set up a machine with [tools/setup](tools/setup/README.md).

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
   no copyrighted game assets or music. (Per ADR-0004, we own the product engine. We give
   back to YARG through the fork's community track, with owner approval for anything
   upstream.)
7. **Inspired, never copied.** Game ideas are free to use; other games' art, sounds, code, names
   and distinctive looks are not. Every asset is original or openly licensed, with its
   provenance recorded and credited
   ([ADR-0008](docs/decisions/0008-assets-ip-and-attribution.md)).

## Map of this repository

| Path | Purpose |
|---|---|
| [docs/roadmap.md](docs/roadmap.md) | Milestones, dates, and the current decision gate |
| [docs/epics/](docs/epics/README.md) | Long-lived workstreams (input, engine, songs, audio, …) |
| [docs/spikes/](docs/spikes/README.md) | Time-boxed experiments with explicit questions and kill criteria |
| [docs/decisions/](docs/decisions/README.md) | Architecture decision records (ADRs) |
| [docs/research/landscape.md](docs/research/landscape.md) | Prior art: open-source rhythm games, handbell software, DIY bells |
| [docs/research/naming-go-go-harmonio.md](docs/research/naming-go-go-harmonio.md) | Product-name check (trademarks, stores, domains, handles) for Go Go Harmonio / Go Go HarmoniYo |
| [docs/protocol/](docs/protocol/README.md) | Handbell Gesture Protocol (HGP) — the hardware-agnostic input contract |
| `spikes/` | Spike code (one folder per spike); `s1-phone-bell`, `s4-web-host`, `s5-chart-pipeline`, `i2-web-phones` carry forward until a product-layout ADR |
| [tools/setup/](tools/setup/README.md) | Idempotent machine setup: web stack (`setup-web.ps1`), YARG fork (`setup-yarg.ps1`) |
| [docs/design/](docs/design/visual-identity.md) | Visual identity, the pitch-class colour palette, and the draft [brand guide](docs/design/brand.md) |
| [attribution/](attribution/register.json), [ATTRIBUTION.md](ATTRIBUTION.md) | Asset register (provenance + license per asset) and the generated credits |
| [tools/licensing/](tools/licensing/README.md) | License gate, asset-register checks, attribution generator (CI: `licensing`) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Licenses, asset checklist, gen-AI rules, DCO sign-off |
| [AGENTS.md](AGENTS.md) | How agents (and humans) work in this repo |

## License

Code and docs are [MIT](LICENSE), matching digital-handbell. Original art, audio, models and
charts are [CC BY 4.0](LICENSES/CC-BY-4.0.txt); AI-generated assets are
[CC0 1.0](LICENSES/CC0-1.0.txt); third-party files keep their own licenses. Every file is mapped
with [REUSE](https://reuse.software) (`REUSE.toml`, `LICENSES/`); credits are in
[ATTRIBUTION.md](ATTRIBUTION.md) and dependencies in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Forks of third-party projects keep their own
licenses (e.g. YARG is LGPL-3.0-or-later) and live in separate repositories. See
[ADR-0008](docs/decisions/0008-assets-ip-and-attribution.md).
