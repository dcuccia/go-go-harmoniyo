# S2 report — YARG.Core portability

- Spike: [S2](README.md#s2--yargcore-portability) · Feeds: E03, E04 · Date: 2026-10-22
- Code: [spikes/s2-yarg-core/](../../spikes/s2-yarg-core/README.md)
- YARG.Core pinned at [`9dafd346`](https://github.com/YARC-Official/YARG.Core/commit/9dafd346aff908b6d5b1db250eaf3a2588810c70)
  (default branch, 2026-10-19, "Lift mechanic for 5LK (#477)"), fetched by script — not vendored, not forked.

**Question:** Can YARG.Core serve as an engine-agnostic shared core — in a .NET console app and in
the browser via WebAssembly?

**Short answer: yes, with one small patch.** Unmodified YARG.Core parses charts and scores
correctly in a .NET console app on .NET 9 and 10. In `browser-wasm` it **fails on first use**
because `YargLogger`'s static constructor starts a thread; a 5-line guard fixes it, after which
`.chart` and RB-style `.mid` parsing and the stock keys engines run in Chrome with
**bit-identical results** to the console host. A per-ringer handbell mode can be prototyped today
on top of the Pro Keys engine **with zero YARG.Core changes**.

## What was built

- `HandbellSpike.Core` (shared): generates a self-authored sample song (public-domain *Jingle
  Bells* refrain, own transcription + bass, MIT) as a `.chart` and as an RB-style `.mid`
  (`PART REAL_KEYS_X`), parses both with `SongChart.FromDotChart` / `SongChart.FromMidi`, and
  drives YARG.Core's stock engines (`YargFiveLaneKeysEngine`, `YargProKeysEngine`) with seeded,
  Gaussian-jittered synthetic "bell strikes" (press + release per strike) plus optional misses
  and false strikes. Hit window ±70 ms, fixed (not dynamic).
- `RingerSplit`: splits the 8-bell Pro Keys difficulty into 4 per-ringer difficulties
  (Bass C3/F3/G3, C4–D4, E4–F4, G4), one engine per ringer — YARG's band model.
- Console host and a `Microsoft.NET.Sdk.WebAssembly` browser host (no Blazor) running the same
  `SpikeRunner.RunAll()`; both print a result fingerprint.

## Builds on which targets

| Target | Toolchain | Result |
|---|---|---|
| YARG.Core library (`netstandard2.1`, C# 9) | .NET SDK 10.0.112 | Builds, 0 errors, 1 nullable warning |
| Console, `net10.0` win-x64 | .NET 10.0.12 | ✅ Runs; fingerprint `C47FDEC481506BDA` |
| Console, `net9.0` win-x64 | .NET 9.0.20 | ✅ Runs; same fingerprint |
| `browser-wasm` `net10.0`, **unpatched** YARG.Core | .NET 10.0.0 runtime, Chrome 155 (Playwright) | ❌ `TypeInitializationException` → `PlatformNotSupportedException` at `YargLogger..cctor()` → `Thread.Start()`, on the first `FromDotChart` call |
| `browser-wasm` `net10.0`, patched | same | ✅ Runs; same fingerprint |
| `browser-wasm` + `InvariantGlobalization` | same | ✅ Runs; same fingerprint |
| `browser-wasm` under 4× CPU throttling (CDP) | same | ✅ Runs; same fingerprint |

Not tested: macOS/Linux hosts (expected to work — pure managed `netstandard2.1`), Safari/Firefox
(no reason to expect differences for interpreter-mode .NET WASM, but unverified), WASM AOT
(needs the `wasm-tools` workload, not installed — installing requires elevation), multithreaded
WASM (`WasmEnableThreads`, would also avoid the logger crash but requires COOP/COEP headers).

### The blocker and the patch

`YargLogger` (used by every parser and engine — even filtered-out `LogTrace` calls touch the
class) has an explicit static constructor that starts a background "log drain" thread.
Single-threaded browser-wasm throws on `Thread.Start`. The spike guards it:

```csharp
if (RuntimeInformation.IsOSPlatform(OSPlatform.Create("BROWSER")))
{
    return; // no threads on single-threaded browser-wasm; call FlushLogQueue() manually
}
```

([full diff](../../spikes/s2-yarg-core/patches/0001-yarglogger-no-thread-on-browser.diff)). Logs
still queue and can be drained by `YargLogger.FlushLogQueue()` (e.g. once per frame). Note: with
no drain thread, `Failure`-level asserts accumulate until flushed.

**Draft upstream issue (not filed — needs owner approval):**
> *YargLogger static constructor throws on single-threaded platforms (browser-wasm).*
> `YargLogger..cctor` unconditionally starts a background thread, so any YARG.Core API that logs
> throws `TypeInitializationException`/`PlatformNotSupportedException` under .NET browser-wasm.
> Proposal: skip starting the thread when threads are unsupported (e.g. `OSPlatform "BROWSER"`
> check, or catch `PlatformNotSupportedException`) and let hosts call `FlushLogQueue()`.
> Optional: an opt-in `YargLogger.ManualFlush` mode. Small, no behavior change on desktop/Unity.

## WASM size / perf

Release publish, .NET 10, interpreter (no AOT), default trimming. Sizes are what a browser
downloads (brotli files are produced by publish).

| Asset | Raw | Brotli |
|---|---:|---:|
| `dotnet.native.wasm` (runtime) | 2,930 KB | 954 KB |
| `System.Private.CoreLib` | 1,290 KB | 400 KB |
| **`YARG.Core`** (trimmed from 1,017 KB) | **310 KB** | **107 KB** |
| `System.Text.RegularExpressions` (pulled by YARG.Core vocals/replay code) | 242 KB | 95 KB |
| `Melanchall.DryWetMidi` (Nativeless) | 71 KB | 27 KB |
| everything else (Linq, JS interop, ZString, spike code, …) | ~160 KB | ~60 KB |
| **Total, excluding ICU** | **5.4 MB** | **1.74 MB** |
| + ICU data (EFIGS) / with `InvariantGlobalization` | +550 KB / 0 | +141 KB / 0 |

`Newtonsoft.Json` is referenced by YARG.Core but trimmed out entirely on this code path.

Timings (sample song: 67 notes / 36 s; "4-ringer engines" = split + 4 engines + 134 inputs for
the whole song). Desktop = Windows 11, same PC for all rows.

| Measurement | Console .NET 10 (JIT) | Chrome WASM (interp.) | Chrome WASM, 4× CPU throttle |
|---|---:|---:|---:|
| Runtime boot (`dotnet.create`, localhost) | — | 234–407 ms | 869 ms |
| Cold first `.chart` parse (incl. static init / warm-up) | 107–141 ms | 110–123 ms | 2,459 ms |
| Warm `.chart` parse (median of 20) | 0.47 ms | 4.4 ms | 76 ms |
| Warm `.mid` parse (median of 20) | 0.46 ms | 3.6 ms | 69 ms |
| Warm 4-ringer scoring, full song | 0.78 ms | 10.5 ms | 175 ms |
| ≈ per input (press or release) | ~6 µs | ~80 µs | ~1.3 ms |

Interpretation: the interpreter is ~9–13× slower than JIT. On a desktop browser the scoring cost
is negligible (a 5-ringer frame with a few strikes is well under 1 ms). On a heavily throttled
CPU, per-input cost (~1.3 ms) is still workable for a handful of strikes per frame but leaves
little headroom; chart parsing should happen at song load, not mid-song. WASM AOT is the obvious
next lever (unmeasured). The 4× CDP throttle slowed the interpreter ~17×, so treat that column as
a pessimistic proxy, not a Chromebook measurement.

### Scoring results (identical on all runtimes)

| Scenario (hit window ±70 ms) | Jitter σ | Team accuracy | Notes |
|---|---:|---:|---|
| `.chart` → 5-lane keys, 1 player, 5 bells | 15 ms | 51/51 | mean \|offset\| 14.6 ms |
| `.mid` → Pro Keys, 1 player, all 8 bells | 15 ms | 67/67 | score 23,160 |
| `.mid` → 4 per-ringer Pro Keys engines, 1 % miss + 1 % false strikes | 10 ms | 100 % | team score 15,360 |
| same | 20 ms | 100 % | p95 \|offset\| ≤ 52 ms |
| same | 35 ms | 91.0 % | 6 overhits from out-of-window strikes |
| same | 50 ms | 76.1 % | |

Two findings for E06 (scoring): (1) with ±70 ms windows, total strike-timing error (human +
sensor + clock sync) needs σ ≲ 20 ms to feel fair — consistent with S1's p95 ≤ 15 ms
sync target; (2) YARG's combo multiplier (×1 per 10-note streak, max ×4) is per player, so the
same perfect performance scores 23,160 as one player but 15,360 split over 4 ringers, and a
ringer with 5 notes never leaves ×1. Team play needs a team/band multiplier (YARG.Core's
`EngineManager` has band-bonus machinery to evaluate).

## Native dependencies and other blockers

| Item | Where | On chart/scoring path? | Browser status |
|---|---|---|---|
| `STB2CSharp` (C++ wrapper over `stb_image`, `[DllImport]`) | `IO/Images/YARGImage.cs` (album art) | No — trimmed away | Would need an Emscripten build (`NativeFileReference`, `wasm-tools`) or browser-side image decode |
| Background thread in `YargLogger` | `Logging/YargLogger.cs` | **Yes — every parser/engine** | **Blocker; patched** (see above) |
| Threads / `Parallel` | song-cache scanning (`Song/Cache/*`), `SngFileStream`, `Audio/GlobalAudioHandler` | No | Not needed in browser (no local song library); would need rework |
| `MemoryMappedFile` | `PackedCONEntryGroup` (RB CON packages) | No | Unsupported in browser; irrelevant |
| File-path APIs (`SongChart.FromFile`) | loaders | Avoidable | Use in-memory `FromDotChart(ReadOnlySpan<char>)` / `FromMidi(MidiFile)` |
| `Newtonsoft.Json` (reflection) | presets/profiles | No | Trimmed out; profile serialization would need trimming care |
| Full trimming of an un-annotated library | publish default | — | Worked for this path, but YARG.Core isn't trim-annotated; expand coverage or root the assembly if more APIs are used |
| Audio (BASS) | **not in YARG.Core** — lives in YARG (Unity) | — | A web host supplies its own audio (Web Audio) |
| Unsafe code, `stackalloc`, fixed buffers | parsers | Yes | Works in WASM |

No native library is needed for chart parsing and scoring. DryWetMIDI is the *Nativeless*
package.

## Effort and seams for a Handbell instrument

How YARG.Core models instruments: closed enums (`GameMode` in blocks of 5, `Instrument` in blocks
of 10, serialized in replays), one note type per family (`GuitarNote`, `ProKeysNote`, …), a
`SongChart` with one hard-coded property per instrument filled by an `ISongLoader`
(Moonscraper-derived `.chart`/`.mid` readers keyed on track names like `PART REAL_KEYS_X`), and
one engine hierarchy per family (`BaseEngine<TNote, TParams, TStats>` → `KeysEngine<T>` →
`YargProKeysEngine`). Engines take an `InstrumentDifficulty<TNote>` + `SyncTrack`; the host calls
`QueueInput(GameInput{Time, Action, value})` and `Update(time)`. Inputs carry **their own
timestamps** — compatible with ADR-0002's source-timestamp judging.

Pro Keys is the closest analogue: 25 pitched lanes (MIDI 48–72, C3–C5), chords, per-key press
times. "Pro Keys" in YARG.Core appears in **45 of 314 source files** (enums, loaders, MIDI
reader, note, engine, stats, replays/analyzer, presets/colors, song scanning/metadata) — a
measure of what a first-class new instrument touches.

| Option | What | Seams used | Effort (core only) | Limits |
|---|---|---|---|---|
| **A. Per-ringer Pro Keys (proven here)** | Author handbell charts as `PART REAL_KEYS_*`; at load, split into per-ringer difficulties; one `YargProKeysEngine` per ringer; HGP `ring` → `ProKeysAction.KeyN` press+release | Public APIs only, **no YARG.Core changes** | ~1–2 days to productionize | 25-semitone window (C3–C5 as written; transpose to fit); piano semantics (fat-finger, chord stagger, glissando — disable/ignore); no damp; per-player multiplier |
| B. Out-of-tree `HandbellEngine`/`HandbellNote` | Subclass `BaseEngine<…>` / `Note<…>` in our assembly | Verified: no `internal abstract` members, protected ctors | ~1–2 weeks | Must reuse an `Instrument` value (replays/presets assume the closed enum); own loader since `SongChart`/`ISongLoader` are closed |
| C. First-class "Handbells" instrument (fork → upstream PR) | New `GameMode`/`Instrument` range, `HandbellAction` using `GameInput.Integer` = bell pitch (no 25-key limit), note type, `PART HANDBELLS` MIDI track, `SongChart` property, engine + stats + replay stats, presets/colors, scanning | Same 45-file surface as Pro Keys | ~2–4 weeks core, plus YARG/Unity UI (S3) | Needs upstream buy-in (S3/E10); `KeysEngine.KeyMask` is a 32-bit `int`, so >32 lanes per engine needs a wider mask — per-ringer engines (2–8 bells each) avoid this naturally |

Host-side seam (any option): engines reject inputs older than their `CurrentTime` (they're
nudged forward). With networked bells, the host must run the engine clock a small, fixed latency
budget behind the audio clock (e.g. 60–100 ms) so remote, source-timestamped strikes arrive
before the engine passes them. Feed this to S1/HGP.

## LGPL-3.0 implications for an MIT project (flag for owner — not decided)

Not legal advice; points to confirm:

1. **Using YARG.Core unmodified as a separate assembly** from MIT code is the LGPL's intended use.
   Obligations when distributing: include LGPL-3.0 + GPL-3.0 texts and notices, offer the
   library's corresponding source, and let users replace the library with a modified version.
2. **Our patches** (e.g. the logger guard) are modifications of the Library → must be published
   under LGPL (a public fork or patch set satisfies this). Upstreaming them removes the burden.
3. **Browser builds complicate "replaceability":** YARG.Core ships as its own `YARG.Core.wasm`
   (webcil) file, but it is **trimmed** (a modified binary) and listed with integrity
   fingerprints in the boot manifest; **WASM AOT** would statically link it into
   `dotnet.native.wasm`. LGPL-3 §4(d) then requires supplying what users need to relink
   (e.g. untrimmed build inputs/instructions or object files). Option: root YARG.Core from
   trimming and document how to swap it.
4. **Copying YARG.Core source into this MIT repo is not OK**; keep it in a separate repo,
   submodule, or package (this spike fetches it by script into a git-ignored folder).
5. YARG.Core bundles Moonscraper parser code (BSD-3-Clause → attribution). Other deps on this
   path are MIT (DryWetMIDI, ZString, Newtonsoft.Json, .NET runtime).
6. The MIT app may stay MIT; LGPL-3 §4 also requires the combined work's terms to allow
   modification of the library part and reverse engineering to debug such modifications — MIT
   permits this.

## Recommendation: "shared core = YARG.Core?"

**Qualified yes — for the C# side.** YARG.Core is a genuinely engine-agnostic, portable core:
pure managed `netstandard2.1`, no native deps on the parsing/scoring path, deterministic across
JIT and browser-wasm, ~107 KB brotli in the browser, and fast enough for real-time scoring even
interpreted. It also gives us `.chart`/RB-MIDI compatibility (M9 community charts) for free.

Conditions / caveats for the M2 gate:

- **Upstream the logger fix** (or carry it in a fork); without it YARG.Core cannot run in a browser.
- **Handbell mode now = Option A** (per-ringer Pro Keys, no core changes); pursue a first-class
  instrument (Option C) only alongside an S3 upstream conversation.
- **Team scoring** needs a band/team multiplier rather than per-player combos.
- **If the web host is TypeScript (S4):** YARG.Core can still be the shared core by running
  .NET-wasm alongside the TS renderer via `[JSExport]` — exactly the pattern this spike uses —
  at ~1.7 MB extra download and ~0.3–0.9 s boot. The alternative (porting judging to TypeScript)
  forks the scoring logic away from YARG. For an Avalonia/Blazor web host (S6) YARG.Core drops in
  directly.
- **LGPL in the browser** (trimming/AOT relinking) needs an owner decision before shipping.

## Open follow-ups

- WASM AOT size/perf (`dotnet workload install wasm-tools`, needs admin).
- Safari (iOS/macOS) and Firefox runs; real low-end Chromebook measurement.
- Multithreaded WASM as an alternative to the logger patch (requires COOP/COEP).
- Prototype `EngineManager` band scoring for 3–5 ringers.
