# Visual identity

These are our own design principles, in our own words. They describe the feeling we want; they
don't point at any other game's assets. The policy behind them is
[ADR-0008](../decisions/0008-assets-ip-and-attribution.md).

## Principles

1. **Readable from the couch.** A ringer three meters from a TV should know which bell to ring
   and when, at a glance. Big shapes, high contrast and calm backgrounds come first; effects
   never cover an incoming note. Note names are always shown, so color is never the only cue.
2. **Game feel you can hear and see.** Every ring gets an answer within one frame. A bloom of
   light, a ripple across the stage and a bell tone together say "yes, that one." Great playing
   builds up gradually: warmer light, more sparkle, a fuller sound. It never shakes the screen.
3. **Festive warmth.** Candlelight, frost, evergreen, berries, brass and wood. Glow is soft and
   warm, not neon-hard. The palette should feel at home in a living room in December and in a
   school gym in April.
4. **The bell is the hero.** We draw handbells as handbells: a polished bell with a handle, a
   clapper and a felt-tipped mallet. We use their real motion (the forward ring, the damp to the
   shoulder) rather than guitar or drum metaphors.
5. **A team, not a leaderboard.** Shared streaks, a shared meter and a shared celebration.
   Individual feedback stays kind: show what to fix, never shame.
6. **Ours, end to end.** We draw our own shapes, layouts, icons and effects. We describe moods
   rather than copying anything, and we don't use another game's color order or layout as a
   template.

## Pitch-class palette

Each bell's color comes from its **pitch**, never from its lane position. A D is always
candlelight-gold on every ringer's highway, on the phone, and on the results screen. That helps
ringers learn real pitch names and keeps us clear of any game's fixed five-lane color order.

- **Hue** walks the circle of fifths, 30° per step in OKLCH, so harmonically close notes get
  related colors and neighboring scale steps get contrasting ones.
- **Lightness:** naturals are lighter (L 0.72), and sharps and flats are deeper (L 0.62), like
  white and black keys. Accidental bells also get a ring outline, so the difference doesn't
  depend on color alone.
- **Octave (optional):** shift lightness by about ±0.04 per octave from octave 4. Big low bells
  look a little deeper, small high bells a little brighter.
- **Contrast:** every color has at least 4.5:1 contrast against the stage background `#0b0d17`
  and with dark label text `#10121c` on top.

| Pitch | Token | Hex | OKLCH (L, C, h) |
|---|---|---|---|
| C | berry | `#f8767a` | 0.72, 0.160, 20 |
| C♯/D♭ | winter-sky | `#1292c0` | 0.62, 0.120, 230 |
| D | candlelight | `#d49807` | 0.72, 0.148, 80 |
| D♯/E♭ | plum | `#8678c9` | 0.62, 0.120, 290 |
| E | holly | `#69bc57` | 0.72, 0.160, 140 |
| F | rosehip | `#ed76b3` | 0.72, 0.160, 350 |
| F♯/G♭ | frost | `#0a999f` | 0.62, 0.104, 200 |
| G | ember | `#f2823b` | 0.72, 0.160, 50 |
| G♯/A♭ | twilight | `#5a86ce` | 0.62, 0.120, 260 |
| A | pear | `#abac07` | 0.72, 0.156, 110 |
| A♯/B♭ | mulberry | `#a66db3` | 0.62, 0.120, 320 |
| B | spruce | `#04c097` | 0.72, 0.142, 170 |

Machine-readable tokens: [`pitch-class-palette.json`](pitch-class-palette.json). The current
spikes (S4/I2, and the phone controller in I1 mode) still use a fixed lane-order palette. Issue
[#12](https://github.com/dcuccia/handbell-hero/issues/12) moves them to this palette.

**Interop exception:** when a phone drives the YARG fork (I1), the phone may mirror YARG's own
lane colors, so players can match what YARG shows on screen. That code only describes another
program's UI. It is not our visual identity.

## Making new assets

- Write briefs and AI prompts about mood, materials, light and motion: "polished brass bell,
  warm rim light, soft snow bokeh". Never name a game, studio or artist (ADR-0008 §4).
- Never use img2img or style references from other games' screenshots or art.
- Every asset gets an [asset register](../../attribution/register.json) entry in the same PR,
  and AI assets get a human resemblance review before merge. See
  [CONTRIBUTING.md](../../CONTRIBUTING.md#adding-assets).
