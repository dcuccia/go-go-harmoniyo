Write a descant (a new, higher counter-melody) for this public-domain carol, to be played on
handbells above the tune.

Title: {{title}}
Key: {{key}}. Meter: {{meter}}. Unit note length L:{{unit}}.{{pickupNote}}

The tune with its chord symbols, in ABC notation:
```abc
{{abc}}
```

A descant is its own melody, not the tune moved up: when the tune moves, the descant holds or
moves the other way; when the tune holds a long note, the descant may move.

Rules:
- Exactly {{barCount}} bars, one descant bar for each tune bar; each bar lasts exactly as long
  as the tune's bar ({{barEighths}} eighth notes per full bar at L:1/8).{{pickupRule}}
- Stay between {{low}} and {{high}} (ABC {{lowAbc}} to {{highAbc}}), above the tune.
- Use at least 5 different pitches across the piece and move mostly by step, with a few leaps
  of a 3rd or 4th. Never repeat one bar more than twice in a row.
- At most 2 notes per beat; mostly half and quarter notes (dotted values in compound meter)
  and some held notes. Do not copy the tune's rhythm.
- On each strong beat use a note of the chord shown. Avoid parallel fifths and octaves with the tune.
- Stay in {{key}}. End on the tonic or its third.

Format example (a different key and meter, two bars of 4/4 at L:1/8):
```abc
e4 d4 | c6 B2 |
```

Reply with only the descant's music lines in an ABC code block: no header fields, no chord
symbols, bar lines between bars, ending with |].
