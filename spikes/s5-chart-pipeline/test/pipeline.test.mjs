import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAbc } from '../src/abc.mjs';
import { midiToScore, readMidi, writeMidi, meta, noteEvents } from '../src/midi.mjs';
import { parseMusicXml } from '../src/musicxml.mjs';
import { pitchName, naturalSlot, beatGrid, measureStarts, PPQ } from '../src/score.mjs';
import { assignRoles } from '../src/arrange.mjs';
import { assignBells, evaluateRinger, PROFILES } from '../src/assign.mjs';
import { buildChart, buildPart, fitHandbellSet, formSong, FORMAT, isChartFormat } from '../src/chart.mjs';
import { expandForm, transposeSymbol, verseSchedule, windowsFor } from '../src/form.mjs';
import { ARRANGEMENTS, TIERS, jain, harmonyRegions } from '../src/parts.mjs';
import { exportCloneHero, laneOf, CH_TRACKS } from '../src/export.mjs';
import { loadSong } from '../src/pipeline.mjs';
import { validate } from '../src/validate.mjs';
import { buildHarmony, backingStyle, BACKING_STYLES } from '../src/harmony.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'songs', 'manifest.json'), 'utf8'));
const names = (notes) => notes.map((n) => pitchName(n.midi));
const MUTOPIA_HOLLY = { id: 'mutopia-holly', file: '../sources/mutopia/thehollyandtheivy.mid', format: 'midi', options: { pickupTicks: 480 } };

test('ABC: pitches, key signature, lengths, chord symbols', () => {
  const s = parseAbc(readFileSync(join(root, 'songs', 'jingle-bells.abc'), 'utf8'));
  assert.equal(s.title, 'Jingle Bells');
  // "Dashing through the snow" starts on the low D and rises to B (#30).
  assert.deepEqual(names(s.notes.slice(0, 7)), ['D4', 'B4', 'A4', 'G4', 'D4', 'D4', 'D4']);
  assert.deepEqual(s.notes.slice(4, 7).map((n) => n.dur), [3 * PPQ, PPQ / 2, PPQ / 2]);
  assert.ok(names(s.notes).includes('F#4'), 'key of G sharpens F');
  assert.equal(s.endTick, 32 * 4 * PPQ);
  assert.equal(s.chords[0].symbol, 'G');
  assert.equal(s.tempos[0].usPerQuarter, 500000);
});

test('ABC: pickup bar and compound-meter tempo', () => {
  const w = parseAbc(readFileSync(join(root, 'songs', 'we-wish-you-a-merry-christmas.abc'), 'utf8'));
  assert.equal(measureStarts(w)[1], PPQ, 'one-beat pickup');
  assert.equal(beatGrid(w).find((b) => b.downbeat && b.tick > 0).tick, PPQ);
  const sn = parseAbc(readFileSync(join(root, 'songs', 'silent-night.abc'), 'utf8'));
  assert.equal(Math.round(60e6 / sn.tempos[0].usPerQuarter), 84, 'dotted-quarter 56 = quarter 84');
  assert.deepEqual(sn.timeSigs[0], { tick: 0, num: 6, den: 8 });
});

test('ABC: ties, accidentals within a bar, and unsupported constructs', () => {
  const s = parseAbc('X:1\nT:t\nL:1/4\nM:4/4\nK:F\nB ^F F B- | B =B B2 |]\n');
  assert.deepEqual(names(s.notes), ['A#4', 'F#4', 'F#4', 'A#4', 'B4', 'B4']);
  assert.equal(s.notes[3].dur, 2 * PPQ, 'tie merged across bar line');
  assert.throws(() => parseAbc('X:1\nK:C\n|: C D :|\n'), /Repeat/);
});

test('ABC lead sheets added 2026-10-25: opening notes in the right octave (verified against PD/CC0 references)', () => {
  const open = {
    'god-rest-ye-merry-gentlemen': ['E4', 'E4', 'B4', 'B4', 'A4'],
    'we-three-kings': ['B4', 'A4', 'G4', 'E4', 'F#4'],
    'angels-we-have-heard-on-high': ['A4', 'A4', 'A4', 'C5', 'C5'],
    'o-christmas-tree': ['C4', 'F4', 'F4', 'F4', 'G4'],
    'jolly-old-st-nicholas': ['C#5', 'C#5', 'C#5', 'C#5', 'B4'],
    'ding-dong-merrily-on-high': ['A#4', 'A#4', 'C5', 'A#4', 'A4'],
    'auld-lang-syne': ['C4', 'F4', 'F4', 'F4', 'A4'],
  };
  for (const [id, first] of Object.entries(open)) {
    const entry = manifest.songs.find((e) => e.id === id);
    const s = parseAbc(readFileSync(join(root, 'songs', entry.file), 'utf8'));
    assert.deepEqual(names(s.notes.slice(0, 5)), first, id);
    assert.ok(s.chords.length > 0, `${id}: lead sheet has chord symbols`);
  }
  // Ding Dong's Gloria run starts an octave above the verse.
  const dd = parseAbc(readFileSync(join(root, 'songs', 'ding-dong-merrily-on-high.abc'), 'utf8'));
  assert.equal(pitchName(dd.notes.find((n) => n.tick === 8 * 4 * PPQ).midi), 'F5');
  // Jolly Old bar 7 ("What I'm going to say") rises from the leading tone (1881 printing).
  const jo = parseAbc(readFileSync(join(root, 'songs', 'jolly-old-st-nicholas.abc'), 'utf8'));
  assert.deepEqual(names(jo.notes.filter((n) => n.tick >= 6 * 2 * PPQ && n.tick < 8 * 2 * PPQ)), ['G#4', 'A4', 'B4', 'C#5', 'B4']);
});

test('ABC multi-voice SATB: Holly and the Ivy soprano equals the Mutopia melody; voices become roles', () => {
  const entry = manifest.songs.find((e) => e.id === 'the-holly-and-the-ivy');
  assert.equal(entry.format, 'abc');
  const { score, roleNotes } = loadSong(entry, join(root, 'songs'));
  assert.deepEqual([...new Set(score.notes.map((n) => n.voice))].sort(), ['A', 'B', 'S', 'T']);
  for (const v of ['S', 'A', 'T', 'B']) {
    const end = Math.max(...score.notes.filter((n) => n.voice === v).map((n) => n.tick + n.dur));
    assert.equal(end, score.endTick, `voice ${v} fills every bar`);
  }
  const ref = loadSong(MUTOPIA_HOLLY, join(root, 'songs')).score.notes;
  const rel = (ns) => ns.map((n) => `${n.tick - ns[0].tick}:${pitchName(n.midi)}`);
  assert.deepEqual(rel(roleNotes.filter((n) => n.role === 'melody')), rel(ref));
  assert.ok(roleNotes.filter((n) => n.role === 'melody').every((n) => n.voice === 'S'));
  assert.ok(roleNotes.filter((n) => n.role === 'bass').every((n) => n.voice === 'B'));
  assert.ok(roleNotes.filter((n) => n.role === 'inner').length > 40, 'alto + tenor');
  const h = buildHarmony(score, roleNotes);
  assert.equal(h.source, 'lead-sheet', 'chord symbols on the first voice feed the harmony block');
  assert.equal(h.chords.at(-1).symbol, 'F');
});

test('ABC multi-voice: Carol of the Bells (our arrangement of the PD Shchedryk material)', () => {
  const entry = manifest.songs.find((e) => e.id === 'carol-of-the-bells');
  const { score, roleNotes } = loadSong(entry, join(root, 'songs'));
  assert.deepEqual([score.timeSigs[0].num, score.timeSigs[0].den], [3, 4]);
  assert.equal(score.endTick, 44 * 3 * PPQ);
  const melody = roleNotes.filter((n) => n.role === 'melody');
  // Ostinato B-flat A B-flat G (quarter, two eighths, quarter) opens the piece alone.
  assert.deepEqual(names(melody.slice(0, 4)), ['A#4', 'A4', 'A#4', 'G4']);
  assert.deepEqual(melody.slice(0, 4).map((n) => n.dur), [PPQ, PPQ / 2, PPQ / 2, PPQ]);
  assert.ok(roleNotes.slice(0, 16).every((n) => n.role === 'melody'), 'intro: ostinato alone');
  assert.ok(melody.every((n) => n.voice === '1'));
  assert.ok(roleNotes.filter((n) => n.role === 'bass').every((n) => n.voice === '3'));
  assert.ok(roleNotes.some((n) => n.role === 'inner' && n.voice === '2'));
  // The rising scale uses E natural and F sharp despite the G minor signature.
  assert.ok(names(melody).includes('E4') && names(melody).includes('F#4'));
  assert.equal(buildHarmony(score, roleNotes).source, 'lead-sheet');
});

test('MIDI: write -> read round trip', () => {
  const notes = [[0, 480, 60], [480, 240, 64], [480, 240, 67], [720, 960, 72]];
  const bytes = writeMidi({
    tracks: [
      { name: 'tempo', events: [meta.tempo(0, 600000), meta.timeSig(0, 3, 4)] },
      { name: 'bells', events: notes.flatMap(([t, d, m]) => noteEvents(t, d, m)) },
    ],
  });
  const s = midiToScore(bytes);
  assert.deepEqual(s.notes.map((n) => [n.tick, n.dur, n.midi]), notes);
  assert.equal(s.tempos[0].usPerQuarter, 600000);
  assert.deepEqual([s.timeSigs[0].num, s.timeSigs[0].den], [3, 4]);
  assert.equal(s.meta.voiceNames.t1c0, 'bells');
});

test('MIDI: Mutopia SATB file -> soprano melody via top-line extraction', () => {
  const entry = manifest.songs.find((e) => e.id === 'it-came-upon-the-midnight-clear');
  const { roleNotes } = loadSong(entry, join(root, 'songs'));
  const melody = roleNotes.filter((n) => n.role === 'melody');
  // Soprano opening from carol.ly: f'8 d''4 a'8 c'' bes' g' f'4 g'8 (B-flat major)
  assert.deepEqual(names(melody.slice(0, 8)), ['F4', 'D5', 'A4', 'C5', 'A#4', 'G4', 'F4', 'G4']);
  assert.ok(roleNotes.filter((n) => n.role === 'bass').length > 40);
});

// Soprano line of a Mutopia hymntune .ly (absolute pitches; `Soprano = { ... }`) -> [{ tick, midi }].
function lySoprano(ly) {
  const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  const body = /^Soprano = \{([\s\S]*?)\}\s*\}?\s*$/m.exec(ly)[1]
    .replace(/\\(time|partial|key)\s+\S+(\s+\\\w+)?/g, '').replace(/\\bar "[^"]*"/g, '').replace(/\\\w+/g, '');
  const out = [];
  let dur = PPQ;
  let t = 0;
  let tie = false;
  for (const tok of body.match(/[a-gsr](?:is|es|s)*[',]*\d*\.?|~/g) || []) {
    if (tok === '~') { tie = true; continue; }
    const [, letter, acc, oct, len, dot] = /^([a-gsr])((?:is|es|s)*)([',]*)(\d*)(\.?)$/.exec(tok);
    if (len) dur = ((4 * PPQ) / Number(len)) * (dot ? 1.5 : 1);
    if (letter !== 'r' && letter !== 's') {
      const alter = (acc.match(/is/g) || []).length - (acc.match(/es|(?<=[ae])s/g) || []).length;
      const octave = 3 + (oct.match(/'/g) || []).length - (oct.match(/,/g) || []).length;
      const midi = 12 * (octave + 1) + PC[letter] + alter;
      if (!(tie && out.at(-1)?.midi === midi)) out.push({ tick: t, midi });
    }
    tie = false;
    t += dur;
  }
  return out;
}

test('MIDI: every Mutopia SATB melody matches the soprano line of its .ly source', () => {
  let checked = 0;
  for (const entry of manifest.songs.filter((e) => e.format === 'midi')) {
    const ly = readFileSync(join(root, 'songs', entry.file.replace(/\.mid$/, '.ly')), 'utf8');
    if (!/^Soprano = /m.test(ly)) continue;
    const { roleNotes } = loadSong(entry, join(root, 'songs'));
    const melody = roleNotes.filter((n) => n.role === 'melody').map((n) => `${n.tick}:${pitchName(n.midi)}`);
    assert.deepEqual(melody, lySoprano(ly).map((n) => `${n.tick}:${pitchName(n.midi)}`), entry.id);
    checked++;
  }
  assert.ok(checked >= 9, `checked ${checked} songs`);
});

test('manifest timeSig override re-bars a source engraved in the wrong meter', () => {
  const entry = manifest.songs.find((e) => e.id === 'away-in-a-manger');
  assert.equal(entry.options.timeSig, '3/4');
  const { score } = loadSong(entry, join(root, 'songs'));
  assert.deepEqual([score.timeSigs[0].num, score.timeSigs[0].den], [3, 4]);
  const starts = measureStarts(score);
  assert.deepEqual(starts.slice(0, 4), [0, PPQ, 4 * PPQ, 7 * PPQ], 'one-beat pickup, then 3/4 bars');
});

test('MusicXML: divisions, pickup, backup, chord, tie, rest, harmony, tempo', () => {
  const s = parseMusicXml(readFileSync(join(root, 'test', 'fixtures', 'fixture.musicxml'), 'utf8'));
  const v1 = s.notes.filter((n) => n.voice === 'P1v1');
  const v2 = s.notes.filter((n) => n.voice === 'P1v2');
  assert.deepEqual(names(v1), ['D4', 'G4', 'G4', 'A4', 'G4', 'F#4', 'E4']);
  assert.equal(v1[6].dur, 2 * PPQ, 'tied E4 merged');
  assert.deepEqual(v2.map((n) => [pitchName(n.midi), n.tick]), [['G2', 480], ['D3', 480], ['C3', 1920]]);
  assert.deepEqual(s.barTicks, [480, 1920]);
  assert.equal(Math.round(60e6 / s.tempos[0].usPerQuarter), 144);
  assert.deepEqual(s.chords.map((c) => [c.symbol, c.tick, c.dur]), [['major', 480, 1440], ['C', 1920, 1440]]);
  const roles = assignRoles(s);
  assert.equal(roles.filter((n) => n.role === 'melody').length, 7);
  assert.deepEqual(names(roles.filter((n) => n.role === 'bass')), ['G2', 'C3']);
});

test('handbell convention: accidentals travel with the natural below', () => {
  assert.equal(pitchName(naturalSlot(61)), 'C4'); // C#4
  assert.equal(pitchName(naturalSlot(70)), 'A4'); // A#4 / Bb4
  assert.equal(pitchName(naturalSlot(66)), 'F4'); // F#4
  const notes = [60, 61, 62, 63, 64, 65, 66, 67].map((m, i) => ({ time: i * 0.5, midi: m }));
  const { ringers } = assignBells(notes, 2, PROFILES.handbell);
  for (const r of ringers) {
    for (const b of r.bells) assert.ok(r.slots.includes(naturalSlot(b)));
  }
  const all = ringers.flatMap((r) => r.bells);
  assert.equal(new Set(all).size, 8, 'every bell assigned exactly once');
});

test('assignment avoids impossible fast alternations when it can', () => {
  // C4 and D4 alternate every 100 ms; E4/F4 slow. A phone with one strike at a time cannot
  // alternate C/D that fast, so C and D must go to different ringers.
  const notes = [];
  for (let i = 0; i < 20; i++) notes.push({ time: i * 0.1, midi: i % 2 ? 62 : 60 });
  for (let i = 0; i < 4; i++) notes.push({ time: 3 + i, midi: 64 + (i % 2) });
  const { ringers } = assignBells(notes, 2, PROFILES['phone-2zone']);
  const owner = (m) => ringers.findIndex((r) => r.bells.includes(m));
  assert.notEqual(owner(60), owner(62));
  const ev = evaluateRinger(notes.filter((n) => [60, 62].includes(n.midi)), PROFILES['phone-2zone']);
  assert.ok(ev.fastSwitch > 0);
});

test('handbell set fit', () => {
  assert.equal(fitHandbellSet([67, 91]).set, '2oct');
  assert.deepEqual(fitHandbellSet([43, 76]), { set: '3oct', label: '3 octaves C4–C7 (37 bells)', transposeSemitones: 17, span: 33 });
});

test('every committed chart validates against the schema and matches a fresh build', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schema', 'chart.schema.json'), 'utf8'));
  const files = readdirSync(join(root, 'charts')).filter((f) => f.endsWith('.json'));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const chart = JSON.parse(readFileSync(join(root, 'charts', f), 'utf8'));
    assert.deepEqual(validate(schema, chart), [], f);
    const tune = (p) => p.notes.filter((n) => n.role === 'melody').length + (p.guide ?? []).filter((n) => n.role === 'melody').length;
    const full = chart.parts.find((p) => p.difficulty === 'easy');
    for (const p of chart.parts) {
      for (const n of p.notes) assert.ok(p.ringers[n.ringer].bells.includes(n.bell), `${f}: note bell belongs to its ringer`);
      // The tune is never dropped: ringers play it, or (super easy) the host's guide does.
      assert.equal(tune(p), tune(full), `${f} ${p.difficulty}: melody never dropped`);
    }
  }
  const entry = manifest.songs[0];
  const broken = JSON.parse(readFileSync(join(root, 'charts', `${entry.id}.json`), 'utf8'));
  delete broken.song.license;
  broken.parts[0].notes[0].bell = 'H9';
  assert.equal(validate(schema, broken).length, 2, 'validator catches errors');
  const { score, roleNotes, song } = loadSong(entry, join(root, 'songs'));
  const fresh = buildChart({ score, roleNotes, song, ringerCounts: [4], arrangements: ['balanced'] });
  const committed = JSON.parse(readFileSync(join(root, 'charts', `${entry.id}.json`), 'utf8'));
  assert.deepEqual(fresh, committed, 'deterministic and up to date (run node build.mjs)');
});

test('chart format id: writes go-go-harmoniyo.chart, still reads the legacy handbell-hero.chart', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schema', 'chart.schema.json'), 'utf8'));
  const chart = JSON.parse(readFileSync(join(root, 'charts', `${manifest.songs[0].id}.json`), 'utf8'));
  assert.equal(chart.format, FORMAT);
  assert.equal(FORMAT, 'go-go-harmoniyo.chart');
  assert.deepEqual(validate(schema, { ...chart, format: 'handbell-hero.chart' }), []);
  assert.equal(validate(schema, { ...chart, format: 'other.chart' }).length, 1);
  assert.ok(isChartFormat('go-go-harmoniyo.chart') && isChartFormat('handbell-hero.chart'));
  assert.ok(!isChartFormat('other.chart'));
});

test('Clone Hero / YARG export: track names and GH note ranges', () => {
  const entry = manifest.songs.find((e) => e.id === 'silent-night');
  const { score, roleNotes, song } = loadSong(entry, join(root, 'songs'));
  const formed = formSong(score, roleNotes, 'short');
  const chart = buildChart({ score, roleNotes, song, ringerCounts: [4], formed });
  const { midi } = exportCloneHero(formed.score, chart, 4);
  const parsed = readMidi(midi);
  const dec = new TextDecoder('latin1');
  const trackNames = parsed.tracks.map((t) => dec.decode(t.find((e) => e.meta === 3)?.bytes ?? new Uint8Array()));
  assert.deepEqual(trackNames.slice(1, 5), CH_TRACKS.slice(0, 4));
  assert.deepEqual(trackNames.slice(5), ['BEAT', 'EVENTS']);
  for (const t of parsed.tracks.slice(1, 5)) {
    for (const e of t.filter((x) => x.type === 0x90)) {
      const ok = [60, 72, 84, 96].some((b) => e.d1 >= b && e.d1 <= b + 4);
      assert.ok(ok, `note ${e.d1} in a GH difficulty range`);
    }
  }
  assert.equal(laneOf(5, 6), 4);
  assert.equal(laneOf(2, 3), 2);
});

test('harmony: lead-sheet chords + beat grid carried into the chart (format 0.2)', () => {
  const load = (id) => loadSong(manifest.songs.find((e) => e.id === id), join(root, 'songs'));
  const jb = load('jingle-bells');
  const h = buildHarmony(jb.score, jb.roleNotes);
  assert.equal(h.source, 'lead-sheet');
  assert.equal(h.style, 'sleigh-ride');
  assert.deepEqual(h.chords.slice(0, 4).map((c) => [c.symbol, c.time, c.durSec]), [['G', 0, 2], ['G', 2, 2], ['G', 4, 2], ['C', 6, 2]]);
  assert.deepEqual(h.chords[3].tones, [0, 4, 7]);
  assert.equal(h.beats.length, 32 * 4);
  assert.deepEqual(h.beats.slice(0, 5).map((b) => [b.time, b.bar, b.beat, b.div, b.strong, b.chord]), [[0, 1, 0, 2, true, 0], [0.5, 1, 1, 2, false, 0], [1, 1, 2, 2, true, 0], [1.5, 1, 3, 2, false, 0], [2, 2, 0, 2, true, 1]]);
  // Compound meter: dotted-quarter beats, 3 subdivisions; G7 starts mid-bar on beat 2.
  const sn = buildHarmony(load('silent-night').score, load('silent-night').roleNotes);
  assert.equal(sn.style, 'gentle');
  assert.equal(sn.beats.length, 12 * 2);
  assert.ok(sn.beats.every((b) => b.div === 3));
  assert.ok(Math.abs(sn.beats[1].time - 60 / 56) < 0.001);
  const g7 = sn.chords.findLastIndex((c) => c.symbol === 'G7');
  assert.equal(sn.beats.find((b) => b.bar === 11 && b.beat === 1).chord, g7);
  // Pickup without a chord symbol: the pickup beat keeps its bar position and has no chord.
  const ww = buildHarmony(load('we-wish-you-a-merry-christmas').score, load('we-wish-you-a-merry-christmas').roleNotes);
  assert.deepEqual([ww.beats[0].beat, ww.beats[0].chord, ww.beats[1].beat, ww.beats[1].chord], [2, null, 0, 0]);
  assert.equal(ww.style, 'waltz');
});

test('harmony: beat times follow tempo changes', () => {
  const s = parseAbc('X:1\nT:t\nL:1/4\nM:4/4\nQ:1/4=120\nK:C\n"C"C D E F | "G"G A B c |\nQ:1/4=60\n"F"c B A G | "C"C4 |]\n');
  const h = buildHarmony(s, s.notes.map((n) => ({ ...n, role: 'melody' })));
  assert.deepEqual(h.beats.map((b) => b.time), [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(h.chords.map((c) => [c.symbol, c.time, c.durSec]), [['C', 0, 2], ['G', 2, 2], ['F', 4, 4], ['C', 8, 4]]);
});

test('harmony: chords inferred for scores without chord symbols', () => {
  const load = (id) => loadSong(manifest.songs.find((e) => e.id === id), join(root, 'songs'));
  const gk = load('good-king-wenceslas');
  const h = buildHarmony(gk.score, gk.roleNotes);
  assert.equal(h.source, 'inferred');
  assert.equal(h.chords[0].symbol, 'A', 'A major tonic');
  assert.equal(h.chords.at(-1).symbol, 'A', 'ends on the tonic');
  // The melody-only Mutopia Holly and the Ivy (kept in sources/ as provenance for the SATB ABC).
  const hi = loadSong(MUTOPIA_HOLLY, join(root, 'songs'));
  const hh = buildHarmony(hi.score, hi.roleNotes);
  assert.equal(hh.source, 'inferred');
  assert.equal(hh.chords.at(-1).symbol, 'F', 'melody-only song still ends on the tonic');
  for (const c of [...h.chords, ...hh.chords]) assert.ok(c.dur > 0 && c.tones.includes(c.root));
  // Deterministic, and contiguous from tick 0 to the end.
  assert.deepEqual(buildHarmony(gk.score, gk.roleNotes), h);
  assert.equal(h.chords[0].tick, 0);
  for (let i = 1; i < h.chords.length; i++) assert.equal(h.chords[i].tick, h.chords[i - 1].tick + h.chords[i - 1].dur);
  assert.equal(h.chords.at(-1).tick + h.chords.at(-1).dur, gk.score.endTick);
  assert.throws(() => backingStyle({ meta: { 'backing-style': 'disco' }, timeSigs: [], tempos: [] }), /Unknown backing style/);
  assert.ok(BACKING_STYLES.includes(backingStyle({ meta: {}, timeSigs: [{ tick: 0, num: 3, den: 4 }], tempos: [{ tick: 0, usPerQuarter: 500000 }] })));
});

test('harmony is optional: a 0.1 chart without it still validates', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schema', 'chart.schema.json'), 'utf8'));
  const chart = JSON.parse(readFileSync(join(root, 'charts', 'jingle-bells.json'), 'utf8'));
  assert.equal(chart.formatVersion, '0.3.0');
  assert.ok(chart.harmony.chords.length > 0);
  const old = { ...chart, formatVersion: '0.1.0' };
  delete old.harmony;
  delete old.form;
  assert.deepEqual(validate(schema, old), []);
  const bad = structuredClone(chart);
  bad.harmony.chords[0].root = 12;
  bad.harmony.source = 'guess';
  assert.equal(validate(schema, bad).length, 2);
});

// ── song form, role-aware parts, super easy (chart format 0.3) ─────────────────
const formCache = new Map();
const formed = (id, form = 'full') => {
  const k = `${id}|${typeof form === 'string' ? form : JSON.stringify(form)}`;
  if (!formCache.has(k)) {
    const { score, roleNotes } = loadSong(manifest.songs.find((e) => e.id === id), join(root, 'songs'));
    formCache.set(k, formSong(score, roleNotes, form));
  }
  return formCache.get(k);
};
const midiOfBell = (b) => ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].indexOf(b.replace(/-?\d+$/, '')) + 12 * (Number(/-?\d+$/.exec(b)[0]) + 1);

test('form: verse schedule develops, chord symbols transpose', () => {
  assert.deepEqual(verseSchedule(2), ['light', 'finale']);
  assert.deepEqual(verseSchedule(5), ['light', 'full', 'descant', 'quiet', 'finale']);
  assert.deepEqual(verseSchedule(1), ['once']);
  assert.equal(transposeSymbol('D7', 2), 'E7');
  assert.equal(transposeSymbol('G/B', 2), 'A/C#');
  assert.equal(transposeSymbol('Bb', 2), 'C');
  // Windows sit on naturals, bass < harmony < tune < descant, disjoint.
  const w = windowsFor([{ midi: 62 }, { midi: 76 }], 2);
  assert.deepEqual([w.bass, w.harmony, w.descant], [[38, 49], [50, 61], [79, 90]]);
});

test('form: every song lands at 2–3 minutes, sections tile the timeline, short = the song once', () => {
  for (const entry of manifest.songs) {
    const f = formed(entry.id);
    const sec = f.toSec(f.score.endTick);
    assert.ok(sec >= 120 && sec <= 180, `${entry.id}: ${sec} s`);
    const s = f.sections;
    assert.equal(s[0].kind, 'intro');
    assert.equal(s.at(-1).kind, 'coda');
    assert.ok(s.filter((x) => x.kind === 'verse').length >= 2, entry.id);
    assert.equal(s[0].tick, 0);
    for (let i = 1; i < s.length; i++) assert.equal(s[i].tick, s[i - 1].endTick, `${entry.id}: sections contiguous`);
    assert.equal(s.at(-1).endTick, f.score.endTick);
    // The chord timeline is contiguous and covers the whole piece from the first chord.
    const ch = f.score.chords;
    for (let i = 1; i < ch.length; i++) assert.equal(ch[i].tick, ch[i - 1].tick + ch[i - 1].dur, entry.id);
    assert.equal(ch.at(-1).tick + ch.at(-1).dur, f.score.endTick);
    // Coda: ritardando into the held last bar.
    assert.ok(f.score.tempos.at(-1).usPerQuarter > f.score.tempos[0].usPerQuarter, `${entry.id}: ritardando`);
    const short = formed(entry.id, 'short');
    const { score } = loadSong(entry, join(root, 'songs'));
    assert.equal(short.sections.length, 1);
    // ABC: the short form's tune is the source's tune (multi-voice ABC: its melody voice).
    const tune = score.notes.filter((n) => !entry.options?.melodyVoice || n.voice === entry.options.melodyVoice);
    assert.deepEqual(short.melody.map((n) => [n.tick, n.midi]), entry.format === 'abc' ? tune.map((n) => [n.tick, n.midi]) : short.melody.map((n) => [n.tick, n.midi]));
  }
});

test('form: pickups overlap the previous bar, the last verse goes up a step, the descant sits above the tune', () => {
  const f = formed('we-wish-you-a-merry-christmas');
  const verses = f.segments.filter((s) => s.kind === 'verse');
  // One-beat pickup: verse 2 starts a beat before the bar line that ends verse 1.
  assert.equal(verses[1].downbeat - verses[1].start, PPQ);
  assert.equal(verses[1].downbeat, verses[0].end);
  const bars = measureStarts(f.score);
  const lens = bars.slice(1).map((t, i) => (bars[i + 2] ?? f.score.endTick) - t);
  assert.ok(lens.every((l) => l === 3 * PPQ), 'regular 3/4 bars after the pickup');
  const last = verses.at(-1);
  assert.equal(last.transpose, 2);
  assert.equal(f.segments[last.index - 1].kind, 'interlude');
  const first = f.melody.filter((n) => n.seg === verses[0].index).map((n) => [n.tick - verses[0].offset, n.midi]);
  const top = f.melody.filter((n) => n.seg === last.index).map((n) => [n.tick - last.offset, n.midi - 2]);
  assert.deepEqual(top, first, 'last verse = verse 1 up a whole step');
  const v1Chords = f.score.chords.filter((c) => c.seg === verses[0].index && c.tick >= verses[0].downbeat).map((c) => c.symbol);
  assert.equal(f.score.chords.find((c) => c.seg === last.index && c.tick >= last.downbeat).symbol, transposeSymbol(v1Chords[0], 2));
  // Interlude ends on the dominant seventh of the new key (A major: E7).
  assert.equal(f.score.chords.filter((c) => c.seg === last.index - 1).at(-1).symbol, 'E7');
  // Descant: only in developed sections, a chord tone at least a minor third above the tune.
  assert.ok(f.descant.length > 10);
  for (const d of f.descant) {
    const dev = f.segments[d.seg].dev;
    assert.ok(['descant', 'finale', 'coda'].includes(dev), dev);
    const under = f.melody.filter((n) => n.tick < d.tick + d.dur && n.tick + n.dur > d.tick);
    for (const n of under) assert.ok(d.midi >= n.midi + 3, `descant ${d.midi} over ${n.midi}`);
    const c = f.score.chords.find((x) => x.tick <= d.tick && d.tick < x.tick + x.dur);
    assert.ok(c.tones.includes(d.midi % 12));
    assert.ok(d.midi >= f.windows.descant[0] && d.midi <= f.windows.descant[1]);
  }
  // keyChange: false keeps one key.
  assert.ok(formed('we-wish-you-a-merry-christmas', { keyChange: false }).sections.every((s) => s.transpose === 0));
});

test('balanced parts: one role and one contiguous pitch region per ringer, every song', () => {
  const roleOfNote = { bass: 'bass', inner: 'harmony', melody: 'melody', descant: 'descant' };
  for (const entry of manifest.songs) {
    for (const [profile, k, tier] of [['phone-4zone', 4, 'medium'], ['phone-4zone', 4, 'hard'], ['handbell', 5, 'hard'], ['phone-4zone', 3, 'easy']]) {
      const p = buildPart(formed(entry.id), tier, k, profile, 'balanced');
      const where = `${entry.id} ${profile} ${tier} ×${k}`;
      assert.equal(p.ringers.length, k, where);
      for (const r of p.ringers) {
        const mine = p.notes.filter((n) => n.ringer === r.index);
        assert.ok(mine.every((n) => roleOfNote[n.role] === r.role), `${where}: ${r.name} plays only ${r.role}`);
        assert.ok(r.name && !/Ringer/.test(r.name), where);
      }
      // Regions: ringers are ordered low → high and their bell ranges do not interleave.
      const active = p.ringers.filter((r) => r.bells.length);
      for (let i = 1; i < active.length; i++) assert.ok(midiOfBell(active[i - 1].bells.at(-1)) < midiOfBell(active[i].bells[0]), `${where}: regions disjoint`);
      // Handbell convention: an accidental shares a ringer with the natural below it.
      for (const r of p.ringers) for (const b of r.bells.filter((x) => x.includes('#'))) {
        const nat = b.replace('#', '');
        assert.ok(!p.ringers.some((o) => o !== r && o.bells.includes(nat)), `${where}: ${b} with ${nat}`);
      }
      // A bass ringer's second bell is another bass bell (roles are pure, so this follows), and
      // medium/hard with 3+ ringers always have a bass part.
      if (k >= 3 && tier !== 'easy') assert.ok(p.ringers.some((r) => r.role === 'bass'), where);
    }
  }
});

test('balanced parts are fairer than the S5 0.2 by-range split on the phone game (corpus mean)', () => {
  const before = [];
  const after = [];
  const bellsBefore = [];
  const bellsAfter = [];
  for (const entry of manifest.songs) {
    for (const tier of ['easy', 'medium', 'hard']) {
      const b = buildPart(formed(entry.id), tier, 4, 'phone-4zone', 'by-range').metrics.fairness;
      const a = buildPart(formed(entry.id), tier, 4, 'phone-4zone', 'balanced').metrics.fairness;
      before.push(b.jain);
      after.push(a.jain);
      bellsBefore.push(b.bells[0]);
      bellsAfter.push(a.bells[0]);
    }
  }
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(mean(after) >= 0.85, `balanced fairness ${mean(after)}`);
  assert.ok(mean(after) >= mean(before) - 0.03, `balanced ${mean(after)} vs by-range ${mean(before)}`);
  // Fewer parts with a one-bell ringer. (Not the mean minimum bell count: balanced may give a
  // busy middle-of-the-tune ringer just two bells, e.g. A4/B-flat 4, which is fair by load.)
  const oneBell = (xs) => xs.filter((b) => b <= 1).length;
  assert.ok(oneBell(bellsAfter) <= oneBell(bellsBefore), `fewer one-bell ringers (${oneBell(bellsAfter)} vs ${oneBell(bellsBefore)})`);
  assert.equal(jain([1, 1, 1]), 1);
  assert.equal(jain([3, 0, 0]), 1 / 3);
});

test('chord split: up to three ringers ring one chord tone each, together', () => {
  assert.deepEqual(harmonyRegions([48, 59], 3), [[48, 52], [53, 56], [57, 59]]); // C–E | F–G | A–B
  for (const id of ['jingle-bells', 'silent-night', 'good-king-wenceslas']) {
    const f = formed(id);
    const p = buildPart(f, 'medium', 6, 'handbell', 'chord-split');
    const chordRingers = p.ringers.filter((r) => r.role === 'chord');
    assert.equal(chordRingers.length, 3, id);
    assert.deepEqual(chordRingers.map((r) => r.name), ['Chord low', 'Chord middle', 'Chord high']);
    const byTick = new Map();
    for (const n of p.notes.filter((x) => x.role === 'inner')) {
      const k = `${n.tick}:${n.ringer}`;
      assert.ok(!byTick.has(k), `${id}: one tone per chord ringer per hit`);
      byTick.set(k, n);
      const c = f.score.chords.find((x) => x.tick <= n.tick && n.tick < x.tick + x.dur);
      assert.ok(c.tones.includes(midiOfBell(n.bell) % 12), `${id}: chord tone`);
    }
    const hits = new Set(p.notes.filter((x) => x.role === 'inner').map((n) => n.tick));
    const full = [...hits].filter((t) => p.notes.filter((n) => n.tick === t && n.role === 'inner').length === 3).length;
    assert.ok(full / hits.size > 0.6, `${id}: most chords use all three ringers (${full}/${hits.size})`);
  }
  // Fewer chord ringers when the tune ringers could not hold the tune's bells otherwise (4 phones).
  const small = buildPart(formed('silent-night'), 'medium', 4, 'phone-4zone', 'chord-split');
  assert.deepEqual(small.ringers.map((r) => r.role), ['chord', 'melody', 'melody', 'melody']);
});

test('super easy: downbeats/long notes, ≥ 1 s apart, ≤ 3 bells per ringer, the host plays the rest', () => {
  for (const entry of manifest.songs) {
    const f = formed(entry.id);
    for (const k of [2, 4]) {
      const p = buildPart(f, 'super-easy', k, 'phone-4zone', 'balanced');
      const where = `${entry.id} ×${k}`;
      for (const r of p.ringers) assert.ok(r.bells.length <= 3, `${where}: ${r.bells.length} bells`);
      const tune = p.notes.filter((n) => n.role === 'melody');
      for (let i = 1; i < tune.length; i++) assert.ok(tune[i].time - tune[i - 1].time >= 0.999, `${where}: spacing ${tune[i].time - tune[i - 1].time}`);
      assert.equal(tune.length + p.guide.filter((n) => n.role === 'melody').length, f.melody.length, `${where}: tune complete with the guide`);
      const easy = buildPart(f, 'easy', k, 'phone-4zone', 'balanced');
      assert.ok(p.metrics.strikes < easy.metrics.strikes, where);
    }
  }
});

test('every arrangement × tier validates (format 0.3) and a 0.2-shaped chart still does', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schema', 'chart.schema.json'), 'utf8'));
  const { score, roleNotes, song } = loadSong(manifest.songs.find((e) => e.id === 'joy-to-the-world'), join(root, 'songs'));
  const chart = buildChart({ score, roleNotes, song, ringerCounts: [3], profile: 'phone-4zone', formed: formed('joy-to-the-world') });
  assert.deepEqual(validate(schema, chart), []);
  assert.deepEqual([...new Set(chart.parts.map((p) => p.arrangement))], ARRANGEMENTS);
  assert.deepEqual([...new Set(chart.parts.map((p) => p.difficulty))], TIERS);
  assert.ok(chart.harmony.beats.every((b) => Number.isInteger(b.section) && b.section < chart.form.sections.length));
  for (const p of chart.parts) {
    const ids = new Set(chart.bells.map((b) => b.id));
    for (const n of [...p.notes, ...(p.guide ?? [])]) assert.ok(ids.has(n.bell));
  }
  // Pre-0.3 readers' view: no form/arrangement/roles/guide, no super-easy part.
  const old = structuredClone(chart);
  old.formatVersion = '0.2.0';
  delete old.form;
  old.harmony.beats.forEach((b) => delete b.section);
  old.parts = old.parts.filter((p) => p.difficulty !== 'super-easy').map(({ arrangement, guide, ...p }) => ({ ...p, ringers: p.ringers.map(({ role, name, ...r }) => r), notes: p.notes.filter((n) => n.role !== 'descant') }));
  assert.deepEqual(validate(schema, old), []);
  // Deterministic.
  assert.deepEqual(buildPart(formed('joy-to-the-world'), 'hard', 4, 'phone-4zone', 'chord-split'), buildPart(formed('joy-to-the-world'), 'hard', 4, 'phone-4zone', 'chord-split'));
});
