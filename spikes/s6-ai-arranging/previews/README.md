# S6 blind-listening set

Six short clips, three per carol. Each carol has one procedural arrangement (today's game), one
qwen3:8b-assisted candidate and one Anticipatory Music Transformer accompaniment. Letters are
shuffled per song. All clips are mono at 22.05 kHz and loudness-matched to −20 dBFS RMS. They
were rendered with the game's own synths (S4 bells, I2 backing), with no samples.

| Song | Clips |
|---|---|
| Deck the Halls | [A](deck-the-halls-A.ogg) · [B](deck-the-halls-B.ogg) · [C](deck-the-halls-C.ogg) |
| The Holly and the Ivy | [A](the-holly-and-the-ivy-A.ogg) · [B](the-holly-and-the-ivy-B.ogg) · [C](the-holly-and-the-ivy-C.ogg) |

How to listen (about 5 minutes):

1. Listen to all three clips of a song once, in any order, on the TV or good speakers.
2. For each song, write down: your favourite, any clip you would *not* want in the game, and one
   word per clip (e.g. "busy", "warm", "random").
3. Only then open [`answer-key.json`](answer-key.json) and add your notes to the
   [S6 report](../../../docs/spikes/S6-report.md#procedural-vs-llm-vs-amt-blind-listening-set).

Also listen for resemblance: does any clip sound like a specific recording or published
arrangement you know? If so, note it. The AI clips need this human check before they can be
promoted (ADR-0008, ADR-0010).

Regenerate the set: `node scripts/render-previews.ts --ogg-python <python with soundfile>`
(from `spikes/s6-ai-arranging`).
