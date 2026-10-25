Proofread the chord symbols of this public-domain carol. A computer guessed them from the
melody; some may be wrong. Keep the chords that fit and fix the ones that don't.

Title: {{title}}
Key: {{key}}. Meter: {{meter}}.{{pickupNote}}

The melody bar by bar, as beat:note (beat 1 is the downbeat; a note lasts until the next one):
{{listing}}

Current chords, one list per bar:
{{current}}

Rules:
- Give exactly {{barCount}} bars, in order.{{pickupRule}}
- Each bar's list has either 1 chord or {{splitHint}}; the chords split the bar into equal
  parts. Never give one chord per melody note: the number of chords must divide the bar's beats.
- Use simple diatonic chords of {{key}} (I, ii, iii, IV, V, V7, vi), a secondary dominant only
  where the melody clearly needs it.
- Melody notes on strong beats should be chord tones. End with an authentic cadence (V or V7, then I).
- List each change you make with a short reason.

Reply with only JSON in this shape:
{"bars": [["{{tonic}}"], ...], "changes": ["bar 5: {{tonic}} -> {{dominant}}, the melody outlines the dominant"]}
