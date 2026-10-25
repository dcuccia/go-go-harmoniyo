Harmonize this public-domain carol melody with chord symbols.

Title: {{title}}
Key: {{key}}. Meter: {{meter}}.{{pickupNote}}

The melody bar by bar, as beat:note (beat 1 is the downbeat; a note lasts until the next one):
{{listing}}

The same melody in ABC notation:
```abc
{{abc}}
```

Rules:
- Give exactly {{barCount}} bars, in order.{{pickupRule}}
- Each bar's list has either 1 chord or {{splitHint}}; the chords split the bar into equal
  parts. Never give one chord per melody note: the number of chords must divide the bar's beats.
- Use simple diatonic chords of {{key}} (I, ii, iii, IV, V, V7, vi). Use a secondary dominant
  only where the melody clearly needs it. Symbols like G, Em, D7, C/E are fine.
- Melody notes on strong beats should be chord tones; passing notes on weak beats need not be.
- Change chords at a calm, hymn-like pace and end with an authentic cadence (V or V7, then I).

Reply with only JSON in this shape: {"bars": [["{{tonic}}"], ["{{tonic}}", "{{dominant}}"], ...]}
