<!-- Generated from attribution/register.json by tools/licensing/attribution.mjs. Do not edit by hand:
     edit the register (and REUSE.toml), then run `node tools/licensing/attribution.mjs`. -->

# Attribution and licensing

Go Go HarmoniYo is an independent open-source project. It gratefully
builds on public-domain music, the volunteers of the [Mutopia Project](https://www.mutopiaproject.org),
and the open-source libraries listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Crediting a
person, project or game does **not** imply their endorsement, and Go Go HarmoniYo is not affiliated with, endorsed
by, or sponsored by the makers of any game it mentions as inspiration. All trademarks belong to
their owners.

The policy is [ADR-0008](docs/decisions/0008-assets-ip-and-attribution.md). Every file's license
is machine-readable ([REUSE](https://reuse.software): `REUSE.toml` and `LICENSES/`), and every
non-code asset has an entry in the [asset register](attribution/register.json). This file is
project provenance practice, not legal advice.

## License boundaries

| Material | License |
|---|---|
| Code, docs, configs, test data (default) | [MIT](LICENSE) |
| Original human-made art, audio, models and charts | [CC BY 4.0](LICENSES/CC-BY-4.0.txt) |
| AI-generated assets (copyright may not attach) | [CC0 1.0](LICENSES/CC0-1.0.txt) |
| Third-party assets | Their own license, recorded per file below and in `REUSE.toml` |
| Explicit ADR exceptions | Listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md#exceptions-to-the-license-allowlist), e.g. the LGPL-3.0-or-later S2 patch file |
| YARG / YARG.Core (LGPL-3.0-or-later) | **Not in this repository.** The spikes fetch them into gitignored folders; the YARG fork is a separate repository |

The root MIT license does not override these per-file licenses. Don't relabel the whole
repository "MIT" in a way that hides them.

## Credits

- Jingle Bells by James Lord Pierpont (1857), public domain. Lead sheet encoded for Go Go HarmoniYo (CC0). License: CC0 1.0 Universal (public domain dedication).
- Joy to the World, tune ANTIOCH as arranged by Lowell Mason (1839), public domain. Lead sheet encoded for Go Go HarmoniYo (CC0). License: CC0 1.0 Universal (public domain dedication).
- Silent Night by Franz Xaver Gruber (1818), public domain. Lead sheet encoded for Go Go HarmoniYo (CC0). License: CC0 1.0 Universal (public domain dedication).
- Deck the Halls, traditional Welsh melody 'Nos Galan', public domain. Lead sheet encoded for Go Go HarmoniYo (CC0). License: CC0 1.0 Universal (public domain dedication).
- We Wish You a Merry Christmas, traditional English melody, public domain. Lead sheet encoded for Go Go HarmoniYo (CC0). License: CC0 1.0 Universal (public domain dedication).
- It Came Upon the Midnight Clear (tune CAROL) by Richard Storrs Willis (1850). Typeset by Steve Dunlop for the Mutopia Project (Mutopia-2008/01/13-1231), public domain. License: Public domain (Mutopia Project dedication).
- Good King Wenceslas, melody from Piae Cantiones (1582), words by J. M. Neale (1853). Typeset by James Kilfiger for the Mutopia Project (Mutopia-2007/01/10-905) from C. L. Hutchins, Carols Old and Carols New (1916), public domain. License: Public domain (Mutopia Project dedication).
- The Holly and the Ivy, traditional English. Typeset by Geoffrey Lehr for the Mutopia Project (Mutopia-2005/12/23-644), public domain. License: Public domain (Mutopia Project dedication).
- Fredoka by Milena Brandão, Hafontia. Copyright 2016 The Fredoka Project Authors (https://github.com/hafontia/Fredoka-One). Licensed under the SIL Open Font License 1.1. License: SIL Open Font License 1.1.
- Outfit by Smartsheet Inc, Rodrigo Fuenzalida. Copyright 2021 The Outfit Project Authors (https://github.com/Outfitio/Outfit-Fonts). Licensed under the SIL Open Font License 1.1. License: SIL Open Font License 1.1.
- Sniglet ExtraBold by Haley Fiege, Brenda Gallo, Pablo Impallari. Copyright (c) 2008, Haley Fiege (haley@kingdomofawesome.com), Copyright (c) 2012, Brenda Gallo (gbrenda1987@gmail.com), Copyright (c) 2013, Pablo Impallari (www.impallari.com|impallari@gmail.com). Licensed under the SIL Open Font License 1.1. License: SIL Open Font License 1.1.
- Nunito by Vernon Adams, Cyreal, Jacques Le Bailly. Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito). Licensed under the SIL Open Font License 1.1. License: SIL Open Font License 1.1.
- Lilita One by Juan Montoreano. Copyright (c) 2011 Juan Montoreano (juan@remolacha.biz), with Reserved Font Name Lilita. Licensed under the SIL Open Font License 1.1. License: SIL Open Font License 1.1.
- Grandstander by Tyler Finck, ETC (Etcetera Type Co). Copyright 2020 The Grandstander Project Authors (https://github.com/Etcetera-Type-Co/Grandstander). Licensed under the SIL Open Font License 1.1. License: SIL Open Font License 1.1.

## Asset inventory

| Asset | Origin | License | Files | Review |
|---|---|---|---|---|
| [Screenshots and captures of the project's own UI (S1, S4, I1, I2 reports)](#project-ui-captures) | original | CC-BY-4.0 | 11 | approved (legacy) |
| [Pitch-class palette swatch sheet with colour-vision simulations (visual identity doc)](#pitch-class-palette-sheet) | original | CC-BY-4.0 | 1 | pending |
| [Jingle Bells (lead sheet, ABC)](#s5-jingle-bells-abc) | ai-generated | CC0-1.0 | 1 | pending (legacy) |
| [Joy to the World (lead sheet, ABC)](#s5-joy-to-the-world-abc) | ai-generated | CC0-1.0 | 1 | pending (legacy) |
| [Silent Night (lead sheet, ABC)](#s5-silent-night-abc) | ai-generated | CC0-1.0 | 1 | pending (legacy) |
| [Deck the Halls (lead sheet, ABC)](#s5-deck-the-halls-abc) | ai-generated | CC0-1.0 | 1 | pending (legacy) |
| [We Wish You a Merry Christmas (lead sheet, ABC)](#s5-we-wish-you-a-merry-christmas-abc) | ai-generated | CC0-1.0 | 1 | pending (legacy) |
| [S5 MusicXML importer test fixture](#s5-musicxml-test-fixture) | ai-generated | CC0-1.0 | 1 | pending (legacy) |
| [Carol (hymn tune for 'It Came Upon the Midnight Clear'), Mutopia edition](#mutopia-carol) | third-party | LicenseRef-Mutopia-PublicDomain | 2 | approved |
| [Good King Wenceslas, Mutopia edition](#mutopia-good-king-wenceslas) | third-party | LicenseRef-Mutopia-PublicDomain | 2 | approved |
| [The Holly and the Ivy, Mutopia edition](#mutopia-the-holly-and-the-ivy) | third-party | LicenseRef-Mutopia-PublicDomain | 2 | approved |
| [S5 handbell charts and Clone Hero/YARG exports generated from the CC0 lead sheets](#s5-charts-from-cc0-lead-sheets) | derived | CC0-1.0 | 30 | approved (legacy) |
| [S5 charts and exports for 'It Came Upon the Midnight Clear'](#s5-charts-carol) | derived | LicenseRef-Mutopia-PublicDomain | 6 | approved (legacy) |
| [S5 charts and exports for 'Good King Wenceslas'](#s5-charts-good-king-wenceslas) | derived | LicenseRef-Mutopia-PublicDomain | 6 | approved (legacy) |
| [S5 charts and exports for 'The Holly and the Ivy'](#s5-charts-the-holly-and-the-ivy) | derived | LicenseRef-Mutopia-PublicDomain | 6 | approved (legacy) |
| [Fredoka font (SIL OFL 1.1), used to set brand-option wordmarks](#font-fredoka) | third-party | OFL-1.1 | 2 | pending |
| [Outfit font (SIL OFL 1.1), used to set brand-option wordmarks](#font-outfit) | third-party | OFL-1.1 | 2 | pending |
| [Sniglet ExtraBold font (SIL OFL 1.1), used to set brand-option wordmarks](#font-sniglet) | third-party | OFL-1.1 | 2 | pending |
| [Nunito font (SIL OFL 1.1), used to set brand-option wordmarks](#font-nunito) | third-party | OFL-1.1 | 2 | pending |
| [Lilita One font (SIL OFL 1.1), used to set brand-option wordmarks](#font-lilitaone) | third-party | OFL-1.1 | 2 | pending |
| [Grandstander font (SIL OFL 1.1), used to set brand-option wordmarks](#font-grandstander) | third-party | OFL-1.1 | 2 | pending |
| [Brand option 1, Ring Burst: wordmarks, mark, app icon, favicon, mascot sketch and preview board](#brand-option-1-ring-burst) | derived | CC-BY-4.0 | 16 | pending |
| [Brand option 2, Resonance: wordmarks, mark, app icon, favicon, mascot sketch and preview board](#brand-option-2-resonance) | derived | CC-BY-4.0 | 12 | pending |
| [Brand option 3, Triad: wordmarks, mark, app icon, favicon, mascot sketch and preview board](#brand-option-3-triad) | derived | CC-BY-4.0 | 16 | pending |
| [Brand option 4, Pitch Wheel: wordmarks, mark, app icon, favicon, mascot sketch and preview board](#brand-option-4-pitch-wheel) | derived | CC-BY-4.0 | 12 | pending |
| [Brand option 5, Bell Tag: wordmarks, mark, app icon, favicon, mascot sketch and preview board](#brand-option-5-bell-tag) | derived | CC-BY-4.0 | 16 | pending |
| [Brand option 6, Sing-Along: wordmarks, mark, app icon, favicon, mascot sketch and preview board](#brand-option-6-sing-along) | derived | CC-BY-4.0 | 16 | pending |
| [Brand options: side-by-side overview sheets (wordmarks, icons, mascots)](#brand-options-overviews) | derived | CC-BY-4.0 | 3 | pending |

### project-ui-captures

**Screenshots and captures of the project's own UI (S1, S4, I1, I2 reports)**

- Files: `docs/spikes/media/*`, `docs/spikes/I1-data/*.png`, `spikes/s1-phone-bell/results/*.png` (11 file(s))
- Origin: original
- Authors: David Cuccia and Go Go HarmoniYo contributors
- Copyright: 2026 David Cuccia and Go Go HarmoniYo contributors
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (`CC-BY-4.0`)
- Modifications: none
- Review: approved by @dcuccia (owner confirmed CC BY 4.0 for screenshots of our own UI) on 2026-10-23. IP audit 2026-10-23: captured by the spikes' Playwright scripts (or by hand) from the project's own procedural UI; no third-party art, logos or fonts embedded (system UI fonts only). The S4/I1/I2 captures showed green/red/yellow/blue/orange lanes close to Guitar Hero's fret colours (issue #12). 2026-10-23, #12: s4-autoplay.gif, s4-ultra-4k.png, s4-low-1080p.png, i2-4-ringers-play.png, i2-4-ringers-lobby.png, i2-2-phones-plus-host-play.png and i2-phone-controller.png re-captured with the pitch-class palette (same scripts: s4-web-host/scripts/bench.mjs + capture-gif.mjs, i2-web-phones/scripts/e2e.mjs --shots + controller-check.mjs --shots). I1-data/controller-yarg-lanes.png keeps YARG's lane colours (ADR-0008 interop exception); spikes/s1-phone-bell/results/zones-pixel-viewport.png predates #12 (S1 hue-wheel colours, not a fret order; hand capture on a phone). 2026-10-24, seating chart: i2-seating-lobby.png (TV lobby) and i2-phone-part-picker.png (S1 phone page, Pick your part) added under the same CC BY 4.0 decision for screenshots of our own UI, captured by spikes/i2-web-phones/scripts/seating-e2e.mjs --shots (pitch-class palette, system fonts and emoji only).
- Legacy: added before ADR-0008; gaps are listed under "Open items".

### pitch-class-palette-sheet

**Pitch-class palette swatch sheet with colour-vision simulations (visual identity doc)**

- Files: `docs/design/media/pitch-class-palette-cvd.png` (1 file(s))
- Origin: original
- Authors: David Cuccia and Go Go HarmoniYo contributors
- Copyright: 2026 David Cuccia and Go Go HarmoniYo contributors
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (`CC-BY-4.0`)
- Modifications: none
- Review: pending. Rendered by tools/design/palette-check.mjs --sheet (headless Chrome) from docs/design/pitch-class-palette.json: coloured circles with note names, system UI font, no third-party content. Owner to confirm CC BY 4.0 like the UI captures (#12).

### s5-jingle-bells-abc

**Jingle Bells (lead sheet, ABC)**

- Files: `spikes/s5-chart-pipeline/songs/jingle-bells.abc` (1 file(s))
- Origin: ai-generated
- Authors: James Lord Pierpont (melody, 1857, public domain); Go Go HarmoniYo S5 agent session (encoding and chord symbols)
- Copyright: Melody public domain; encoding 2026 Go Go HarmoniYo contributors, dedicated to the public domain
- License: [CC0 1.0 Universal (public domain dedication)](https://creativecommons.org/publicdomain/zero/1.0/) (`CC0-1.0`)
- Modifications: Encoded from the traditional tune; chord symbols added by the encoder.
- AI provenance: GitHub Copilot coding agent; model unrecorded (unrecorded); terms <https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot> (unrecorded); prompt: unrecorded (pre-ADR-0008); task brief: S5 in docs/spikes/README.md; resemblance review: pending, pending
- Review: pending. Proofread against a public-domain edition (S5 report).
- Legacy: added before ADR-0008; gaps are listed under "Open items".

### s5-joy-to-the-world-abc

**Joy to the World (lead sheet, ABC)**

- Files: `spikes/s5-chart-pipeline/songs/joy-to-the-world.abc` (1 file(s))
- Origin: ai-generated
- Authors: Lowell Mason (tune ANTIOCH, 1839, public domain); Go Go HarmoniYo S5 agent session (encoding and chord symbols)
- Copyright: Melody public domain; encoding 2026 Go Go HarmoniYo contributors, dedicated to the public domain
- License: [CC0 1.0 Universal (public domain dedication)](https://creativecommons.org/publicdomain/zero/1.0/) (`CC0-1.0`)
- Modifications: Encoded from the traditional tune; chord symbols added by the encoder.
- AI provenance: GitHub Copilot coding agent; model unrecorded (unrecorded); terms <https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot> (unrecorded); prompt: unrecorded (pre-ADR-0008); task brief: S5 in docs/spikes/README.md; resemblance review: pending, pending
- Review: pending. Proofread against a public-domain edition (S5 report).
- Legacy: added before ADR-0008; gaps are listed under "Open items".

### s5-silent-night-abc

**Silent Night (lead sheet, ABC)**

- Files: `spikes/s5-chart-pipeline/songs/silent-night.abc` (1 file(s))
- Origin: ai-generated
- Authors: Franz Xaver Gruber (melody, 1818, public domain); Go Go HarmoniYo S5 agent session (encoding and chord symbols)
- Copyright: Melody public domain; encoding 2026 Go Go HarmoniYo contributors, dedicated to the public domain
- License: [CC0 1.0 Universal (public domain dedication)](https://creativecommons.org/publicdomain/zero/1.0/) (`CC0-1.0`)
- Modifications: Encoded from the traditional tune; chord symbols added by the encoder.
- AI provenance: GitHub Copilot coding agent; model unrecorded (unrecorded); terms <https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot> (unrecorded); prompt: unrecorded (pre-ADR-0008); task brief: S5 in docs/spikes/README.md; resemblance review: pending, pending
- Review: pending. Proofread against a public-domain edition (S5 report).
- Legacy: added before ADR-0008; gaps are listed under "Open items".

### s5-deck-the-halls-abc

**Deck the Halls (lead sheet, ABC)**

- Files: `spikes/s5-chart-pipeline/songs/deck-the-halls.abc` (1 file(s))
- Origin: ai-generated
- Authors: Traditional Welsh (melody 'Nos Galan', public domain); Go Go HarmoniYo S5 agent session (encoding and chord symbols)
- Copyright: Melody public domain; encoding 2026 Go Go HarmoniYo contributors, dedicated to the public domain
- License: [CC0 1.0 Universal (public domain dedication)](https://creativecommons.org/publicdomain/zero/1.0/) (`CC0-1.0`)
- Modifications: Encoded from the traditional tune; chord symbols added by the encoder.
- AI provenance: GitHub Copilot coding agent; model unrecorded (unrecorded); terms <https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot> (unrecorded); prompt: unrecorded (pre-ADR-0008); task brief: S5 in docs/spikes/README.md; resemblance review: pending, pending
- Review: pending. Proofread against a public-domain edition (S5 report).
- Legacy: added before ADR-0008; gaps are listed under "Open items".

### s5-we-wish-you-a-merry-christmas-abc

**We Wish You a Merry Christmas (lead sheet, ABC)**

- Files: `spikes/s5-chart-pipeline/songs/we-wish-you-a-merry-christmas.abc` (1 file(s))
- Origin: ai-generated
- Authors: Traditional English, West Country (melody, public domain); Go Go HarmoniYo S5 agent session (encoding and chord symbols)
- Copyright: Melody public domain; encoding 2026 Go Go HarmoniYo contributors, dedicated to the public domain
- License: [CC0 1.0 Universal (public domain dedication)](https://creativecommons.org/publicdomain/zero/1.0/) (`CC0-1.0`)
- Modifications: Encoded from the traditional tune; chord symbols added by the encoder.
- AI provenance: GitHub Copilot coding agent; model unrecorded (unrecorded); terms <https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot> (unrecorded); prompt: unrecorded (pre-ADR-0008); task brief: S5 in docs/spikes/README.md; resemblance review: pending, pending
- Review: pending. Proofread against a public-domain edition (S5 report).
- Legacy: added before ADR-0008; gaps are listed under "Open items".

### s5-musicxml-test-fixture

**S5 MusicXML importer test fixture**

- Files: `spikes/s5-chart-pipeline/test/fixtures/*` (1 file(s))
- Origin: ai-generated
- Authors: Go Go HarmoniYo S5 agent session
- Copyright: 2026 Go Go HarmoniYo contributors, dedicated to the public domain
- License: [CC0 1.0 Universal (public domain dedication)](https://creativecommons.org/publicdomain/zero/1.0/) (`CC0-1.0`)
- Modifications: none
- AI provenance: GitHub Copilot coding agent; model unrecorded (unrecorded); terms <https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot> (unrecorded); prompt: unrecorded (pre-ADR-0008); task brief: S5 in docs/spikes/README.md; resemblance review: pending, pending
- Review: pending. A few hand-written test measures, not a song.
- Legacy: added before ADR-0008; gaps are listed under "Open items".

### mutopia-carol

**Carol (hymn tune for 'It Came Upon the Midnight Clear'), Mutopia edition**

- Files: `spikes/s5-chart-pipeline/sources/mutopia/carol.*` (2 file(s))
- Origin: third-party
- Authors: Richard Storrs Willis (composer, 1850); Steve Dunlop (typesetter)
- Copyright: Typeset by Steve Dunlop for the Mutopia Project (Mutopia-2008/01/13-1231), placed in the public domain
- License: [Public domain (Mutopia Project dedication)](LICENSES/LicenseRef-Mutopia-PublicDomain.txt) (`LicenseRef-Mutopia-PublicDomain`)
- Source: <https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=1231> (Mutopia-2008/01/13-1231), retrieved 2026-10-23
- License evidence: Piece page 'Copyright: Public Domain' (checked 2026-10-23) and the LilyPond source's copyright field and tagline.
  - `spikes/s5-chart-pipeline/sources/mutopia/carol.ly` ← <https://www.mutopiaproject.org/ftp/WillisRS/carol/carol.ly> sha256 `721e2c5bf7efe5cd0038c5ad6e62bcf591be2af910c74d5aa2b2e672c7f256ed`
  - `spikes/s5-chart-pipeline/sources/mutopia/carol.mid` ← <https://www.mutopiaproject.org/ftp/WillisRS/carol/carol.mid> sha256 `0e1f08dd5e6840949cfa700c026643d6d748402d1b83336a9a723e94db1e8104`
- Modifications: none (byte-identical to the Mutopia files; the .ly keeps its tagline notice)
- Reuse limits: None required. We keep the Mutopia notice and credit the typesetter as a courtesy. Source of the edition: www.cyberhymnal.org.
- Review: approved by IP audit (agent), pending owner confirmation on 2026-10-23

### mutopia-good-king-wenceslas

**Good King Wenceslas, Mutopia edition**

- Files: `spikes/s5-chart-pipeline/sources/mutopia/GoodKingWenceslas.*` (2 file(s))
- Origin: third-party
- Authors: Piae Cantiones (melody, 1582); J. M. Neale (words, 1853); James Kilfiger (typesetter)
- Copyright: Typeset by James Kilfiger for the Mutopia Project (Mutopia-2007/01/10-905), placed in the public domain
- License: [Public domain (Mutopia Project dedication)](LICENSES/LicenseRef-Mutopia-PublicDomain.txt) (`LicenseRef-Mutopia-PublicDomain`)
- Source: <https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=905> (Mutopia-2007/01/10-905), retrieved 2026-10-23
- License evidence: Piece page 'Copyright: Public Domain' (checked 2026-10-23) and the LilyPond source's copyright field and tagline.
  - `spikes/s5-chart-pipeline/sources/mutopia/GoodKingWenceslas.ly` ← <https://www.mutopiaproject.org/ftp/Anonymous/GoodKingWenceslas/GoodKingWenceslas.ly> sha256 `d5967412ef47cc91add5eb361c25392273aaa7557028bfd76b1becb3af0e35e7`
  - `spikes/s5-chart-pipeline/sources/mutopia/GoodKingWenceslas.mid` ← <https://www.mutopiaproject.org/ftp/Anonymous/GoodKingWenceslas/GoodKingWenceslas.mid> sha256 `f854da74a0790af27192f9b0002348649852dbcfcaa26e490e789517b2dde97a`
- Modifications: none (byte-identical to the Mutopia files; the .ly keeps its tagline notice)
- Reuse limits: None required. We keep the Mutopia notice and credit the typesetter as a courtesy.
- Review: approved by IP audit (agent), pending owner confirmation on 2026-10-23

### mutopia-the-holly-and-the-ivy

**The Holly and the Ivy, Mutopia edition**

- Files: `spikes/s5-chart-pipeline/sources/mutopia/thehollyandtheivy.*` (2 file(s))
- Origin: third-party
- Authors: Traditional English (melody); Geoffrey Lehr (typesetter)
- Copyright: Typeset by Geoffrey Lehr for the Mutopia Project (Mutopia-2005/12/23-644), placed in the public domain
- License: [Public domain (Mutopia Project dedication)](LICENSES/LicenseRef-Mutopia-PublicDomain.txt) (`LicenseRef-Mutopia-PublicDomain`)
- Source: <https://www.mutopiaproject.org/cgibin/piece-info.cgi?id=644> (Mutopia-2005/12/23-644), retrieved 2026-10-23
- License evidence: Piece page 'Copyright: Public Domain' (checked 2026-10-23) and the LilyPond source's copyright field and tagline.
  - `spikes/s5-chart-pipeline/sources/mutopia/thehollyandtheivy.ly` ← <https://www.mutopiaproject.org/ftp/Traditional/thehollyandtheivy/thehollyandtheivy.ly> sha256 `b5de0ee05f7d516cd7515b32acd24ed3e9e2a0e0cac7b87f540cb60abd8e8c08`
  - `spikes/s5-chart-pipeline/sources/mutopia/thehollyandtheivy.mid` ← <https://www.mutopiaproject.org/ftp/Traditional/thehollyandtheivy/thehollyandtheivy.mid> sha256 `103692f749b39bf85c0bef8fba057f74c06d1de130aec01fd38f2eede2b22c4b`
- Modifications: none (byte-identical to the Mutopia files; the .ly keeps its tagline notice)
- Reuse limits: None required. We keep the Mutopia notice and credit the typesetter as a courtesy.
- Review: approved by IP audit (agent), pending owner confirmation on 2026-10-23

### s5-charts-from-cc0-lead-sheets

**S5 handbell charts and Clone Hero/YARG exports generated from the CC0 lead sheets**

- Files: `spikes/s5-chart-pipeline/charts/{deck-the-halls,jingle-bells,joy-to-the-world,silent-night,we-wish-you-a-merry-christmas}.json`, `spikes/s5-chart-pipeline/exports/{deck-the-halls,jingle-bells,joy-to-the-world,silent-night,we-wish-you-a-merry-christmas}/*` (30 file(s))
- Origin: derived — from [s5-jingle-bells-abc](#s5-jingle-bells-abc), [s5-joy-to-the-world-abc](#s5-joy-to-the-world-abc), [s5-silent-night-abc](#s5-silent-night-abc), [s5-deck-the-halls-abc](#s5-deck-the-halls-abc), [s5-we-wish-you-a-merry-christmas-abc](#s5-we-wish-you-a-merry-christmas-abc) via `node spikes/s5-chart-pipeline/build.mjs`
- Authors: Go Go HarmoniYo S5 chart pipeline
- Copyright: 2026 Go Go HarmoniYo contributors (generated), dedicated to the public domain
- License: [CC0 1.0 Universal (public domain dedication)](https://creativecommons.org/publicdomain/zero/1.0/) (`CC0-1.0`)
- Modifications: Algorithmic arrangement: role detection, difficulty tiers, bell-to-ringer assignment, MIDI export.
- Review: approved by IP audit (agent), pending owner confirmation on 2026-10-23. Each chart carries its source and license in song.license / song.source.
- Legacy: added before ADR-0008; gaps are listed under "Open items".

### s5-charts-carol

**S5 charts and exports for 'It Came Upon the Midnight Clear'**

- Files: `spikes/s5-chart-pipeline/charts/it-came-upon-the-midnight-clear.json`, `spikes/s5-chart-pipeline/exports/it-came-upon-the-midnight-clear/*` (6 file(s))
- Origin: derived — from [mutopia-carol](#mutopia-carol) via `node spikes/s5-chart-pipeline/build.mjs`
- Authors: Go Go HarmoniYo S5 chart pipeline
- Copyright: Typeset by Steve Dunlop for the Mutopia Project (Mutopia-2008/01/13-1231), placed in the public domain
- License: [Public domain (Mutopia Project dedication)](LICENSES/LicenseRef-Mutopia-PublicDomain.txt) (`LicenseRef-Mutopia-PublicDomain`)
- Modifications: Algorithmic arrangement from the Mutopia MIDI (melody/bass voices, difficulty tiers, bell assignment); tempo 60 → 90 qpm.
- Review: approved by IP audit (agent), pending owner confirmation on 2026-10-23
- Legacy: added before ADR-0008; gaps are listed under "Open items".

### s5-charts-good-king-wenceslas

**S5 charts and exports for 'Good King Wenceslas'**

- Files: `spikes/s5-chart-pipeline/charts/good-king-wenceslas.json`, `spikes/s5-chart-pipeline/exports/good-king-wenceslas/*` (6 file(s))
- Origin: derived — from [mutopia-good-king-wenceslas](#mutopia-good-king-wenceslas) via `node spikes/s5-chart-pipeline/build.mjs`
- Authors: Go Go HarmoniYo S5 chart pipeline
- Copyright: Typeset by James Kilfiger for the Mutopia Project (Mutopia-2007/01/10-905), placed in the public domain
- License: [Public domain (Mutopia Project dedication)](LICENSES/LicenseRef-Mutopia-PublicDomain.txt) (`LicenseRef-Mutopia-PublicDomain`)
- Modifications: Algorithmic arrangement from the Mutopia MIDI (melody/bass voices, difficulty tiers, bell assignment).
- Review: approved by IP audit (agent), pending owner confirmation on 2026-10-23
- Legacy: added before ADR-0008; gaps are listed under "Open items".

### s5-charts-the-holly-and-the-ivy

**S5 charts and exports for 'The Holly and the Ivy'**

- Files: `spikes/s5-chart-pipeline/charts/the-holly-and-the-ivy.json`, `spikes/s5-chart-pipeline/exports/the-holly-and-the-ivy/*` (6 file(s))
- Origin: derived — from [mutopia-the-holly-and-the-ivy](#mutopia-the-holly-and-the-ivy) via `node spikes/s5-chart-pipeline/build.mjs`
- Authors: Go Go HarmoniYo S5 chart pipeline
- Copyright: Typeset by Geoffrey Lehr for the Mutopia Project (Mutopia-2005/12/23-644), placed in the public domain
- License: [Public domain (Mutopia Project dedication)](LICENSES/LicenseRef-Mutopia-PublicDomain.txt) (`LicenseRef-Mutopia-PublicDomain`)
- Modifications: Algorithmic arrangement from the Mutopia MIDI (melody only; difficulty tiers, bell assignment).
- Review: approved by IP audit (agent), pending owner confirmation on 2026-10-23
- Legacy: added before ADR-0008; gaps are listed under "Open items".

### font-fredoka

**Fredoka font (SIL OFL 1.1), used to set brand-option wordmarks**

- Files: `docs/design/brand-options/fonts/fredoka/*` (2 file(s))
- Origin: third-party
- Authors: Milena Brandão; Hafontia
- Copyright: Copyright 2016 The Fredoka Project Authors (https://github.com/hafontia/Fredoka-One)
- License: [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/) (`OFL-1.1`)
- Source: <https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/fredoka> (google/fonts@e7db6ca603fd ofl/fredoka), retrieved 2026-10-25
- License evidence: OFL.txt shipped with the font (kept unmodified next to it) and METADATA.pb `license: "OFL"` in google/fonts at commit e7db6ca603fd, checked 2026-10-25.
  - `docs/design/brand-options/fonts/fredoka/Fredoka[wdth,wght].ttf` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/fredoka/Fredoka%5Bwdth,wght%5D.ttf> sha256 `2ba02e68b152868aef9ba28e24b3648c7d457fe6f25c761f2c2c53fb61a73fc8`
  - `docs/design/brand-options/fonts/fredoka/OFL.txt` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/fredoka/OFL.txt> sha256 `5c9e7eee5c6b25f4b05b8d53b2e470ea4962f9ced742d044a98f7d95d1375bab`
- Modifications: none (byte-identical to google/fonts; OFL.txt kept unmodified)
- Reuse limits: SIL OFL 1.1: keep the copyright notice and OFL.txt with the font; the font may not be sold by itself; modified versions stay under the OFL (no Reserved Font Name). Graphics and logos made with the font are not covered by the OFL (OFL-FAQ 1.1, 1.2).
- Review: pending. License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.

### font-outfit

**Outfit font (SIL OFL 1.1), used to set brand-option wordmarks**

- Files: `docs/design/brand-options/fonts/outfit/*` (2 file(s))
- Origin: third-party
- Authors: Smartsheet Inc; Rodrigo Fuenzalida
- Copyright: Copyright 2021 The Outfit Project Authors (https://github.com/Outfitio/Outfit-Fonts)
- License: [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/) (`OFL-1.1`)
- Source: <https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/outfit> (google/fonts@e7db6ca603fd ofl/outfit), retrieved 2026-10-25
- License evidence: OFL.txt shipped with the font (kept unmodified next to it) and METADATA.pb `license: "OFL"` in google/fonts at commit e7db6ca603fd, checked 2026-10-25.
  - `docs/design/brand-options/fonts/outfit/Outfit[wght].ttf` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/outfit/Outfit%5Bwght%5D.ttf> sha256 `fc7287273e66929776e2ba54f144fe699080bec29f61bf649d70d871468aeade`
  - `docs/design/brand-options/fonts/outfit/OFL.txt` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/outfit/OFL.txt> sha256 `c676351bf8576b9aba743cd5eaa8c0e7ee0d51f805d720447b4df4ddb6a2e416`
- Modifications: none (byte-identical to google/fonts; OFL.txt kept unmodified)
- Reuse limits: SIL OFL 1.1: keep the copyright notice and OFL.txt with the font; the font may not be sold by itself; modified versions stay under the OFL (no Reserved Font Name). Graphics and logos made with the font are not covered by the OFL (OFL-FAQ 1.1, 1.2).
- Review: pending. License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.

### font-sniglet

**Sniglet ExtraBold font (SIL OFL 1.1), used to set brand-option wordmarks**

- Files: `docs/design/brand-options/fonts/sniglet/*` (2 file(s))
- Origin: third-party
- Authors: Haley Fiege; Brenda Gallo; Pablo Impallari
- Copyright: Copyright (c) 2008, Haley Fiege (haley@kingdomofawesome.com), Copyright (c) 2012, Brenda Gallo (gbrenda1987@gmail.com), Copyright (c) 2013, Pablo Impallari (www.impallari.com|impallari@gmail.com)
- License: [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/) (`OFL-1.1`)
- Source: <https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/sniglet> (google/fonts@e7db6ca603fd ofl/sniglet), retrieved 2026-10-25
- License evidence: OFL.txt shipped with the font (kept unmodified next to it) and METADATA.pb `license: "OFL"` in google/fonts at commit e7db6ca603fd, checked 2026-10-25.
  - `docs/design/brand-options/fonts/sniglet/Sniglet-ExtraBold.ttf` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/sniglet/Sniglet-ExtraBold.ttf> sha256 `fb92a118e14b4bde101a0143895f570a54b070a307b359510b7703b5a94bb18c`
  - `docs/design/brand-options/fonts/sniglet/OFL.txt` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/sniglet/OFL.txt> sha256 `bca612761639e27860c5af7d702831b71f9230367d90fc094235c5e7838c0c01`
- Modifications: none (byte-identical to google/fonts; OFL.txt kept unmodified)
- Reuse limits: SIL OFL 1.1: keep the copyright notice and OFL.txt with the font; the font may not be sold by itself; modified versions stay under the OFL (no Reserved Font Name). Graphics and logos made with the font are not covered by the OFL (OFL-FAQ 1.1, 1.2).
- Review: pending. License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.

### font-nunito

**Nunito font (SIL OFL 1.1), used to set brand-option wordmarks**

- Files: `docs/design/brand-options/fonts/nunito/*` (2 file(s))
- Origin: third-party
- Authors: Vernon Adams; Cyreal; Jacques Le Bailly
- Copyright: Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)
- License: [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/) (`OFL-1.1`)
- Source: <https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/nunito> (google/fonts@e7db6ca603fd ofl/nunito), retrieved 2026-10-25
- License evidence: OFL.txt shipped with the font (kept unmodified next to it) and METADATA.pb `license: "OFL"` in google/fonts at commit e7db6ca603fd, checked 2026-10-25.
  - `docs/design/brand-options/fonts/nunito/Nunito[wght].ttf` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/nunito/Nunito%5Bwght%5D.ttf> sha256 `bb55a5ca5c2042335b3991af27c4d0705d0ef41cac6164ac737fd8f2a1e85207`
  - `docs/design/brand-options/fonts/nunito/OFL.txt` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/nunito/OFL.txt> sha256 `580df76c95a1ec5ab878ceb25bb3d85c6a076804e9c970c8c6972aea775fdf65`
- Modifications: none (byte-identical to google/fonts; OFL.txt kept unmodified)
- Reuse limits: SIL OFL 1.1: keep the copyright notice and OFL.txt with the font; the font may not be sold by itself; modified versions stay under the OFL (no Reserved Font Name). Graphics and logos made with the font are not covered by the OFL (OFL-FAQ 1.1, 1.2).
- Review: pending. License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.

### font-lilitaone

**Lilita One font (SIL OFL 1.1), used to set brand-option wordmarks**

- Files: `docs/design/brand-options/fonts/lilitaone/*` (2 file(s))
- Origin: third-party
- Authors: Juan Montoreano
- Copyright: Copyright (c) 2011 Juan Montoreano (juan@remolacha.biz), with Reserved Font Name Lilita
- License: [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/) (`OFL-1.1`)
- Source: <https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/lilitaone> (google/fonts@e7db6ca603fd ofl/lilitaone), retrieved 2026-10-25
- License evidence: OFL.txt shipped with the font (kept unmodified next to it) and METADATA.pb `license: "OFL"` in google/fonts at commit e7db6ca603fd, checked 2026-10-25.
  - `docs/design/brand-options/fonts/lilitaone/LilitaOne-Regular.ttf` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/lilitaone/LilitaOne-Regular.ttf> sha256 `f5b641c45c69d772ee4eda687bc9fda411d5cad6b0b45371491da4580cbc8d59`
  - `docs/design/brand-options/fonts/lilitaone/OFL.txt` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/lilitaone/OFL.txt> sha256 `255d5debbb80eb2ea762644311f266a279e8778f00156655a516e2b7781a63e1`
- Modifications: none (byte-identical to google/fonts; OFL.txt kept unmodified)
- Reuse limits: SIL OFL 1.1: keep the copyright notice and OFL.txt with the font; the font may not be sold by itself; modified versions stay under the OFL and may not use the Reserved Font Name "Lilita". Graphics and logos made with the font are not covered by the OFL (OFL-FAQ 1.1, 1.2).
- Review: pending. License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.

### font-grandstander

**Grandstander font (SIL OFL 1.1), used to set brand-option wordmarks**

- Files: `docs/design/brand-options/fonts/grandstander/*` (2 file(s))
- Origin: third-party
- Authors: Tyler Finck; ETC (Etcetera Type Co)
- Copyright: Copyright 2020 The Grandstander Project Authors (https://github.com/Etcetera-Type-Co/Grandstander)
- License: [SIL Open Font License 1.1](https://openfontlicense.org/open-font-license-official-text/) (`OFL-1.1`)
- Source: <https://github.com/google/fonts/tree/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/grandstander> (google/fonts@e7db6ca603fd ofl/grandstander), retrieved 2026-10-25
- License evidence: OFL.txt shipped with the font (kept unmodified next to it) and METADATA.pb `license: "OFL"` in google/fonts at commit e7db6ca603fd, checked 2026-10-25.
  - `docs/design/brand-options/fonts/grandstander/Grandstander[wght].ttf` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/grandstander/Grandstander%5Bwght%5D.ttf> sha256 `fbc7d1d934e6aa7842f7e8420cd833eca9eb123d61880075eec68751369e2f13`
  - `docs/design/brand-options/fonts/grandstander/OFL.txt` ← <https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/grandstander/OFL.txt> sha256 `c98642ce049ee94f1868c47db44dbdc69e1800e2cf3edb539f030ac4abc22ceb`
- Modifications: none (byte-identical to google/fonts; OFL.txt kept unmodified)
- Reuse limits: SIL OFL 1.1: keep the copyright notice and OFL.txt with the font; the font may not be sold by itself; modified versions stay under the OFL (no Reserved Font Name). Graphics and logos made with the font are not covered by the OFL (OFL-FAQ 1.1, 1.2).
- Review: pending. License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.

### brand-option-1-ring-burst

**Brand option 1, Ring Burst: wordmarks, mark, app icon, favicon, mascot sketch and preview board**

- Files: `docs/design/brand-options/1-ring-burst/*` (16 file(s))
- Origin: derived — from [font-fredoka](#font-fredoka) via `python tools/design/brand-options/build.py`
- Authors: David Cuccia and Go Go HarmoniYo contributors
- Copyright: 2026 David Cuccia and Go Go HarmoniYo contributors
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (`CC-BY-4.0`)
- Modifications: none
- Review: pending. Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.

### brand-option-2-resonance

**Brand option 2, Resonance: wordmarks, mark, app icon, favicon, mascot sketch and preview board**

- Files: `docs/design/brand-options/2-resonance/*` (12 file(s))
- Origin: derived — from [font-outfit](#font-outfit) via `python tools/design/brand-options/build.py`
- Authors: David Cuccia and Go Go HarmoniYo contributors
- Copyright: 2026 David Cuccia and Go Go HarmoniYo contributors
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (`CC-BY-4.0`)
- Modifications: none
- Review: pending. Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.

### brand-option-3-triad

**Brand option 3, Triad: wordmarks, mark, app icon, favicon, mascot sketch and preview board**

- Files: `docs/design/brand-options/3-triad/*` (16 file(s))
- Origin: derived — from [font-sniglet](#font-sniglet) via `python tools/design/brand-options/build.py`
- Authors: David Cuccia and Go Go HarmoniYo contributors
- Copyright: 2026 David Cuccia and Go Go HarmoniYo contributors
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (`CC-BY-4.0`)
- Modifications: none
- Review: pending. Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.

### brand-option-4-pitch-wheel

**Brand option 4, Pitch Wheel: wordmarks, mark, app icon, favicon, mascot sketch and preview board**

- Files: `docs/design/brand-options/4-pitch-wheel/*` (12 file(s))
- Origin: derived — from [font-nunito](#font-nunito) via `python tools/design/brand-options/build.py`
- Authors: David Cuccia and Go Go HarmoniYo contributors
- Copyright: 2026 David Cuccia and Go Go HarmoniYo contributors
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (`CC-BY-4.0`)
- Modifications: none
- Review: pending. Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.

### brand-option-5-bell-tag

**Brand option 5, Bell Tag: wordmarks, mark, app icon, favicon, mascot sketch and preview board**

- Files: `docs/design/brand-options/5-bell-tag/*` (16 file(s))
- Origin: derived — from [font-lilitaone](#font-lilitaone) via `python tools/design/brand-options/build.py`
- Authors: David Cuccia and Go Go HarmoniYo contributors
- Copyright: 2026 David Cuccia and Go Go HarmoniYo contributors
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (`CC-BY-4.0`)
- Modifications: none
- Review: pending. Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.

### brand-option-6-sing-along

**Brand option 6, Sing-Along: wordmarks, mark, app icon, favicon, mascot sketch and preview board**

- Files: `docs/design/brand-options/6-sing-along/*` (16 file(s))
- Origin: derived — from [font-grandstander](#font-grandstander) via `python tools/design/brand-options/build.py`
- Authors: David Cuccia and Go Go HarmoniYo contributors
- Copyright: 2026 David Cuccia and Go Go HarmoniYo contributors
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (`CC-BY-4.0`)
- Modifications: none
- Review: pending. Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.

### brand-options-overviews

**Brand options: side-by-side overview sheets (wordmarks, icons, mascots)**

- Files: `docs/design/brand-options/overview-*.png` (3 file(s))
- Origin: derived — from [brand-option-1-ring-burst](#brand-option-1-ring-burst), [brand-option-2-resonance](#brand-option-2-resonance), [brand-option-3-triad](#brand-option-3-triad), [brand-option-4-pitch-wheel](#brand-option-4-pitch-wheel), [brand-option-5-bell-tag](#brand-option-5-bell-tag), [brand-option-6-sing-along](#brand-option-6-sing-along) via `python tools/design/brand-options/build.py`
- Authors: David Cuccia and Go Go HarmoniYo contributors
- Copyright: 2026 David Cuccia and Go Go HarmoniYo contributors
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/) (`CC-BY-4.0`)
- Modifications: none
- Review: pending. Rendered in headless Chromium from the six options' SVGs; labels use the system UI font. Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.

## Open items

- s5-jingle-bells-abc: legacy AI provenance gaps: model, version, termsDate, prompt, reviewer, reviewDate
- s5-joy-to-the-world-abc: legacy AI provenance gaps: model, version, termsDate, prompt, reviewer, reviewDate
- s5-silent-night-abc: legacy AI provenance gaps: model, version, termsDate, prompt, reviewer, reviewDate
- s5-deck-the-halls-abc: legacy AI provenance gaps: model, version, termsDate, prompt, reviewer, reviewDate
- s5-we-wish-you-a-merry-christmas-abc: legacy AI provenance gaps: model, version, termsDate, prompt, reviewer, reviewDate
- s5-musicxml-test-fixture: legacy AI provenance gaps: model, version, termsDate, prompt, reviewer, reviewDate
- pitch-class-palette-sheet: review pending (Rendered by tools/design/palette-check.mjs --sheet (headless Chrome) from docs/design/pitch-class-palette.json: coloured circles with note names, system UI font, no third-party content. Owner to confirm CC BY 4.0 like the UI captures (#12).)
- s5-jingle-bells-abc: review pending (Proofread against a public-domain edition (S5 report).)
- s5-joy-to-the-world-abc: review pending (Proofread against a public-domain edition (S5 report).)
- s5-silent-night-abc: review pending (Proofread against a public-domain edition (S5 report).)
- s5-deck-the-halls-abc: review pending (Proofread against a public-domain edition (S5 report).)
- s5-we-wish-you-a-merry-christmas-abc: review pending (Proofread against a public-domain edition (S5 report).)
- s5-musicxml-test-fixture: review pending (A few hand-written test measures, not a song.)
- font-fredoka: review pending (License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.)
- font-outfit: review pending (License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.)
- font-sniglet: review pending (License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.)
- font-nunito: review pending (License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.)
- font-lilitaone: review pending (License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.)
- font-grandstander: review pending (License verified from the source by the brand-options session (agent); owner to confirm. Used only by tools/design/brand-options/build.py to outline wordmarks; no font is shipped in the game.)
- brand-option-1-ring-burst: review pending (Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.)
- brand-option-2-resonance: review pending (Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.)
- brand-option-3-triad: review pending (Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.)
- brand-option-4-pitch-wheel: review pending (Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.)
- brand-option-5-bell-tag: review pending (Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.)
- brand-option-6-sing-along: review pending (Procedural design exploration (not adopted). Wordmarks are glyph outlines from the OFL font, shaped with HarfBuzz and converted to SVG paths; logos made with OFL fonts are the maker's own work (OFL-FAQ 1.1). Marks, icons and the mascot sketch are hand-written SVG geometry; no image-generation model and no reference images were used (the generator script was written with an AI coding agent). Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.)
- brand-options-overviews: review pending (Rendered in headless Chromium from the six options' SVGs; labels use the system UI font. Agent self-check against Guitar Hero, Rock Band, Harmonix, Rhythm Heaven, Beat Saber, Taiko no Tatsujin, DDR, the Bell System/AT&T bell, Taco Bell, Bell Canada, the Wi-Fi and notification-bell icons (see docs/design/brand-options/README.md#resemblance-check); a human resemblance review is still required before any option is adopted.)

## Required record for each new asset

Add a register entry **in the same pull request** as the asset: paths, title, kind, origin, authors,
copyright, SPDX license, source URL with retrieval date and pinned SHA-256 (third-party), exact
credit text, modifications, reuse limits, and for AI-generated assets the tool, model, version,
terms URL and date, full prompt, and the human resemblance reviewer and date. See
[CONTRIBUTING.md](CONTRIBUTING.md#adding-assets).
