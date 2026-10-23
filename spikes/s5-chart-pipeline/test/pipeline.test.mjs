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
import { buildChart, fitHandbellSet, FORMAT, isChartFormat } from '../src/chart.mjs';
import { exportCloneHero, laneOf, CH_TRACKS } from '../src/export.mjs';
import { loadSong } from '../src/pipeline.mjs';
import { validate } from '../src/validate.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'songs', 'manifest.json'), 'utf8'));
const names = (notes) => notes.map((n) => pitchName(n.midi));

test('ABC: pitches, key signature, lengths, chord symbols', () => {
  const s = parseAbc(readFileSync(join(root, 'songs', 'jingle-bells.abc'), 'utf8'));
  assert.equal(s.title, 'Jingle Bells');
  assert.deepEqual(names(s.notes.slice(0, 7)), ['D5', 'B4', 'A4', 'G4', 'D4', 'D4', 'D4']);
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
    for (const p of chart.parts) {
      for (const n of p.notes) assert.ok(p.ringers[n.ringer].bells.includes(n.bell), `${f}: note bell belongs to its ringer`);
      const melodyIn = p.notes.filter((n) => n.role === 'melody').length;
      assert.equal(melodyIn, chart.parts[0].notes.filter((n) => n.role === 'melody').length, `${f}: melody never dropped`);
    }
  }
  const entry = manifest.songs[0];
  const broken = JSON.parse(readFileSync(join(root, 'charts', `${entry.id}.json`), 'utf8'));
  delete broken.song.license;
  broken.parts[0].notes[0].bell = 'H9';
  assert.equal(validate(schema, broken).length, 2, 'validator catches errors');
  const { score, roleNotes, song } = loadSong(entry, join(root, 'songs'));
  const fresh = buildChart({ score, roleNotes, song });
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
  const chart = buildChart({ score, roleNotes, song, ringerCounts: [4] });
  const { midi } = exportCloneHero(score, chart, 4);
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
