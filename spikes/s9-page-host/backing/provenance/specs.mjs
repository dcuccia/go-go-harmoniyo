// Per-song phrase plans. One line per phrase: "bars bass/inner/dynamic [flags]".
//   bass:  bar   = one note on each strong beat, cut where the harmony leaves it
//          chord = follows every change of the chart's own bass
//          walk  = chord, plus a stepwise link into the next bass note where there is room
//          pedal = tonic drone (with its fifth) wherever the chart harmony contains it, chart bass elsewhere
//          pulse = chord, plus the fifth on the other strong beat (4/4 only)
//          rest  = silent
//   inner: after = one line, entering a beat after each downbeat
//          line  = one sustained line that moves by the smallest step the harmony allows
//          pair  = the line plus a second voice a third or sixth below
//          roll  = broken chord after the downbeat, stepping aside for off-beat bell attacks
//          none  = silent
//   flags: b = the inner voice breathes on the last beat of the phrase
// `idea` says what the plan is for; `write` holds the few bars written by hand.
const P = (text, write) => text.split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
  const m = /^(\d+)-(\d+)\s+(\w+)\/(\w+)\/(\w+)(?:\s+(\w+))?$/.exec(s);
  if (!m) throw new Error(`bad phrase "${s}"`);
  const ph = { bars: [Number(m[1]), Number(m[2])], bass: m[3], inner: m[4], dyn: m[5], breath: (m[6] ?? '').includes('b') };
  const w = Object.fromEntries(Object.entries(write ?? {}).filter(([bar]) => Number(bar) >= ph.bars[0] && Number(bar) <= ph.bars[1]));
  if (Object.keys(w).length) ph.write = w;
  return ph;
});

export const SPECS = {
  'angels-we-have-heard-on-high': {
    idea: 'Verse twice (thin, then a moving bass), then sustained thirds under the Gloria runs so the bells carry the motion; the second Gloria is the fullest and walks into the close.',
    phrases: P('1-4 bar/after/p b; 5-8 chord/line/mp; 9-12 chord/pair/mf; 13-14 walk/line/mf; 15-18 chord/pair/mf; 19-21 walk/pair/f'),
  },
  'auld-lang-syne': {
    idea: 'Verse held back (after-beat line, then one sustained line); the chorus opens with a broken chord and closes with a walking bass and thirds.',
    phrases: P('1-4 bar/after/p b; 5-8 chord/line/mp; 9-12 chord/roll/mp; 13-16 walk/pair/mf'),
  },
  'away-in-a-manger': {
    idea: 'Lullaby: almost nothing at first, a tonic drone with a rocking figure for the third line, and thirds only for the last line.',
    phrases: P('1-4 bar/after/pp b; 5-8 bar/line/p; 9-12 pedal/roll/p; 13-16 chord/pair/mp'),
  },
  'carol-of-the-bells': {
    idea: 'Follows the chart\'s own form: silent under the opening ostinato, after-beat pedal texture when the bass enters, thirds at the two melodic peaks (bars 17-20, 33-36), a bare bass under each first rising scale, and a partial echo of the ostinato in the last bar (its passing A is removed wherever a bell rings Bb).',
    phrases: P('1-4 rest/none/p; 5-8 bar/after/p; 9-12 chord/after/mp; 13-16 chord/line/mp; 17-20 chord/pair/mf; 21-22 bar/none/p; 23-24 chord/line/mp; 25-28 chord/line/mp; 29-32 chord/after/mp; 33-36 chord/pair/mf; 37-38 bar/none/p; 39-40 chord/line/mf; 41-44 chord/pair/mf',
      { 44: { line: 'Bb3@0+480 A3@480+240~ Bb3@720+240 G3@960+480' } }),
  },
  'deck-the-halls': {
    idea: 'A A B A: first A light, second A with a moving line, B (the turn to the dominant) with a walking bass, last A full.',
    phrases: P('1-4 bar/after/mp b; 5-8 chord/line/mp; 9-12 walk/pair/mf; 13-16 chord/pair/f'),
  },
  'ding-dong-merrily-on-high': {
    idea: 'Two light verse lines, then held thirds over a walking bass under the long Gloria sequence, and a firm close.',
    phrases: P('1-4 bar/after/mp b; 5-8 chord/line/mp; 9-14 walk/pair/mf; 15-16 chord/pair/f'),
  },
  'god-rest-ye-merry-gentlemen': {
    idea: 'Minor-mode verse over a spare bass, a walking bass for the middle lines, thirds and the strongest bass for the refrain.',
    phrases: P('1-4 bar/after/mp b; 5-8 chord/line/mp; 9-12 walk/line/mf; 13-15 chord/pair/mf; 16-19 walk/pair/f'),
  },
  'good-king-wenceslas': {
    idea: 'The hymn\'s own bass, thinned to the strong beats at first and given in full as the verse rises; thirds from the third line.',
    phrases: P('1-4 bar/after/mp b; 5-8 chord/line/mp; 9-12 chord/pair/mf; 13-17 chord/pair/f'),
  },
  'hark-the-herald-angels-sing': {
    idea: 'Hymn bass throughout; the two "Joyful, all ye nations" sequences are pulled back to an after-beat line so the last eight bars can open out.',
    phrases: P('1-4 bar/line/mp; 5-8 chord/line/mp; 9-12 bar/after/p b; 13-16 chord/pair/mf; 17-20 chord/pair/f'),
  },
  'in-the-bleak-midwinter': {
    idea: 'Very spare and quiet: strong-beat bass, one line, a drone with a slow broken chord for the third line, a plain close.',
    phrases: P('1-4 bar/after/pp b; 5-8 bar/line/p; 9-12 pedal/roll/p; 13-16 chord/line/mp'),
  },
  'it-came-upon-the-midnight-clear': {
    idea: 'Lilting 6/8: after-beat line, sustained line, a rolling figure for the contrasting third line, thirds for the return.',
    phrases: P('1-4 bar/after/p b; 5-8 bar/line/mp; 9-12 chord/roll/mp; 13-16 chord/pair/mf'),
  },
  'jingle-bells': {
    idea: 'Verse over a still bass that starts to walk at each line end; the chorus changes to a root-and-fifth bass with a broken chord, then thirds for its second half.',
    phrases: P('1-4 bar/after/mp b; 5-8 walk/after/mp; 9-12 bar/line/mp; 13-16 walk/line/mf; 17-20 pulse/roll/mf; 21-24 walk/roll/mf; 25-28 pulse/pair/f; 29-32 walk/pair/f'),
  },
  'jolly-old-st-nicholas': {
    idea: 'Light and short-breathed: after-beat line, a moving line, a broken chord for the third line, thirds over a walking bass to finish.',
    phrases: P('1-4 bar/after/p b; 5-8 chord/line/mp; 9-12 bar/roll/mp; 13-16 walk/pair/mf'),
  },
  'joy-to-the-world': {
    idea: 'Firm from the first descending scale; a tonic drone under "let every heart" and "and heaven and nature sing" (where the chart stays on D), released into a walking bass for the last line.',
    phrases: P('1-4 bar/line/mf; 5-7 walk/pair/mf; 8-11 pedal/roll/mp; 12-15 pedal/after/mp; 16-19 walk/pair/f'),
  },
  'o-christmas-tree': {
    idea: 'A B A in twelve bars: light A, a broken chord through the middle, thirds for the return.',
    phrases: P('1-4 bar/after/mp b; 5-8 chord/roll/mp; 9-12 chord/pair/mf'),
  },
  'o-come-all-ye-faithful': {
    idea: 'Hymn bass; the three "O come, let us adore him" build from an after-beat line to thirds.',
    phrases: P('1-4 bar/line/mp; 5-8 chord/line/mp; 9-12 bar/after/p b; 13-16 chord/line/mp; 17-20 chord/pair/f'),
  },
  'o-come-o-come-emmanuel': {
    idea: 'Chant-like: the source bass moves every eighth, so the backing keeps only its strong beats and one slow line; thirds arrive with "Rejoice".',
    phrases: P('1-2 bar/line/p; 3-4 bar/line/mp; 5-6 bar/after/mp; 7-9 bar/pair/mf',
      { 9: { bass: 'C3@0+240 B2@960+480 E3@1440+480' } }), // review: B2 ends at beat 4, the source's E3 closes the song
  },
  'o-little-town-of-bethlehem': {
    idea: 'Quiet hymn: after-beat line, sustained line, a slow broken chord for the third line, thirds to close.',
    phrases: P('1-4 bar/after/p b; 5-8 bar/line/mp; 9-12 bar/roll/p; 13-16 chord/pair/mp'),
  },
  'silent-night': {
    idea: 'A tonic drone with a rocking figure from the start, one sustained line for the middle, thirds over a moving bass for "sleep in heavenly peace".',
    phrases: P('1-4 pedal/roll/pp; 5-8 chord/line/p; 9-12 walk/pair/mp'),
  },
  'the-first-noel': {
    idea: 'Three eight-bar lines: the first thin, the second with a moving bass and thirds, the refrain on a tonic drone with a broken chord before a full close.',
    phrases: P('1-4 bar/after/p b; 5-8 bar/line/mp; 9-12 chord/line/mp; 13-16 chord/pair/mp; 17-20 pedal/roll/mp; 21-24 chord/pair/mf',
      { 8: { bass: 'D2@0+960 A2@960+480*0.8', line: 'D4@0+960' }, 21: { line: 'F#3@0+960*1.06 D4@960+480' } }), // review: quiet A2 instead of the removed C#; D4 instead of G3
  },
  'the-holly-and-the-ivy': {
    idea: 'The pilot\'s plan inside the chart harmony: bass and one line, then a walking bass with thirds; the refrain opens on a tonic drone with a rolling line (the drone gives way wherever the chart leaves F) and closes with the fullest writing.',
    phrases: P('1-4 chord/line/mp; 5-8 chord/pair/mp; 9-12 pedal/roll/p; 13-16 chord/pair/mf'),
  },
  'we-three-kings': {
    idea: 'Minor verse kept low and thin, growing by line; the major refrain changes to a tonic drone with a broken chord and ends over a walking bass in thirds.',
    phrases: P('1-4 bar/after/p b; 5-8 chord/line/mp; 9-12 walk/line/mp; 13-16 chord/pair/mf; 17-20 pedal/roll/mp; 21-24 chord/roll/mp; 25-28 pedal/pair/mf; 29-32 walk/pair/f'),
  },
  'we-wish-you-a-merry-christmas': {
    idea: 'Quick waltz: after-beat line, a walking bass into the first close, held thirds for "Good tidings", walking bass and thirds to end.',
    phrases: P('1-4 bar/after/mp b; 5-8 walk/line/mf; 9-12 chord/pair/mp; 13-16 walk/pair/f'),
  },
  'what-child-is-this': {
    idea: 'Minor 6/8 verse over a spare bass and one line; the refrain lifts with a rolling figure and closes in thirds.',
    phrases: P('1-4 bar/after/p b; 5-8 chord/line/mp; 9-12 chord/roll/mf; 13-16 chord/pair/mf'),
  },
};
