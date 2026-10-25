import { test } from 'node:test';
import assert from 'node:assert/strict';
import { abcBodyOnly, extractBlock, extractJson, lengthStr, parseAbc, scoreToAbc, type Score } from '../src/abc-io.ts';
import { bars, chordsFromBars, chordsPerBar, loadS5Song, manifest, melodyAbc, melodyListing } from '../src/songs.ts';
import { chordAgreement, chordToneFit, playability, verticals } from '../src/theory.ts';

const key = (n: { tick: number; dur: number; midi: number }) => `${n.tick}/${n.dur}/${n.midi}`;
/** What a monophonic ABC voice can hold: the writer truncates a note that overlaps the next one
 * (some SATB soprano lines from Mutopia overlap, e.g. What Child Is This). */
const monophonic = <T extends { tick: number; dur: number }>(ns: T[]) =>
  ns.map((n, i) => (i + 1 < ns.length && n.tick + n.dur > ns[i + 1].tick ? { ...n, dur: ns[i + 1].tick - n.tick } : n));

test('lengthStr', () => {
  assert.equal(lengthStr(240, 240), '');
  assert.equal(lengthStr(480, 240), '2');
  assert.equal(lengthStr(120, 240), '/');
  assert.equal(lengthStr(360, 240), '3/2');
  assert.equal(lengthStr(160, 240), '2/3');
});

for (const e of manifest()) {
  test(`melody + chords round-trip through ABC: ${e.id}`, () => {
    const s = loadS5Song(e.id);
    const abc = melodyAbc(s, s.current);
    const back = parseAbc(abc) as Score;
    assert.deepEqual(back.notes.map(key), monophonic(s.melody).map(key));
    assert.deepEqual(back.chords.map((c) => `${c.tick}:${c.symbol}`), s.current.map((c) => `${c.tick}:${c.symbol}`));
    assert.equal(back.endTick, s.score.endTick);
    assert.deepEqual(back.barTicks, bars(s.score).slice(1).map((b) => b.start));
  });
  test(`bar chord lists round-trip: ${e.id}`, () => {
    const s = loadS5Song(e.id);
    const perBar = chordsPerBar(s.score, s.current);
    const { chords, errors } = chordsFromBars(s.score, perBar);
    assert.deepEqual(errors, []);
    assert.ok(chordAgreement(s.score, chords, s.current).exact >= 0.95);
  });
}

test('listing, fit and playability on The Holly and the Ivy', () => {
  const s = loadS5Song('the-holly-and-the-ivy');
  const listing = melodyListing(s.score, s.melody);
  assert.match(listing, /^Bar 1 \(pickup\) \[1 beat\]: 3:/);
  const fit = chordToneFit(s.score, s.melody, s.current);
  assert.ok(fit.all > 0.4 && fit.all <= 1);
  // Melody line only: since 2026-10-25 S5's Holly is SATB (the full texture has a few spots).
  const p = playability(s.score, s.melody);
  assert.equal(p.violations, 0);
});

test('verticals: parallel fifths and dissonance', () => {
  const m = [{ tick: 0, dur: 480, midi: 60, voice: '1' }, { tick: 480, dur: 480, midi: 62, voice: '1' }];
  const u = [{ tick: 0, dur: 480, midi: 67, voice: '2' }, { tick: 480, dur: 480, midi: 69, voice: '2' }];
  const v = verticals(m, u);
  assert.equal(v.parallels, 1);
  assert.equal(v.dissonant, 0);
  assert.equal(v.aboveRatio, 1);
});

test('reply parsing', () => {
  assert.equal(extractBlock('<think>hmm</think>\nHere:\n```abc\nX:1\nK:C\nCDE|\n```', 'abc'), 'X:1\nK:C\nCDE|');
  assert.deepEqual(extractJson('```json\n{"bars":[["C"]]}\n```'), { bars: [['C']] });
  assert.equal(abcBodyOnly('X:1\nL:1/8\nK:F\n"F"A2 B2 | c4 |]\n% comment'), '"F"A2 B2 | c4 |]');
});
