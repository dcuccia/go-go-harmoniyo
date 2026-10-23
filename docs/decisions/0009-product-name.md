# 0009 — Product name: Go Go HarmoniYo

- Status: Accepted (2026-10-23)
- Date: 2026-10-23
- Deciders: @dcuccia (owner); proposed by the issue #13 naming session

## Context

"Handbell Hero" follows the "[instrument] Hero" naming pattern. Activision holds a family of
those marks for music games (GUITAR HERO, BAND HERO, and filings for DRUM HERO, SING HERO and
KEYBOARD HERO). [ADR-0008](0008-assets-ip-and-attribution.md) §2 asks us to avoid other games'
naming patterns, so we need a distinct public name before any public release
([#13](https://github.com/dcuccia/handbell-hero/issues/13)).

The owner wants a general umbrella name, not a handbell-only one, so instrument editions can follow
later.

The [name check](../research/naming-go-go-harmonio.md) compared the finalists using:

- trademarks: USPTO, EUIPO/TMview and WIPO Global Brand Database;
- the Apple App Store and Google Play;
- domains (RDAP/WHOIS);
- GitHub, npm and NuGet;
- social handles;
- web use and meanings in other languages.

This ADR records project practice. It is not legal advice.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| Keep "Handbell Hero" | Familiar to us | Follows Activision's "[instrument] Hero" pattern; conflicts with ADR-0008 §2 |
| **Go Go HarmoniYo** (mascot HarmoniYo, "Yo") | No HARMONIYO trademark, app or web use anywhere; every domain and handle free, including `harmoniyo.com`; the "-Yo" ending gives clear distance from HARMONIX; gender-neutral mascot name; personal origin ("YoYo" is a family nickname) | People will sometimes lowercase the medial capital Y; sounds like "Harmonio"; "Go Go" is a weak, crowded element; must not suggest any link to Yo-Yo Ma |
| Go Go Harmonio (mascot Harmonio) | No GO GO HARMONIO mark; `gogoharmonio` domains and handles free | HARMONIO registered to Boehringer Ingelheim (class 42); harmonio.io is a live music business; `harmonio` handles taken; one letter away from HARMONIX (Harmonix/Epic, music games); means "harmonium" in es/it/pt; "-o" reads masculine |
| Earlier ideas (Peal, Chime In, Ring Along, Bell Rush) | Short | Not vetted (a first pass reported a CHIME IN mark owned by Chime Financial; we didn't recheck it); handbell-only |

## Decision

The public product name is **Go Go HarmoniYo**. The mascot is **HarmoniYo**, nicknamed **"Yo"**.
The rules are in the [brand guide](../design/brand.md). In short:

1. **Use the full name every time** the product is meant: "Go Go HarmoniYo". Two words "Go Go"
   with a space, no hyphen, no "!", and a capital **Y**. Use all caps (GO GO HARMONIYO) only in
   logo lockups.
2. **Never abbreviate.** No "GGH", "GGHY" or "Go Go". Don't use "HarmoniYo" alone for the product.
   "HarmoniYo" and "Yo" name only the character.
3. **Editions** are written `Go Go HarmoniYo: <Edition>`, for example "Go Go HarmoniYo: Bells" or
   "Go Go HarmoniYo: Classroom".
4. **Never combine the name** with "Hero", "-ix" or any other game's naming pattern.
5. **Don't imply any connection to Yo-Yo Ma**, or any other real person called Yo-Yo. Don't use a
   yo-yo toy as a logo element.
6. **Code identifiers:** `gogoharmoniyo` / `go-go-harmoniyo`, `@gogoharmoniyo/*` on npm and
   `GoGoHarmoniYo.*` on NuGet, once those are reserved.
7. **The repository keeps the code name `handbell-hero` until the public release.** Renaming it
   later is optional; GitHub redirects.

## Consequences

- README, ATTRIBUTION.md and `attribution/credits.json` (`project.name`, with `codeName:
  handbell-hero`) use the new name.
- Visible titles in the spike UIs are renamed in the #12 palette work, not here.
- **Owner actions:** reserve these before any public mention (nothing has been registered yet):
  - `gogoharmoniyo.com` (and optionally `harmoniyo.com`, `.game`, `.app`);
  - a GitHub org;
  - an npm org;
  - YouTube, TikTok, X, Bluesky, Instagram and Twitch handles.
- **Before a public app-store launch:**
  - commission a full clearance search;
  - consider a US intent-to-use application for the full phrase in class 9 (downloadable game
    software) and class 41 (online games; music entertainment and education);
  - consider class 28 or 15 only if we sell hardware.
- **Mascot art** follows the brand guide's brief and ADR-0008 provenance rules. The public wording
  of the YoYo origin story is pending owner approval.

## Evidence

- [Name check: Go Go Harmonio and Go Go HarmoniYo](../research/naming-go-go-harmonio.md),
  2026-10-23. Includes the search method, so it can be repeated.
- [IP audit 2026-10-23](../research/ip-audit-2026-10-23.md): found the "[instrument] Hero"
  naming issue.
