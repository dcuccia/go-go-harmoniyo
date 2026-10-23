# Brand guide (draft)

- Status: **Proposed** (draft for the owner). The public name isn't chosen yet:
  [#13](https://github.com/dcuccia/handbell-hero/issues/13).
- Evidence: [name check](../research/naming-go-go-harmonio.md). Visual principles:
  [visual identity](visual-identity.md). Asset rules:
  [ADR-0008](../decisions/0008-assets-ip-and-attribution.md).

This guide works for either finalist. Pick one column, then delete the other.

| | Option A | Option B |
|---|---|---|
| Product name | **Go Go Harmonio** | **Go Go HarmoniYo** |
| Mascot / character | **Harmonio** | **HarmoniYo**, called **Yo** for short |
| Code identifier | `gogoharmonio`, `go-go-harmonio` | `gogoharmoniyo`, `go-go-harmoniyo` |
| npm / NuGet | `@gogoharmonio/*`, `GoGoHarmonio.*` | `@gogoharmoniyo/*`, `GoGoHarmoniYo.*` |
| Say it | "go go har-MOH-nee-oh" | "go go har-MOH-nee-yo" |

Below, **[Name]** means the product name and **[Mascot]** the character name.

## 1. The name

- **Use the full name every time** the product is meant: Go Go Harmonio / Go Go HarmoniYo. This
  rule protects the trademark. "Go Go" alone is weak and widely used, and "Harmonio"/"HarmoniYo"
  alone means the character (and, for Harmonio, is a word others already use).
- **Never abbreviate.** No "GGH", "GGHY", "GoGo", "Go Go" or "Harmonio" as the product.
  "GGH" echoes the "GH" abbreviation of a well-known rhythm-game franchise.
- **Never pair the name** with "Hero", "Band", "Rock", "Guitar", "Legends", "Revolution",
  "-ix", or any other game's naming pattern. The code name "Handbell Hero" stays internal only
  (repository, old docs). Never show it next to the public name.
- **The mascot name is only for the character:** "[Mascot] cheers when your team hits a streak."
  Don't use it as the product name in store titles, URLs or headlines.

### Casing and punctuation

| Do | Don't |
|---|---|
| Go Go Harmonio | GoGo Harmonio, Go-Go Harmonio, Go Go! Harmonio, GO GO HARMONIO in running text |
| Go Go HarmoniYo | Go Go Harmoniyo, Go Go Harmoni-Yo, Go Go HarmonYo |
| Go Go Harmonio's new carols | Go Go Harmonios (no plural) |

- Two words "Go Go", each capitalized, a single space, no hyphen and no exclamation mark. Several
  existing marks use "Go! Go!" and "Go-Go", so our plain form helps tell us apart.
- **Option B:** the capital **Y** is part of the name. In all-caps settings (logo lockups,
  buttons) write HARMONIYO. Never lowercase the Y in running text.
- All caps is allowed only in the logo or very short UI labels, never in sentences.
- In code, URLs and handles, use lowercase without spaces (`gogoharmonio` / `gogoharmoniyo`).
  Use kebab-case (`go-go-harmonio`) only where a separator is required.

### Editions

The name is an umbrella. Instruments and audiences become editions:

- **Format:** `[Name]: [Edition]`, with a colon, one space and the edition in title case.
  - Go Go Harmonio: Bells
  - Go Go Harmonio: Chimes
  - Go Go Harmonio: Classroom
  - Go Go Harmonio: Holiday Carols
- **Short form inside an edition's own UI:** "Bells Edition" is fine after the full name has
  appeared once on that screen.
- **No numbered sequels** in the name ("2", "Plus"). Use the edition or a year if needed.

## 2. Tone of voice

- **Warm and encouraging.** We celebrate the team first ("Beautiful peal, everyone!") and coach
  individuals kindly ("Ring a little earlier on the G"). No shaming, no "FAIL" (see
  [visual identity](visual-identity.md) principle 5).
- **Playful, not snarky.** Light puns about bells, rings and harmony are welcome. Avoid sarcasm
  and edgy humor, because classrooms and grandparents are part of our audience.
- **Musically literate.** Use real terms (pitch names, ring, damp, peal, measure) and explain
  them once.
- **Inclusive by default:**
  - "ringers", "players", "everyone", not "guys";
  - no assumptions about age, gender, faith or ability;
  - holiday content is opt-in, never the only theme.
- **Short.** Couch-readable UI copy: a few words, big type.

## 3. Logo direction

These are directions for future human or AI work, not a finished logo.

- **A wordmark first:** custom, rounded, friendly lettering. It must be readable from three meters
  on a TV and at 48 px as an app icon. "Go Go" can be smaller and sit above the main word.
- **Mark idea:** a handbell silhouette built from our own shapes:
  - a bell whose mouth forms a stylized open "o" (or, for Option B, a "Y" formed by the handle and
    two sound arcs);
  - a ring burst drawn as concentric arcs;
  - optionally, a few dots in [pitch-class palette](visual-identity.md#pitch-class-palette) colors.
- **Colors:**
  - Stage dark `#0b0d17` with warm candlelight, brass and wood accents.
  - Multicolor uses come from the pitch-class palette in circle-of-fifths order. **Never** use a
    fixed green/red/yellow/blue/orange lane order.
  - Provide a one-color version (white on dark, dark on light).
- **Avoid anything that evokes other rhythm-game brands:**
  - flames, lightning bolts, guitar necks or headstocks, picks;
  - chrome or metal "rock" lettering, star bursts behind the logo;
  - five-lane highways in the logo;
  - drum sets, "X" endings.

  Also avoid go-go-dancer or nightclub imagery.
- **Clear space:** at least the height of the "o" on every side. Minimum size: 24 px for the mark
  alone and 96 px wide for the wordmark.
- **Accessibility:** contrast of at least 4.5:1 against its background. Never rely on color alone.

## 4. Non-affiliation disclaimer

Use this wherever we mention other games (README, store listing, website footer, credits):

> [Name] is an independent open-source project. It is not affiliated with, endorsed by, or
> sponsored by the makers of any game or brand it mentions. All trademarks belong to their owners.

Short form for tight spaces: "Independent project; not affiliated with any game it mentions."

## 5. Mascot concept brief

This brief is for future concept art (human or AI) under [ADR-0008](../decisions/0008-assets-ip-and-attribution.md).

### Who [Mascot] is

[Mascot] is the spirit of a ringing bell: the warm "hum" you hear after a good ring. They turn up
when a group starts making music together. They light the way down the note highway, cheer the
team and gently show who rings next. They're a bandleader and friend, not a judge.

- **Personality:** joyful, patient, a little mischievous, endlessly encouraging. Loves a big team
  chord more than any solo. Gets visibly excited by harmony: they glow brighter when more ringers
  hit together.
- **What they never do:** mock a missed note, show off, or compete with the players.
- **Signature moves:**
  - a forward ring with a bright bloom of light;
  - a "damp to the shoulder" bow at the end of a song;
  - a little spin when the team streak grows.

  These use real handbell motion ([visual identity](visual-identity.md) principle 4).

### Inclusive, women-forward options for the owner

The owner wants women and girls to see themselves in the lead. Pick one:

1. **Bell captain (human, she/her).** [Mascot] is a young woman who leads a handbell choir: gloves,
   a mallet tucked in her sleeve, and a bell-shaped hair clip. She's confident, warm and a little
   goofy. A rotating crew of ringers varies in age, body type, skin tone and ability (a wheelchair
   ringer, a grandfather, a kid on a step stool).
2. **Living bell (non-human, gender-neutral or she).** [Mascot] is a small brass handbell with a
   face in the shine, felt-tipped "hands" and a handle like a ponytail or curl. The crew of human
   ringers around them is diverse, and the lead ringer in the key art is a woman or girl.
3. **Duo.** A living-bell [Mascot] plus a human bell captain (she/her). They give the game two
   voices: [Mascot] cheers, the captain coaches.

Notes:

- **Option A.** In Spanish, Italian and Portuguese, the "-o" ending of "Harmonio" reads masculine.
  For options 1 and 3, either present Harmonio as the bell (option 2/3) or accept the mismatch on
  purpose. Don't rename to "Harmonia": that collides with existing HARMONIA marks and the Harmonia
  Mundi label.
- **Option B.** "HarmoniYo" and "Yo" are gender-neutral and work with all three options.
  **Origin story:** "YoYo" is the owner's family nickname, so the mascot is named for the family
  that started the game. The owner may approve the exact public wording, for example: "Yo is named
  after a family nickname. The game started as a way for one family to ring carols together."
  - Never reference the yo-yo toy as a logo element.
  - Never reference any real person called Yo-Yo.

### Design constraints

- **Readable at a glance:**
  - a strong silhouette that reads at 64 px on a phone and from the couch on a TV;
  - two or three main shapes;
  - expressive eyes.
- **Materials and light:** polished brass, warm rim light, felt, wood and soft snow bokeh, matching
  the festive warmth of the [visual identity](visual-identity.md).
- **Color:** body in brass or candlelight tones. Accents may take the color of the pitch being
  rung (from the pitch-class palette), never a fixed lane order.
- **Animation:** idle hum (slow glow), ring (bloom and a slight lean forward), cheer (hop and
  sparkle), damp (bow). No screen shake.
- **Original, end to end.** The character must not resemble any existing mascot, game character
  or franchise art. A human reviews resemblance before merge.

### Making the art: provenance rules (ADR-0008)

- Prompts describe feeling, material, light and motion. **Never** a game, franchise, studio,
  character or artist name. No img2img, style transfer or reference images from copyrighted art.
  Example prompt:
  > A friendly small polished-brass handbell character with a gentle face reflected in its shine,
  > felt-tipped mallet hands, warm candlelight rim light, soft snow bokeh, joyful pose mid-ring with
  > a bloom of golden light, clean shapes, readable silhouette, family-friendly.
- **Log each asset** in [`attribution/register.json`](../../attribution/register.json) in the
  same PR:
  - tool, model, version;
  - terms URL and terms date;
  - the full prompt;
  - resemblance reviewer and date.
- **Licenses:** AI-generated art is CC0 1.0. Human-made art is CC BY 4.0.
- **Human artists** (preferred for the final mascot) get credit in `ATTRIBUTION.md` and in the
  in-game credits.

## 6. Checklist when the owner picks the name

1. Choose Option A or B. Delete the other column and set this guide's status to Accepted.
2. Register the domain, GitHub org, npm org and social handles listed in the
   [name check](../research/naming-go-go-harmonio.md#6-what-the-owner-needs-to-do).
3. Update the README title and disclaimer, `attribution/credits.json` (`project.name`) and
   user-facing strings. Keep the `handbell-hero` repository name as the code name, or rename it
   (GitHub redirects).
4. Commission the mascot and logo with the brief above.
