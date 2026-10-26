# S6 — AI-assisted arranging (spike code)

Throwaway spike code for S6 ([brief](../../docs/spikes/README.md#s6--ai-assisted-arranging),
[report](../../docs/spikes/S6-report.md)). It tries two kinds of AI help on the S5 carol corpus,
using the household AI compute node (cuccia-infra contract v0):

- **qwen3:8b** (Apache-2.0) over the node's OpenAI-compatible `/v1`: chord-symbol inference and
  proofreading, descants, and intros/endings, all as text (JSON or ABC) checked by the S5 ABC
  parser and music-theory validators, with up to two repair turns.
- **Anticipatory Music Transformer (AMT)** (Apache-2.0) as a batch container: melody MIDI in,
  accompaniment MIDI out.

Outputs never replace the S5 originals: they are candidates (`candidates/`, `charts/`) with
CC0 AI provenance and a pending human review ([ADR-0008](../../docs/decisions/0008-assets-ip-and-attribution.md)).

## Requirements

- Node ≥ 22.18 (runs the `.ts` files directly through type stripping; no npm install).
- For the live node: on the home LAN, `CUCCIA_AI_BASE_URL` (default `https://north.local`; the
  older `http://dcuccia-north.local:8790` still works), `CUCCIA_AI_TOKEN` and `CUCCIA_AI_CA_CERT`
  (path to the node's `ca.crt`; its SHA-256 is checked against the published value) in the
  process or Windows **User** environment. The token is never printed or logged; TLS
  verification is never disabled. The client wakes a sleeping node (Wake-on-LAN details cached
  from `/node/status` in `~/.cache/cuccia-ai/wake.json`, shared with cuccia-infra's Python helper).
- Previews: `npm ci` in `spikes/i2-web-phones` (Vite + playwright-core) and Chrome or Edge.
- AMT: Docker (container) or Python 3.11 with `torch`, `transformers`, `mido` and
  [`anticipation`](https://github.com/jthickstun/anticipation) at `af37397` (local run).

## Commands

| Command | What |
|---|---|
| `npm test` | Client (retries, auth, jobs) against the mock node; ABC writer round trips for all 8 S5 songs; theory checks. Offline: preloads `test/offline-guard.ts` (drops `CUCCIA_AI_*`, refuses non-loopback connections); CI runs it on S5/S6 changes (`.github/workflows/s6-ai-arranging.yml`) |
| `node scripts/smoke.ts [--mock]` | Health, status, models, 2 chats, a `smoke-file` job → `results/smoke.json` |
| `node scripts/exp-chords.ts [--mock]` | Experiment 2a: chords for the 3 Mutopia carols → `results/chords-<tag>.{md,json}`, `results/runs/chords-<tag>.jsonl` |
| `node scripts/exp-descant.ts [--mock]` | Experiment 2b: descant (prompts v1 + v2) and intro/ending for Deck the Halls and The Holly and the Ivy → `results/descant-<tag>.*` |
| `node scripts/build-candidates.ts [--from-results] [--tag local]` | Assemble the selected outputs into `candidates/*.abc`, then build `charts/*.json` (S5 format 0.2.0) |
| `node scripts/amt-run.ts --local --python <py> --model-dir <snapshot>` | AMT accompaniment per song → `results/amt/<song>/` (`--node` once infra registers the workload; `--mock` offline) |
| `node scripts/amt-analyze.ts` | AMT output metrics (notes, instruments, chord fit, clashes) → `results/amt/analysis.md` |
| `node scripts/render-previews.ts [--ogg-python <py>]` | Blind-listening clips → `previews/` + `results/previews.md` |
| `python scripts/local_llm_shim.py --model Qwen3-8B-Q4_K_M.gguf` | Local stand-in for the node's `/v1` (llama.cpp); see below |

`<tag>` is `node` (the AI node), `local` (a `/v1` on 127.0.0.1) or `mock`. Mock outputs go to the
gitignored `results/mock/`.

### Local stand-in (used for the 2026-10-24 results)

The node token was not available during the session, so the qwen3:8b experiments ran against
`scripts/local_llm_shim.py`: llama.cpp (`llama-cpp-python` 0.3.36, CUDA 12.4 wheel) serving the
official `Qwen/Qwen3-8B-GGUF` `Qwen3-8B-Q4_K_M.gguf` (sha256 `d98cdcbd…5745785`, the same
quantization Ollama ships as `qwen3:8b`) on the laptop's RTX 2000 Ada (8 GB), thinking turned off
the way `reasoning_effort: none` does on the node. Model and prompts are identical; latency is
not representative of the node (RTX 3080 Ti). To re-run on the node:

```powershell
Remove-Item Env:CUCCIA_AI_BASE_URL, Env:CUCCIA_AI_TOKEN -ErrorAction SilentlyContinue  # use the User env
node scripts/smoke.ts
node scripts/exp-chords.ts; node scripts/exp-descant.ts; node scripts/build-candidates.ts --from-results
```

## Layout

| Path | What |
|---|---|
| `src/env.ts`, `src/client.ts` | Config (process or Windows User env), node client: `/healthz`, `/v1` chat with 503 Retry-After / backoff, `/jobs` submit/poll/outputs/logs/cancel |
| `src/mock-node.ts` | Offline mock of the contract (tests, `--mock`) |
| `src/abc-io.ts` | Score → ABC writer (bar lines, ties, accidentals, chord symbols, voices), ABC fragment parsing, reply extraction |
| `src/songs.ts`, `src/theory.ts` | S5 corpus access, bar/beat chord lists, melody listings; key/range/bar checks, chord-tone fit, verticals, parallels, chord agreement, handbell playability (S5 `buildPart`) |
| `src/llm.ts`, `src/prompts/*.md` | Prompt templates, ask-validate-repair loop, JSONL run logs (the AI provenance record) |
| `src/assemble.ts`, `src/rule-descant.ts` | Intro + tune + ending + descant → candidate score/ABC; rule-based descant baseline |
| `amt/` | AMT CLI (`amt_accompany.py`), `Dockerfile` (weights baked in, pinned by SHA-256), workload `manifest.json` (published digest; see `amt/README.md`), owner-only `publish.ps1` (superseded by the `s6-amt-image` workflow) |
| `preview/` | Browser page that renders the blind-listening clips with the S4 bell synth and I2 backing synth |
| `results/` | Measurements and logs; `results/amt/<song>/` AMT inputs/outputs |
| `candidates/`, `charts/`, `previews/` | AI candidate lead sheets, their charts, the listening set (all CC0, review pending) |

## Platform notes

Node scripts run on Windows/macOS/Linux/ChromeOS (Crostini). `reg query` for the User env is
Windows-only (other OSes use the process env). The local shim's CUDA wheel is Windows/Linux
with an NVIDIA GPU; CPU wheels work anywhere, slowly. Previews need desktop Chrome/Edge.
