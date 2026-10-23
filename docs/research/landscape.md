# Landscape (initial, 2026-10-22)

Licenses checked via the GitHub API on 2026-10-22 unless noted. Spikes should deepen this.

## Open-source rhythm games ("Guitar Hero–like")

| Project | Tech | License | Notes for us |
|---|---|---|---|
| [YARG](https://github.com/YARC-Official/YARG) | Unity 6, C# | LGPL-3.0 | Most active, closest to commercial GH/RB feel. Guitar, drums, keys, vocals. Audio via **BASS** (proprietary, un4seen; free for non-commercial). No browser build. Desktop (Win/macOS/Linux). S3: Unity `6000.3.5f2`; Win x64, macOS, Linux x86_64 only ([report](../spikes/S3-report.md)). |
| [YARG.Core](https://github.com/YARC-Official/YARG.Core) | .NET library | LGPL-3.0 | Engine-agnostic chart parsing, scoring engines, replays. Candidate shared core; browser-WASM feasibility is spike S2. |
| [osu!](https://github.com/ppy/osu) / [osu-framework](https://github.com/ppy/osu-framework) | C#/.NET | MIT code (assets/resources separately licensed) | Very polished; official **custom ruleset** extension point (osu!mania is a lane game). Desktop + iOS/Android; no browser; also uses BASS. Visual identity is osu!, not GH. |
| Clone Hero | Unity | Closed freeware | Not forkable. Its community chart formats (`.chart`, RB-style `.mid`, `.sng`) are de-facto standards that YARG also reads. |
| [Performous](https://github.com/performous/performous) | C++ | GPL (per README) | Karaoke + guitar + drums + dance; active; dated visuals. |
| Frets on Fire / FoFiX | Python | GPL-2.0+ | Historical; low maintenance. |
| Rhythm Plus | Web (Vue) | verify | Browser lane game; reference for web feasibility. |
| StepMania / Project OutFox | C++ | MIT / mixed | Dance-pad lineage; flexible input. |

Takeaways:
- No open-source project runs a GH-quality game **in the browser** today. Both leading
  .NET games depend on native BASS audio.
- YARG.Core being a separate .NET library makes "YARG fork now, web later" testable.

## Handbell-specific software and hardware

| Item | What it is | Relevance |
|---|---|---|
| [Handbell Manager](https://handbellmanager.changeringing.co.uk/) / [GACJ/handbellmanager](https://github.com/GACJ/handbellmanager) (GPL-3.0, last push 2021) | Up to four USB motion controllers as dummy handbells for the Abel/Beltower change-ringing simulators | Prior art for **strike detection from motion sensors**. GPL-3.0: study the approach, do not copy code into this MIT repo |
| [GACJ/handbellSTLs](https://github.com/GACJ/handbellSTLs) (no license asserted) | STLs for 3D-printing eBells | Ergonomics ideas for phone/bell holders; ask before reuse |
| [eBells](https://ebells.co.uk/background.html) | DIY electronic handbells (wired) | Closest DIY analogue to digital-handbell |
| [Handbell Stadium](https://handbellstadium.org/) | Handbell education/community resource | Pedagogy, repertoire, possible partner |
| [handbellringing.co.uk](https://www.handbellringing.co.uk/) | Change-ringing handbell resources | Community |
| [Noisefirm handbell choir samples](https://noisefirm.com/product/handbell-choir-samples/) | Commercial sample library | **Not redistributable** in an MIT game; reference only |
| YouTube references ([1](https://www.youtube.com/watch?v=YgMFz7MDAJs), [2](https://www.youtube.com/watch?v=YBHNDsy3X0I), [3](https://www.youtube.com/watch?v=MYk857Nckuc), [Handbell Manager demo](https://www.youtube.com/watch?v=Ik8fSZILYCk)), [RightNow Media session](https://app.rightnowmedia.org/en/content/details/105417?session=105417) | Owner-collected examples | None combine high-fidelity game visuals with wireless physical bells |

## Our own related repos

- [dcuccia/digital-handbell](https://github.com/dcuccia/digital-handbell) (MIT): motion-
  triggered electronic handbell. Current board is RP2040-class and standalone; an ESP32-S3
  (Wi-Fi/BLE) variant is planned and is the networked target for HGP.
- [dcuccia/stripe-m2-pos](https://github.com/dcuccia/stripe-m2-pos): React Native/Expo
  mobile app + .NET Aspire/Azure Functions backend — a reference for mobile packaging if a
  native controller app is ever needed (not web-first).
- [dcuccia/Avalonia.Controls.WebView](https://github.com/dcuccia/Avalonia.Controls.WebView):
  relevant if a cross-platform .NET (Avalonia) shell hosts a web renderer.

## Handbell technique vocabulary (for the gesture protocol)

Ring (strike), damp, let vibrate (LV), shake/trill, martellato (strike on padded table),
martellato-lift, pluck, thumb damp, echo, swing, gyro, mallet. Ringers commonly cover two
or more bells ("two-in-hand", "four-in-hand"), which matters when a phone represents
several bells.
