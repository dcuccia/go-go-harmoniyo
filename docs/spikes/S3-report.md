# S3 report — YARG handbell mode (Phase A: desk study)

- Spike: [S3 brief](README.md#s3--yarg-handbell-mode)
- Phase: **A only.** This was a desk study. No Unity install, no GitHub fork, and no upstream contact.
  Phase B needs owner action ([plan below](#phase-b-plan-needs-owner)).
- Date: 2026-10-22. Time box: one session.
- Sources studied (read-only clones, not vendored):
  - [YARC-Official/YARG](https://github.com/YARC-Official/YARG) `dev` @ `696e149f` (2026-10-19). Code-search
    cross-checks used `master` @ `f5bfbe69`.
  - [YARC-Official/YARG.Core](https://github.com/YARC-Official/YARG.Core) @ `9dafd346` (2026-10-19). This is
    the same commit as the submodule HEAD.
  - YARG `README.md`, `CONTRIBUTING.md`, `Packages/manifest.json`, `Assets/packages.config`,
    `.github/workflows/*`, and `ProjectSettings/*`.
  - Web searches for BASS licensing, Unity Personal terms, the Unity LTS line, and GitHub LFS-on-forks
    behavior. Each claim below links its source.
- Reproduce: `GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 -b dev https://github.com/YARC-Official/YARG.git`.
  Then grep the paths cited below.

## TL;DR

1. **YARG can already show 3–5 handbell ringers today, without code changes.** Its *Five-Lane Keys*
   mode can play any of the five 5-lane parts in a chart (`PART GUITAR`, `PART GUITAR COOP`,
   `PART RHYTHM`, `PART BASS`, and `PART KEYS`). That gives each ringer a GH-style highway with up to 5
   bells (6 with the open lane). Each ringer is "pressing a key", so there is no strumming. Band score,
   band multiplier, practice mode (slow-down and loop), star power, venues, and the score screen all come
   for free.
2. **YARG's timing model fits HGP well, with one gap.** YARG judges inputs on the Unity Input System's
   monotonic clock (about 100 µs precision) and syncs audio *to* that clock. A phone's source timestamp
   can be mapped onto that clock. The gap: the engine **moves any input older than its current time
   forward to "now"** (`BaseEngine.QueueInput`). Wi-Fi inputs usually arrive 5–40 ms after the fact, so
   they would be judged by arrival time. That defeats ADR-0002. The fix is small (about 50–150 LOC): let
   the engine run a set number of milliseconds behind the input clock for network devices.
3. **Smallest useful fork = "thin fork".** It has four pieces:
   - a virtual Unity Input System device per bell (precedent: Minis/MIDI and PlasticBand devices);
   - a localhost bridge from S1's host harness (the sidecar);
   - the engine lookbehind from item 2;
   - auto-create profile and default bindings for bell devices.

   Everything else is reused. **Estimate: ~13–20 agent-days plus ~3–5 owner-days. That fits M3
   (Nov 9 – Dec 6) with low slack.** A first-class "Handbell" instrument (new `Instrument`/`GameMode`,
   N parts) is **6–10 weeks** and is not a holiday option.
4. **Platform reach is desktop only:** Windows x64, macOS (universal), and Linux x86_64. There is no
   browser, Android/iOS host, ARM Linux, or practical ChromeOS support. Native BASS, YARG's own native
   audio plugin, libVLC, and SQLite rule out WebGL. Phones as controllers are unaffected because they are
   web pages either way.
5. **Licensing:** YARG is LGPL-3.0-or-later. It ships **BASS** (proprietary; free only for
   non-commercial use) and some **CC BY-NC 4.0** crowd sounds. Any YARG-based host is therefore
   **non-commercial only** unless those pieces are replaced or licensed. Unity Personal is free under
   US$200k revenue and funding, and the splash screen is optional in Unity 6. Our MIT code stays clean if
   it lives in the sidecar and talks to YARG over a socket.
6. **Upstream fit:** generic seams (network/virtual input devices with a latency budget, software device
   registration) are plausible upstream contributions. They need Discord discussion first (their
   CONTRIBUTING requires that), and a human must be able to defend AI-written code (their AI policy). A
   handbell instrument itself would almost certainly stay in our fork.
7. **Recommendation:** treat YARG as a strong candidate for a **"deluxe" Windows/macOS/Linux host**. It
   reaches GH-level engagement fastest because the engagement already exists. It **cannot** be the only
   host given the cross-platform and classroom goals, so pair it with S4 (web host) on a shared core.
   Run Phase B as a **2-day go/no-go** right after the owner installs Unity
   ([plan](#phase-b-plan-needs-owner)).

**Exact Unity version:** **`6000.3.5f2`**, revision **`3fa8bc678cb0`**. It is pinned identically on
`dev` and `master` (`ProjectSettings/ProjectVersion.txt`). Do **not** substitute the latest 6.3 LTS
patch (6000.3.27f1 as of 2026-10-20,
[source](https://activation.unity3d.com/releases/editor)). Use the pinned version.

---

## Report must answer

### Effort estimate

| Path | What it is | Code touched | Estimate | Holiday-feasible? |
|---|---|---|---|---|
| **P0 — Content-only (no fork)** | Package carols as YARG song folders: `song.ini`, `notes.mid` with ringer parts in the five 5-lane tracks, at least one audio stem. Ringers use Five-Lane Keys. Input from gamepads, or an HGP→**virtual MIDI port** bridge (YARG supports MIDI devices via Minis). | none in YARG; exporter in S5 | 3–5 days (mostly S5 exporter + audio render) | Yes, as a **fallback/demo**. Violates ADR-0002 (arrival-time judging over MIDI). At most 5 ringers. Virtual-MIDI setup friction (loopMIDI / Windows MIDI Services / IAC). |
| **P1 — Thin fork (recommended if YARG is chosen)** | P0 plus: HGP bell virtual device, localhost bridge, engine lookbehind, profile auto-create, default bindings, optional bell-on-hit samples, lane note labels, holiday theme. | ~10–20 C# files, almost no scene/prefab edits | **~13–20 agent-days + 3–5 owner-days** (breakdown below) | **Yes, tight.** Depends on S1 (HGP/transport) and S5 (charts). |
| **P2 — First-class Handbell instrument** | New `Instrument`/`GameMode`, `PART HANDBELL n` tracks, N parts beyond 5, own engine and player prefab, profile UI, color profile, theme models, cache/score DB/replay serialization. | Most recent comparable mode (Elite Drums) touches **34 YARG.Core + 32 YARG files** | 6–10 weeks | **No** (post-holiday, if ever) |

P1 breakdown:

| Work item | Agent-days | Owner involvement |
|---|---|---|
| B0/B1: install, first build from source, smoke test | 0.5–1 | Install Unity Hub, editor, Blender, LFS; sign in (Unity Personal) |
| HGP bell virtual device (`InputSystem.AddDevice`, custom layout, N buttons) + keyboard debug feeder | 2–3 | — |
| Localhost bridge (sidecar → YARG, UDP or WebSocket) + clock mapping to Unity input time | 2–3 | — |
| Engine lookbehind seam (per-device latency budget) + log-noise fixes | 1–2 | — |
| Profile auto-create for bells, default bindings, lane colors matching the phone's color | 1–2 | — |
| Bell-on-hit samples (reuse `BassOneShotSamplePlayer`, as drum SFX do) — optional | 2 | Choose sound (E05) |
| Lane note labels (C5, D♯5, …) on frets — optional | 1–2 | — |
| Carol packaging into YARG song folders (from S5 output) | 1–2 | — |
| Holiday theme (color profile, highway texture, background); prefer data and code over prefab edits | 1–2 | Taste check on TV |
| Windows build, packaging, playtest fixes | 2–3 | Family playtest |
| **Total** | **~13–20** | **~3–5 days spread out** |

Main estimate risks: Unity Editor work that agents can't do headlessly (prefab/scene edits, first
license activation), `dev`-branch churn, and S1/S5 slipping.

### How YARG's subsystems map to a handbell mode

| Subsystem | What YARG does (evidence) | Handbell implication |
|---|---|---|
| **Instrument pipeline** | `Instrument` and `GameMode` enums are fixed, reserved in blocks of 10 and 5 (YARG.Core `InstrumentEnums.cs` L12–80). `SongChart` has **one fixed property per instrument** (`SongChart.cs`). `GameMode.ProKeys` "includes Pro and Five-Lane" (L29). `PossibleInstruments(GameMode.ProKeys)` = ProKeys, Keys, FiveFretGuitar, FiveFretBass, FiveFretRhythm, FiveFretCoopGuitar (L281). | No generic "N parts" model. **Five 5-lane parts are reachable without code** via Five-Lane Keys (`FiveLaneKeysPlayer.GetNotes → chart.GetFiveFretTrack(Profile.CurrentInstrument)`, L135). More than 5 ringers needs P2 or parts shared between players. |
| **Chart formats** | `.chart`, RB/CH `.mid` (track names in `YARGMidiTrack.cs`, `MidIOHelper.cs`), `.sng`. `song.ini` requires `name`. Range-shift events (`RangeShift{Range,Size}`) can dim unused lanes. | S5 can export RB-style MIDI with one ringer per `PART …` track. A single range shift at tick 0 can highlight just a two-in-hand ringer's 2 lanes (verify in Phase B). |
| **Lane counts / rendering** | `FretArray.Initialize(highwayOrdering, laneCount, …)` (L70) and `LaneElement.DefineLaneScale(instrument, laneCount)` are already lane-count generic. Five-lane uses 5 or 6 lanes (`FiveLaneKeysPlayer` L853/L858). Drums compute `LaneCount` dynamically. | The **renderer is not the blocker** for custom lane counts. The blockers are the engine action enums and the fixed instrument model. |
| **Input system** | Unity Input System 1.17.0 + PlasticBand-Unity 0.10.0 + HIDrogen 0.5.3 + **Minis (MIDI)**. `ControlBinding` state monitors take **`eventPtr.time`**. `BasePlayer.OnGameInput` converts it with `GameManager.GetInputTime(input.Time) + InputCalibration` and queues it to the engine (L385–401). YARG registers its own layouts (`UnsupportedXboxOneDevice.cs` L38). `PlayerContainer` auto-creates a profile when a recognized device appears (`AutoCreateProfiles`, default **on**; L285–330). | A **virtual "HGP bell" device per phone** fits the existing architecture exactly. Bindings UI, profiles, replays, and calibration then work unchanged. A phone joins → a profile appears. |
| **Timing** | `SongRunner` header (L13–68): the Input System's monotonic clock is the primary time base (about 100 µs precision). Audio is synced *to* it by speed nudging. Per-profile `InputCalibration` is applied to **both** input times and engine update time (`BasePlayer` L276, L395). `BaseEngine.QueueInput` (YARG.Core L336–360) moves inputs that are out of order or **older than `CurrentTime`** forward. | **Gap:** a network input stamped at its true source time but arriving after the engine advanced past it is clamped to "now". Calibration can't fix this because it shifts both sides. **Seam needed:** engine lookbehind (see [draft issue 1](#draft-upstream-issue-1-latency-budget-for-network--virtual-input-devices)). |
| **Multiplayer** | Local only. Up to **32 highways** (`HighwayCameraRendering.MAX_MATRICES = 32`, L20). Highways tile side by side, each capped to 45% of screen width. Band score, band multiplier, and band stars exist (`GameManager.BandMultiplier`, `ScoreBox`, score screen). A single `Keyboard` device can't drive several profiles (`IsDeviceTaken`). | 3–5 highways on a TV is a supported layout. Readability at TV distance must be checked in Phase B. Team scoring needs no work. Keyboard-as-bells for more than one player needs virtual devices (the same work as HGP). |
| **Audio** | BASS via ManagedBass 3.1.1 (MIT wrapper) + `bass_fx`, `bassmix`, `bassopus`, `bassasio`, `basswasapi` (Windows), plus an in-repo native **`yarg_audio`** DSP plugin (Win/Mac/Linux x64). `dev` has an ongoing audio refactor that `master` lacks (`BassOneShotSamplePlayer`, WASAPI output, latency provider). Stems: `song, guitar, bass, rhythm, keys, vocals, drums…`. **A song needs at least one audio stem** (`GameManager.Audio.cs` L117 calls `.First()` on stems). Mute-on-miss is per stem. Drums already play **one-shot samples on hit** (`DrumsPlayer` L876–908). | Two audio designs, both cheap: (a) render each ringer's part to its own stem (`guitar.ogg`, `bass.ogg`, …) so misses mute that ringer, GH-style and forgiving; or (b) a bell sample on each hit via the drum-SFX path (more authentic; timing equals ring arrival plus the output buffer). Owner/E05 to choose. |
| **Build targets** | Desktop only: Windows x64 (Win10 21H1+ per [release notes](https://github.com/YARC-Official/YARG/releases)), macOS universal, Linux x86_64. Mono backend. Native plugins exist only for those targets. CI uses `game-ci/unity-builder` (macOS release workflow). | See [platform reach](#platform-reach-desktop-only). |
| **Networking precedent** | Only **outbound** UDP (Data Stream integration, RB3Enhanced, sACN lighting). No inbound listeners. | The HTTPS/WebSocket server for phones (iOS needs a secure context) is best kept **out of YARG**, in S1's sidecar. YARG only needs a localhost receiver. |

### Smallest change set (P1 "thin fork")

```mermaid
flowchart LR
  P[Phone page<br/>S1 controller] -- HGP over WSS/WebRTC --> S[Sidecar host harness<br/>S1, MIT, TypeScript/Node]
  S -- localhost UDP: bell id, button, host-clock ts --> A[HgpBridge in YARG fork]
  A -- InputSystem.QueueStateEvent(device, state, mappedTime) --> D[HgpBellDevice xN<br/>virtual Input System devices]
  D --> B[Existing bindings / profiles]
  B --> E[Five-Lane Keys engine<br/>with lookbehind seam]
```

1. **`HgpBellDevice`**: a Unity Input System device layout with 6–8 buttons (one per bell, plus spare
   for future gestures such as damp). Register it with `InputSystem.RegisterLayout`, then call
   `InputSystem.AddDevice` once per joined phone and `RemoveDevice` on leave.
2. **`HgpBridge`**: receives sidecar messages on localhost. It maps the sidecar's monotonic clock to
   Unity input time with a ping/pong over localhost (sub-ms RTT). It then queues state events with the
   **mapped source timestamp**. Press and release go as a pair. Events must stay **monotonic per device**:
   Unity drops state events older than the device's last update (to be confirmed in Phase B against
   Input System 1.17 source).
3. **Lookbehind seam**: in `BasePlayer.UpdateInputs`, advance the engine to `time − latencyBudget` for
   players whose devices declare a budget (e.g. 40 ms). Input times stay unchanged. Visual hit and miss
   feedback lags by the budget; judging stays exact. Also quiet the "input in the future" warnings
   (YARG.Core `BaseEngine` L222, L584) for budgeted players.
4. **Profiles and bindings**: in `PlayerContainer.CreateProfileFromDevice`, map `HgpBellDevice` to
   `GameMode.ProKeys` with instrument `Keys` (five-lane). Set a part by join order and default bindings
   (button *i* → `ProKeysAction.GreenKey + i`). Tell the phone its lane color so the color matches
   the highway (E02).
5. **Optional polish**: bell one-shot on hit; note-name labels on frets; a "Handbell" color profile and
   holiday highway theme.

All of this is C# code. Only the optional theme work might touch prefabs or scenes. Agents edit those
poorly, so keep it minimal.

### Risk list

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Late network inputs clamped to arrival time (`BaseEngine.QueueInput`) | Certain without the seam | High (timing accuracy) | Lookbehind seam (P1 step 3); measure in Phase B with injected jitter |
| R2 | Unity Input System drops per-device out-of-order or old events | Medium | Medium | Bridge sorts or drops per device using HGP sequence numbers; verify against Input System 1.17 |
| R3 | `dev` churn (audio refactor in progress; `dev` and `master` differ) | High | Medium | Pin a `dev` commit for the holiday; rebase after Dec 18 |
| R4 | Unity Editor needed for scenes, prefabs, and first license activation; agents can't drive it | High | Medium | Code-only changes; owner does a one-time activation; batch-mode builds on the owner's PC |
| R5 | Setup failure on the owner's PC (Blender required for model import, LFS, NuGet restore, "Ignore Safe Mode") | Medium | High (blocks Phase B) | Follow the B0 checklist exactly; kill criterion if not building within 1 day |
| R6 | Desktop-only host (no browser, ChromeOS, ARM, or tablet) | Certain | High vs cross-platform goal | Pair with S4 web host on a shared core |
| R7 | Non-commercial lock-in (BASS, CC BY-NC crowd SFX) | Certain | Low now, high if monetized | Keep the project free; flag for the owner before any monetization |
| R8 | Five-lane keys semantics vs bells (sustains/holds, overhit penalties, open note) | Medium | Medium | Charts avoid sustains (bells "LV"); tune the engine preset (hit window, overhit) via existing `EnginePreset` |
| R9 | At most 5 parts in the stock content model | Certain | Low for holiday (3–5 ringers); High for classroom (8–12) | P2 later, or upstream "extra parts" seam |
| R10 | Songs need ≥1 audio stem | Certain | Low | S5 renders a backing or per-ringer stem |
| R11 | Shared-core mismatch: YARG judges in C# (YARG.Core); a TypeScript web host would judge separately | Depends on M2 | High (violates "hosts share a core") | Decide with S2 (YARG.Core in WASM?) before committing to two hosts |
| R12 | Git LFS: pushes to and pulls from a fork count against the **parent's** (YARC-Official) quota ([GitHub docs](https://docs.github.com/en/enterprise-cloud@latest/repositories/working-with-files/managing-large-files/collaboration-with-git-large-file-storage)) | Certain | Low (HEAD LFS ≈ 71 MB, 535 files) | Don't add LFS assets in the fork; avoid LFS pulls in fork CI |
| R13 | Readability of 5 highways at TV distance | Medium | High (engagement) | Phase B screenshot/video on the TV; note speed and highway length per profile |
| R14 | Upstream rejects the seams, so we carry the patch | Medium | Low–Medium | Keep the seams small and isolated (≈1–3 files each) so rebasing is cheap |

### Platform reach (desktop only?)

**Yes — desktop only.**

| Host platform | YARG today | Notes |
|---|---|---|
| Windows x64 | ✅ | Holiday target (owner's PC → TV) |
| macOS (Intel + Apple silicon) | ✅ universal | — |
| Linux x86_64 | ✅ | HID needs udev rule (README) |
| Linux ARM / Raspberry Pi | ❌ | No ARM natives (BASS, yarg_audio, VLC, SQLite) |
| ChromeOS | ⚠️ only via Crostini on x86_64 with Linux enabled | School-managed Chromebooks usually block Linux; ARM Chromebooks no. **Classroom low-budget host not served.** |
| Browser (WebGL/WebGPU) | ❌ | Native BASS + yarg_audio + libVLC + SQLite + filesystem song scanning; not a realistic port |
| Android/iOS/tvOS as host | ❌ | Icons exist in ProjectSettings, but no mobile natives or builds; the community YARG-Android fork is archived |
| Phones as **controllers** | ✅ (unaffected) | Web page per ADR-0003; YARG only sees HGP via the sidecar |

### BASS licensing implications

- BASS (un4seen) is **proprietary and free for non-commercial use**. The Shareware license costs
  €125. Commercial licenses are priced on request and are **per platform**
  ([un4seen](https://www.un4seen.com/bass.html); details summarized via web search, 2026-10-22). YARG's
  README lists BASS as "Proprietary (free for non-commercial use)". The binaries are committed in
  `Assets/Plugins/BassNative/`.
- The .NET wrapper YARG uses is **ManagedBass** (MIT), not BASS.NET. This adds no wrapper license cost.
- YARG also ships **CC BY-NC 4.0** crowd sounds (README "External Licenses"). That is a second
  non-commercial constraint, independent of BASS.
- **Implication for us:** a free family or classroom distribution of a YARG fork is fine. **Any
  monetization** (paid app, paid classroom kit, ads) would require a BASS license *per platform* and
  replacement of the NC assets. The alternative is replacing the audio backend, which would be a large
  effort given the `dev` audio refactor. **Flag for owner; no decision made.**
- **MIT boundary:** keep our code (HGP, sidecar, chart pipeline) in this MIT repo and talk to the fork
  over a socket. Code inside the fork is LGPL-3.0-or-later; MIT-licensed files may be added to an LGPL
  project. Unity Personal: free under US$200k revenue and funding; the splash screen is optional in Unity 6
  ([Unity pricing updates](https://unity.com/products/pricing-updates)).

### Would upstream plausibly accept the seams?

YARG's [CONTRIBUTING.md](https://github.com/YARC-Official/YARG/blob/master/CONTRIBUTING.md) says:

- PRs must target `dev`.
- Ask in Discord before starting a feature.
- Content must be original or licensed.
- Library licenses must be compatible.
- Follow `.editorconfig`.
- **AI coding assistants:** "You are expected to understand and to be able to defend everything you
  submit… The human submitter is responsible."

Features are sorted into In-Development, Planned, Stretch, Eligible, Problematic, and Out-of-Scope.

| Seam | Generic benefit to YARG | Plausibility | Why |
|---|---|---|---|
| Latency budget / lookbehind for virtual or network input devices | Wireless and Bluetooth instruments, future remote and companion-app inputs | **Medium** | Small and opt-in, but it touches the engine timing path that maintainers clearly guard (see SongRunner design notes) |
| Software input-device registration (layout + default bindings + profile auto-create from a pluggable provider) | Companion apps, accessibility devices, mod controllers | **Medium-low** | Useful, but YARG has no plugin system today; may be seen as mod support |
| Extra 5-lane parts / N-part songs | Party modes | **Low** | Changes chart model, cache, and score DB; niche |
| Note-name labels on lanes | Keys learners | **Low-medium** | Small UI; taste-dependent |
| Handbell instrument itself | — | **Low** | Not on their lists; likely "Eligible" at best; keep in fork |

Process: owner (a human) opens the Discord conversation first, then the issues below. Do not open
anything without owner approval (AGENTS.md).

### Does it inherit GH-level engagement?

**Mostly yes — this is YARG's strongest argument.** Out of the box:

- 3D highways with note models and hit flashes;
- combo meter, star power, solos, and big-rock-ending lanes;
- band multiplier and band score;
- crowd FX and venues (yargrounds);
- score screen with per-player stats, including average offset in ms;
- replays and practice mode (song speed, section loop).

No other open-source option we know of matches this. Handbell-specific gaps:

- **bell sound on ring**: reuse the drum-SFX path or per-ringer stems;
- **note names on lanes** (lanes are colors, not pitches);
- **handbell or holiday visual identity**: color profiles and themes, without commercial assets;
- **no ringing-technique feedback** (damp, LV) — later HGP gestures.

### Recommendation

1. **Don't make YARG the only host**: it can't reach browser, ChromeOS, or ARM classroom hosts (R6).
2. **Do consider YARG (P1 thin fork) as the holiday "deluxe" Windows host** if Phase B passes. It is
   likely the fastest route to GH-level feel for M5. The engagement work (E07) is largely done
   already, and our effort goes to input and content.
3. **Before M2, resolve R11 with S2/S4.** If the web host judges with TypeScript, two hosts would
   diverge. The options are YARG.Core in WASM (S2), or accepting YARG as a separate product line
   sharing only the chart format and HGP.
4. **Start Phase B immediately after the owner installs Unity.** Time-box it to 2 days with the kill
   criteria below.
5. Keep **P0 (content-only + virtual MIDI)** as a no-fork fallback demo. It also exercises S5's YARG
   export.

---

## Phase B plan (needs owner)

### B0 — Owner actions (≈1–2 h, one time)

1. Install [Unity Hub](https://unity.com/download) and sign in with a **Unity Personal** license.
2. Install editor **`6000.3.5f2`** (changeset `3fa8bc678cb0`). Use the Hub deep link
   `unityhub://6000.3.5f2/3fa8bc678cb0`, or open the YARG project and accept the prompted version.
   - Modules: the Windows editor already includes Windows Build Support (Mono); nothing else is
     required. Untick Visual Studio if Rider or VS is already installed. "Mac Build Support (Mono)" is
     needed only for venue authoring.
3. Install **[Blender](https://www.blender.org/)** (latest); YARG needs it to import models even if you
   never edit them. Also install the **.NET SDK** (not just the runtime) and **Git LFS**.
4. Approve creating fork **`dcuccia/YARG`**. When forking, **untick "Copy the `master` branch only"**
   so `dev` is included (YARG README).

### B1 — Build stock YARG from source (agent, owner watches first launch) — ½–1 day

- `git clone -b dev --recursive https://github.com/dcuccia/YARG.git` (fork), then `git lfs fetch &&
  git lfs checkout`.
- Open in Unity and click **"Ignore"** at the Safe Mode prompt (never enter Safe Mode). Run **NuGet →
  Restore Packages**, then enter Play mode. Build a Windows x64 player.
- **Record:** clone, first import, and build times; editor and player frame times at 1080p and on the
  TV; the commit pinned; any setup errors.

### B2 — Zero-code look test (P0) — ½ day

- Hand-make one public-domain carol song folder. Use 3–5 ringer parts in `PART GUITAR`, `PART GUITAR
  COOP`, `PART RHYTHM`, `PART BASS`, and `PART KEYS` (2–4 bells each). Add one rendered `song.ogg`
  (license recorded per file; coordinate with S5).
- 3–5 profiles in **Five-Lane Keys** mode, each on its own input device (gamepads, or MIDI ports via a
  virtual-MIDI tool).
- **Capture** a screenshot and short video of 5 highways on the TV. Try a range shift to highlight
  2 lanes, and lane color profiles.

### B3 — `handbell-spike` branch (thin-fork core) — 1 day

- `HgpBellDevice` + keyboard debug feeder (e.g. `QWERT` → bell device 1, `ASDFG` → device 2) so
  several "ringers" work on one PC without phones.
- `HgpBridge` localhost UDP receiver + synthetic-jitter injector (0–60 ms uniform).
- Lookbehind seam with configurable budget.
- **Measure:** per-hit judged offset vs injected source offset (ms, p50/p95), with and without the
  seam; count of "engine was forced to move an input time" warnings; visual lag at budgets of 20, 40,
  and 60 ms.

### B4 — HGP via S1 harness (if S1 is ready) — ½ day

- Point S1's host harness at `HgpBridge`, then play one carol with 2+ real phones.

### Phase B exit / kill criteria

- **Kill** if B1 doesn't produce a working build within 1 day of setup, or if 5 highways are
  unreadable on the TV at living-room distance even after note speed and highway tweaks.
- **Kill** if the lookbehind seam needs more than ~150 LOC in YARG.Core, or if p95 judged error with
  40 ms injected jitter exceeds 15 ms (the S1 target).
- **Pass** → write ADR-0004 input ("YARG thin fork as deluxe desktop host") with Phase B measurements.

---

## Draft upstream issues (not filed — owner approval required)

### Draft upstream issue 1: Latency budget for network / virtual input devices

> **Title:** Opt-in input latency budget so late-arriving (network/virtual) inputs keep their source timestamps
>
> **Problem.** Inputs from wireless or network sources can be stamped accurately at the source but
> reach the Input System 5–40 ms later. `BaseEngine.QueueInput` moves any input older than
> `CurrentTime` forward to `CurrentTime`. So these inputs are judged by arrival time, not by when the
> player hit. Per-profile input calibration doesn't help: it shifts both input times and the engine
> update time.
>
> **Proposal.** Add an optional per-device (or per-player) `LatencyBudget`. When set, `BasePlayer`
> advances the engine to `inputTime − budget` while queuing inputs with their original timestamps.
> Hit/miss visuals lag by the budget; judging stays exact. Default 0 = current behavior.
>
> **Scope.** ~1–3 files (BasePlayer + a device capability flag). No chart, cache, or replay format
> changes. Replays already store input times.
>
> **Questions for maintainers.** Is a per-device capability (custom device interface) preferred over a
> profile setting? Any interaction with the audio sync or rewind paths we should respect?

### Draft upstream issue 2: Register software input devices from a provider

> **Title:** Allow software-created input devices to supply default bindings and profile auto-creation
>
> **Problem.** Devices created in software (`InputSystem.AddDevice` with a custom layout — e.g. a
> companion-app or accessibility controller) can be bound manually. But they can't participate in
> `PlayerContainer.CreateProfileFromDevice` or `BindingCollection` defaults without editing
> those switch statements.
>
> **Proposal.** A small interface, e.g. `IYargDeviceDefaults { GameMode DefaultMode; bool
> SetDefaultBindings(BindingCollection) }`. The two existing code paths check for it before their
> type switches.
>
> **Scope.** ~2–3 files, no behavior change for existing devices.

### Draft upstream issue 3 (lower priority): Note-name labels on lanes

> **Title:** Optional pitch labels on lanes/frets for keys modes
>
> For learners, show note names (e.g. C4, D♯4) on Five-Lane / Pro Keys frets when the chart provides
> them. Purely visual; off by default.

---

## Evidence index (YARG `dev` @ `696e149f`, YARG.Core @ `9dafd346`)

| Claim | Location |
|---|---|
| Unity version | `ProjectSettings/ProjectVersion.txt` → `6000.3.5f2 (3fa8bc678cb0)` (same on `master` @ `f5bfbe69`) |
| Input-clock time base | `Assets/Script/Playback/SongRunner.cs` L13–68 |
| Calibration applied to both input and engine time | `Assets/Script/Gameplay/Player/BasePlayer.cs` L56, L276, L395 |
| Engine clamps past inputs | YARG.Core `YARG.Core/Engine/BaseEngine.cs` L336–360 (also L222, L236, L584) |
| Future-event check | `Assets/Script/Input/InputManager.cs` L230 |
| Five-lane keys plays any 5-lane part | `Assets/Script/Gameplay/Player/FiveLaneKeysPlayer.cs` L135; YARG.Core `InstrumentEnums.cs` L281 |
| Prefab choice per mode | `Assets/Script/Gameplay/GameManager.Loading.cs` L500 |
| Lane-count-generic frets | `Assets/Script/Gameplay/Visuals/Fret/FretArray.cs` L70–77; `FiveLaneKeysPlayer.cs` L853/L858 |
| 32 highway cap | `Assets/Script/Gameplay/Visuals/HighwayCameraRendering.cs` L20 |
| Auto-create profile on device | `Assets/Script/Player/PlayerContainer.cs` L285–330; `SettingsManager.Settings.cs` L271 |
| Custom layout precedent | `Assets/Script/Input/Devices/UnsupportedXboxOneDevice.cs` L38; Minis + PlasticBand in `Packages/manifest.json` |
| Hit-triggered samples precedent | `Assets/Script/Gameplay/Player/DrumsPlayer.cs` L876–908; `Assets/Script/Audio/Bass/BassDrumSampleChannel.cs` |
| ≥1 stem required | `Assets/Script/Gameplay/GameManager.Audio.cs` L117 |
| Natives (desktop only) | `Assets/Plugins/{BassNative,YargAudio,vlc,Sqlite3,LibUSB}` |
| Outbound-only networking | `Assets/Script/Integration/{Data Stream,RB3E,Sacn}` |
| Package versions | Input System 1.17.0, PlasticBand 0.10.0, HIDrogen 0.5.3, URP 17.3.0, ManagedBass 3.1.1 |
| LFS size at HEAD | `git lfs ls-files -s` → 535 files, ≈71 MB |
| Size of last new mode (Elite Drums) | `git grep -l EliteDrums` → 34 files (YARG.Core), 32 files (YARG `Assets/`) |
