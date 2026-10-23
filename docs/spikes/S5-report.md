# S5 report — Carol chart pipeline

- Spike: [S5](README.md#s5--carol-chart-pipeline) · Feeds: E04, E06 · Status: **Done**
- Date: 2026-10-22/23 · Time box: one session · Code: [`spikes/s5-chart-pipeline/`](../../spikes/s5-chart-pipeline/README.md)
- Environment: Windows 11, Node v22.18.0, zero npm dependencies. Exported MIDI independently
  parsed with [`midi-file`](https://www.npmjs.com/package/midi-file) 1.2.4 (temp dir, not committed).

## Answer

**Yes.** Public-domain carols (lead sheets or SATB MIDI/MusicXML) can be turned automatically
into handbell charts for 3–5 ringers at three difficulties, with playability checks, in
< 250 ms per song. For the holiday target (**4 ringers**), easy and medium tiers are clean or
near-clean for most carols; hard tiers are playable but concentrate fast melody on one ringer.
The biggest lever is not the algorithm but the **controller model**: a phone that covers only
1–2 bells cannot carry a carol melody with 3–5 people (8–11 distinct pitches). Plan for
**≥ 3–4 bells per phone** (on-screen zones), or two phones per person.

Reproduce: `cd spikes/s5-chart-pipeline && node build.mjs && node --test` (11 tests pass).
All numbers below come from the generated [`results/metrics.md`](../../spikes/s5-chart-pipeline/results/metrics.md).

## Sources and licenses

Corpus: **8 carols** (5 self-encoded + 3 third-party), every file redistributable, license
recorded per file in [`songs/manifest.json`](../../spikes/s5-chart-pipeline/songs/manifest.json)
and copied into each chart's `song.license` / `song.source`.

| Carol | File | Source | License | Content |
|---|---|---|---|---|
| Jingle Bells (Pierpont, 1857) | `songs/jingle-bells.abc` | self-encoded | CC0-1.0 | melody + chords, verse + refrain |
| Joy to the World (ANTIOCH, Mason 1839) | `songs/joy-to-the-world.abc` | self-encoded | CC0-1.0 | melody + chords |
| Silent Night (Gruber, 1818) | `songs/silent-night.abc` | self-encoded | CC0-1.0 | melody + chords |
| Deck the Halls (Welsh trad.) | `songs/deck-the-halls.abc` | self-encoded | CC0-1.0 | melody + chords |
| We Wish You a Merry Christmas (English trad.) | `songs/we-wish-you-a-merry-christmas.abc` | self-encoded | CC0-1.0 | melody + chords, pickup |
| It Came Upon the Midnight Clear (CAROL, Willis 1850) | `sources/mutopia/carol.mid` | [Mutopia #1231](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1231), typeset by Steve Dunlop | Public Domain (Mutopia) | SATB on 2 staves |
| Good King Wenceslas (Piae Cantiones 1582) | `sources/mutopia/GoodKingWenceslas.mid` | [Mutopia #905](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=905), typeset by James Kilfiger | Public Domain (Mutopia) | SATB on 2 tracks |
| The Holly and the Ivy (English trad.) | `sources/mutopia/thehollyandtheivy.mid` | [Mutopia #644](https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=644), typeset by Geoffrey Lehr | Public Domain (Mutopia) | melody only |

Notes:
- **Self-encoded files** are written in [ABC notation](https://abcnotation.com/wiki/abc:standard:v2.1)
  from the traditional public-domain tunes, not copied from any edition; chord symbols were
  written by the encoder. They were encoded from memory by the agent: **a human should
  proofread them** against a PD hymnal before release (most likely spots: Joy to the World bars
  9–12 rhythm, Jingle Bells verse bars 9–12).
- **Mutopia** (license page checked 2026-10-22): every piece is CC BY-SA, CC BY, or Public
  Domain *per piece*. I only took pieces marked Public Domain (confirmed in each `.ly` header:
  `copyright = "Public Domain"`), so derived charts carry no ShareAlike/attribution obligation;
  attribution is still recorded. Mutopia's holiday catalogue is small (a search for "carol" /
  "christmas" returned 6 pieces).
- Not used (not re-verified this session — check per file before use): **CPDL** (own "CPDL
  license", per-edition), **IMSLP** (PD status varies by country; typeset editions often
  CC BY-SA/NC), **hymnary.org / cyberhymnal** MIDI (no clear file license). Recommendation:
  for MVP, keep self-encoding lead sheets (fast: ~5 min per carol in ABC) and add Mutopia
  PD/CC BY files; avoid ShareAlike/NC sources for charts we ship.

## Assignment algorithm

Pipeline (all in [`src/`](../../spikes/s5-chart-pipeline/src)):

1. **Import** ABC (lead sheets), Standard MIDI (type 0/1) or MusicXML (partwise subset, incl.
   `<harmony>` chord symbols) into one score model (ticks @480 PPQ, tempo map, meter, bar lines
   incl. pickups).
2. **Roles.** Melody = top line of the highest voice (a note is melody if no other note in that
   voice sounds higher at its onset — extracts the soprano from an S+A staff); bass = bottom line
   of the lowest voice; the rest = inner. Duplicate unisons collapse to one strike.
   **Lead sheets** (one voice + chord symbols) are *realized*: bass = chord root in a 12-semitone
   window 19–8 semitones under the lowest melody note; harmony = 3rd + 5th (or 7th) just under
   the melody, never at/above the sounding melody note; both struck at chord changes and strong
   beats. This keeps every arrangement within (melody span + 19) semitones → all 8 carols fit a
   **3-octave set** (C4–C7 written) after transposition (Holly: 2 octaves).
3. **Difficulty tiers.** easy = melody only; medium = melody + bass on strong beats (beat 1, plus
   beat 3 in 4/4, mid-bar pulse in 6/8; at least one bass note per bar); hard = everything.
4. **Bell set & ringers.** Handbell convention: each ringer covers *adjacent naturals plus their
   accidentals*, an accidental travelling with the natural a semitone below (C♯ with C, B♭=A♯
   with A). So an assignment is a **partition of the sorted natural "slots" into K contiguous
   groups**, solved exactly by dynamic programming (O(K·n²) group costs, n ≈ 8–25 slots). Group
   cost (additive, so DP is exact):
   - load balance `(strikes − ideal)² / ideal`, doubled when under-loaded (bored player);
   - playability violations ×10 per instance, simulated per ringer against a **controller
     profile**: simultaneous strikes > `maxSimultaneous`; same-bell repeat < `minRepeatSec`;
     bell-to-bell switch < `minSwitchSec`; picking up a bell not in hand (LRU of `inHand` bells)
     < `swapSec`;
   - swaps ×0.3; bells over `maxBells` ×60.
5. **Repair.** Non-melody notes that cause violations are dropped (inner first, then bass);
   reassign; repeat once. **Melody is never dropped** — remaining violations are reported.

Profiles (thresholds are **assumptions** for S1/playtests to calibrate):

| Profile | Models | maxBells | maxSimul | minRepeat | minSwitch | swap |
|---|---|---|---|---|---|---|
| `handbell` | real bells, two-in-hand + table pickups | 6 | 2 | 0.18 s | 0 | 0.4 s |
| `phone-4zone` | 1 phone, ≤4 bells as on-screen zones, one strike at a time | 4 | 1 | 0.2 s | 0.2 s | n/a |
| `phone-pair` | 2 phones per person (one bell per hand) | 2 | 2 | 0.18 s | 0 | n/a |
| `phone-2zone` | 1 phone, 2 bells (zone/tilt select) | 2 | 1 | 0.2 s | 0.2 s | n/a |
| `phone-1` | 1 phone = 1 bell | 1 | 1 | 0.2 s | ∞ | n/a |

**Results — "clean" songs out of 8** (no remaining violations, within bell capacity):

| Profile | Ringers | Easy | Medium | Hard |
|---|---|---|---|---|
| handbell | 3 | 2 | 1 | 0 |
| handbell | **4** | **5** | 3 | 2 |
| handbell | 5 | 7 | 5 | 2 |
| phone-4zone | 3 | 6 | 2 | 2 |
| phone-4zone | **4** | **6** | **6** | 1 |
| phone-4zone | 5 | 7 | 6 | 3 |
| phone-pair | 4 | 4 | 1 | 1 |
| phone-2zone | 4 | 3 | 1 | 1 |
| phone-1 | 3–5 | 0 | 0 | 0 |

Observations:
- **4 ringers is the sweet spot** for carols; 3 ringers makes easy tiers already need 4–5 bells
  each with fast swaps; 5 ringers is clean on easy for 7/8 songs.
- **Remaining hard-tier violations are melody→melody bell swaps on the top ringer**: once
  lower ringers carry bass/harmony, contiguity pushes the whole melody (5–6 bells) onto one
  person. Real ringers solve this with four-in-hand/weaving; a game could relax contiguity on
  hard (split the melody), or the ringer gets a "solo" lane. Worth a playtest.
- **Melody-only tiers have inherently uneven load** (pitch histograms are peaked): max/min
  strikes 1.0–3× typical, worst 7.7× (Deck the Halls, 5 ringers: one ringer gets 3 notes).
  Fixes for later: allow non-contiguous pairing of a rare high bell with a busy one on easy, or
  fewer active ringers on easy.
- Results are sensitive to `swapSec`: at 0.6 s instead of 0.4 s, Good King Wenceslas hard (4
  ringers) went from 0 to 10 violations and 56 dropped notes. S1 must measure real switch times.
- Hard tiers drop 0–7 % of notes for playability on the lead sheets and Good King Wenceslas, but
  13–26 % on the SATB hymn It Came Upon the Midnight Clear (4 ringers: 53 of 250) — four voices
  cluster in the middle of the range, so one ringer often needs 3+ simultaneous bells.
- Speed: whole corpus (8 songs × 3 ringer counts × 3 tiers, plus 5-profile sweep) builds in
  ~3.5 s; one chart in 34–211 ms.

## Sample charts

- JSON charts: [`spikes/s5-chart-pipeline/charts/`](../../spikes/s5-chart-pipeline/charts) — 8
  songs × {3, 4, 5} ringers × {easy, medium, hard}, profile `handbell`.
- Lane previews (first 4 bars, easy + hard, 4 ringers): [`results/previews.md`](../../spikes/s5-chart-pipeline/results/previews.md).
- Listenable General MIDI files per tier (one Tubular Bells track per ringer):
  `exports/<song>/audition-{easy,medium,hard}-r4.mid` — open in any MIDI player or MuseScore.

Jingle Bells, hard, 4 ringers (M melody, B bass, h harmony; one row per eighth note):

```
bar  | R1:  G2  A2  C3  D3 | R2:  G3  A3  B3  C4 C#4 | R3:  D4  E4 F#4  G4 | R4:  A4  B4  C5  D5  E5
  1  |       B   -   -   - |       -   -   h   -   - |       h   -   -   - |       -   -   -   M   -
     |       .   .   .   . |       .   .   .   .   . |       .   .   .   . |       .   .   .   .   .
     |       .   .   .   . |       .   .   .   .   . |       .   .   .   . |       .   M   .   .   .
     |       .   .   .   . |       .   .   .   .   . |       .   .   .   . |       .   .   .   .   .
     |       B   .   .   . |       .   .   h   .   . |       h   .   .   . |       M   .   .   .   .
     |       .   .   .   . |       .   .   .   .   . |       .   .   .   . |       .   .   .   .   .
     |       .   .   .   . |       .   .   .   .   . |       .   .   .   M |       .   .   .   .   .
     |       .   .   .   . |       .   .   .   .   . |       .   .   .   . |       .   .   .   .   .
  2  |       B   -   -   - |       -   -   h   -   - |       M   -   -   - |       -   -   -   -   -
```

| Song (4 ringers) | Easy assignment | Strikes (e/m/h) | Remaining violations (e/m/h) |
|---|---|---|---|
| Jingle Bells | D4–G4 · A4 · B4 · C5–E5 | 97 / 161 / 277 | 0 / 0 / 3 |
| Joy to the World | D4–E4 · F4–G4 · A4–B4 · C5–D5 | 56 / 74 / 116 | 0 / 1 / 10 |
| Silent Night | C4–E4 · F4–G4 · A4–B4 · C5–F5 | 46 / 70 / 112 | 2 / 2 / 4 |
| Deck the Halls | E4–F4 · G4 · A4 · C5–F5 | 68 / 100 / 189 | 2 / 2 / 12 |
| We Wish You a Merry Christmas | D4 · E4–F4 · G4–A4 · B4–D5 | 52 / 68 / 100 | 0 / 2 / 6 |
| It Came Upon the Midnight Clear | D4–F4 · G4 · A4 · C5–D5 | 71 / 104 / 197 | 2 / 4 / 23 |
| Good King Wenceslas | E4 · F4–G4 · A4 · B4–E5 | 53 / 86 / 206 | 0 / 0 / 0 |
| The Holly and the Ivy | C4–D4 · F4–G4 · A4 · C5–D5 | 59 (all tiers) | 0 |

(Labels are natural slots; each includes its sharps, e.g. "D4–G4" = D4 E4 F♯4 G4.)

## Proposed format (+ schema)

**Engine-neutral JSON**, one file per song, schema
[`schema/chart.schema.json`](../../spikes/s5-chart-pipeline/schema/chart.schema.json)
(JSON Schema 2020-12; every committed chart is validated in the test suite). Drafted as
[ADR-0007 (Proposed)](../decisions/0007-chart-format.md).

```jsonc
{
  "format": "handbell-hero.chart", "formatVersion": "0.1.0",
  "song":   { "id", "title", "composer", "year", "key",
              "license": { "id": "CC0-1.0", "url" }, "source": { "kind", "file", "url", "attribution" } },
  "timing": { "resolution": 480, "tempos": [{ "tick", "time", "bpm" }],
              "timeSignatures": [{ "tick", "numerator", "denominator" }],
              "measures": [{ "number", "tick", "time", "pickup" }], "endTick", "durationSec" },
  "bells":  [{ "id": "G4", "midi": 67, "natural": true }],          // written pitch
  "handbellSet": { "set": "3oct", "transposeSemitones": 17 },
  "parts": [{
    "difficulty": "easy", "ringerCount": 4, "profile": "handbell",
    "ringers": [{ "index": 0, "label": "D4–G4", "bells": ["D4","E4","F#4","G4"], "stats": {…} }],
    "notes":   [{ "tick": 0, "time": 0, "dur": 480, "durSec": 0.5, "bell": "D5", "ringer": 3, "role": "melody" }],
    "metrics": {…}
  }]
}
```

Design choices:
- **Both ticks and seconds.** Ticks are exact (editing, MIDI export); seconds are pre-computed
  from the tempo map so a host (TypeScript, C#, Unity, …) needs no tempo math to play.
- **Bells are first-class** (not lanes): lanes are a per-ringer view (`ringers[].bells` order).
  This survives re-assignment, different ringer counts, and maps directly to HGP bell
  assignment messages.
- **Parts = difficulty × ringer count × profile**: the host picks the part matching the room
  (players, controllers). Bell→ringer mapping differs per part on purpose.
- `role` enables scoring/visual emphasis (melody) and later "practice melody only".
  `technique` is reserved for the HGP gesture vocabulary (damp, LV, shake, martellato…).
- License/provenance travel inside every chart.
- Readers must ignore unknown fields; `formatVersion` is semver.
- Size: 65–164 KB per song with all 9 parts (one note per line). Compact enough; could gzip or
  drop `durSec` later.

## Mapping to YARG/CH formats

Implemented: [`src/export.mjs`](../../spikes/s5-chart-pipeline/src/export.mjs) writes a Clone
Hero/YARG song folder per carol (`exports/<song>/notes.mid` + `song.ini`), following the
community spec [GuitarGame_ChartFormats](https://github.com/TheNathannator/GuitarGame_ChartFormats)
(CC0-1.0; 5-Fret Guitar, Beats, Pro Keys pages read 2026-10-23):

- **One ringer = one 5-lane instrument track**: `PART GUITAR`, `PART BASS`, `PART RHYTHM`,
  `PART KEYS`, `PART GUITAR COOP` (max 5 ringers). Lanes = that ringer's bells low→high
  (G R Y B O). Our tiers → Easy (notes 60–64), Medium (72–76), Hard (84–88); Expert (96–100)
  duplicates Hard. Notes are 60 ticks long (no sustains). `BEAT` track (12 = bar, 13 = beat),
  `EVENTS` with `[music_start]`/`[end]`, tempo map + time signatures on track 0.
- Ringers with > 5 bells (handbell profile allows 6) get adjacent lanes merged (8 such cases
  across the corpus, reported as warnings) — a `maxBells: 5` profile would avoid it.
- Verified: all 8 `notes.mid` parse with our reader and with `midi-file`; note numbers stay in
  GH ranges (test). **Not verified in YARG/Clone Hero** (not installed here): both need an audio
  stem (`song.ogg`); a bell-synth render step would close that gap.

Evaluation:
- **Export (ours → CH/YARG): cheap and useful.** It lets anyone play-test our charts today on
  YARG with keyboards/guitar controllers, and YARG's local multiplayer (up to 32) matches
  "one track per ringer". Lane meaning is lost (lanes are relative to each ringer's bells).
- **Pro Keys** (`PART REAL_KEYS_*`) would keep real pitches but is one player, a 25-key window
  (C1–C3 + range shifts) and ≤ 4 simultaneous notes; our full arrangements span 29–36 semitones, so
  this suits "one person plays the whole carol" rather than a bell choir.
- **Import (CH/YARG → ours, M9 / owner's option C):** feasible with the same MIDI reader:
  take a `PART KEYS`/`PART REAL_KEYS_X` or a vocals melody track as pitched input and run the
  same role/assignment pipeline. Guitar/drum tracks carry no pitch, so they cannot become bell
  parts. Community charts' music is typically copyrighted; only PD/our own songs qualify.
- Recommendation: keep **our JSON as the source of truth**; treat CH/YARG `.mid` as an export
  target (and a reference importer later). If the host engine becomes a YARG fork (S2/S3), the
  YARG-side handbell instrument should read our JSON or a `PART HANDBELL` track generated from it.

## What a phone covering 2 bells would require

Data (4 ringers): easy-tier melodies use **8–11 distinct pitches**. `phone-1` (one bell per
phone) is infeasible for every song at 3–5 ringers. `phone-2zone` / `phone-pair` exceed bell
capacity on 4 of 8 easy tiers and 7 of 8 medium/hard tiers. `phone-4zone` is clean on 6/8 easy
and 6/8 medium. So "2 bells per phone" is the *minimum*, and only with pitch-set reduction;
**3–4 bells per phone** fits carols for a family of 4.

Requirements:
1. **Bell selection on the device**, decided at strike time and sent in the event: options to
   test in S1 — touch zone held during the stroke (most reliable, works on iOS/Android), stroke
   direction or roll/tilt angle (no screen needed, harder to detect), or two phones per person
   (`phone-pair`: natural for "two-in-hand", but doubles devices and battery/permission setup).
2. **HGP v0 fields:** device capability `maxBells`, `maxSimultaneous` (1 for a single phone
   unless a "both bells" gesture exists), `selector` (`touch-zone` | `tilt` | `direction`);
   host→device **assignment of an ordered bell list** with colors/labels per bell; ring events
   carry `bell` (+ source timestamp). Judging should distinguish *wrong bell, right time* from a
   miss (kinder scoring for kids).
3. **Chart side:** parts must be generated *for the controller profile* (`profile` field); key
   constraints are one strike at a time and a minimum bell-switch time (`minSwitchSec`, assumed
   0.2 s). The pipeline already does this; S1 should measure real switch and re-strike times.
4. **Pitch-set reduction** when bells > capacity: fold rare accidentals/passing tones, transpose
   or simplify the melody on easy. Not implemented (the pipeline reports "over capacity").
5. **UI:** each zone shows the bell's note name and color matching the highway lane.

## Limitations and follow-ups

- Melody encodings need a human proofread; lead-sheet harmony is simple (root bass, 3rd/5th
  pads) and occasionally clashes with passing tones — fine for a game, not for publication.
- No repeat/ending expansion in ABC/MusicXML importers; MusicXML `.mxl` (zip) not supported.
- Playability thresholds are assumptions (see profiles); no device or ringer measurements.
- Easy-tier fairness and hard-tier melody concentration are the main quality issues (above).
- Next steps (M2/M3): accept/adjust ADR-0007; pick the MVP controller profile with S1 data;
  add a bell-synth audio render (E05) so CH/YARG exports and the host can play backing tracks;
  add 2–4 more carols (e.g. O Come All Ye Faithful, Hark! The Herald Angels Sing, The First
  Noel) from PD sources or self-encoded; consider a small web chart viewer for proofreading.
- No upstream issues/PRs drafted; none needed for this spike.
