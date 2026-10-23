import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { parseMidi } from '../src/core/midi';
import { chartFromMidi } from '../src/core/chart';
import { Judge, isJudgement } from '../src/core/judge';

const root = join(__dirname, '..');
execFileSync(process.execPath, [join(root, 'scripts', 'make-song.mjs')]);
const bytes = new Uint8Array(readFileSync(join(root, 'public', 'songs', 'jingle-bells.mid')));

describe('midi + chart', () => {
  const midi = parseMidi(bytes);
  const chart = chartFromMidi(midi, { title: 'JB' });

  it('parses tracks, tempo and names', () => {
    expect(midi.ppq).toBe(480);
    expect(midi.tracks.map((t) => t.name)).toEqual(['Jingle Bells (chorus)', 'Melody', 'Backing']);
    expect(Math.round(60_000_000 / midi.tempos[0].usPerQuarter)).toBe(116);
  });

  it('builds 5 lanes C D E F G from the melody, backing auto-played', () => {
    expect(chart.lanes.map((l) => l.name)).toEqual(['C5', 'D5', 'E5', 'F5', 'G5']);
    expect(chart.notes.length).toBe(51);
    expect(chart.backing.length).toBeGreaterThan(50);
    const spb = 60 / 116;
    expect(chart.notes[0].time).toBeCloseTo(4 * spb, 4);
    expect(chart.lanes[chart.notes[0].lane].name).toBe('E5');
  });
});

describe('judge', () => {
  const notes = [0, 1, 1.1, 2].map((time, id) => ({ id, time, lane: id === 2 ? 1 : 0, pitch: 60, velocity: 100 }));

  it('grades by offset and keeps streak', () => {
    const j = new Judge(notes, 2);
    const a = j.ring(0, 0.01);
    expect(isJudgement(a) && a.grade).toBe('perfect');
    const b = j.ring(0, 1.07);
    expect(isJudgement(b) && b.grade).toBe('great');
    const c = j.ring(1, 1.22);
    expect(isJudgement(c) && c.grade).toBe('good');
    expect(j.state.streak).toBe(3);
  });

  it('stray rings do not consume notes; sweep marks misses and breaks streak', () => {
    const j = new Judge(notes, 2);
    j.ring(0, 0);
    expect(isJudgement(j.ring(0, 0.5))).toBe(false);
    expect(j.state.strays).toBe(1);
    const missed = j.sweep(1.5);
    expect(missed.map((m) => m.noteId)).toEqual([1, 2]);
    expect(j.state.streak).toBe(0);
    const d = j.ring(0, 1.98);
    expect(isJudgement(d) && d.noteId).toBe(3);
    expect(j.finished).toBe(true);
  });

  it('multiplier grows every 8 hits up to 4x', () => {
    const many = Array.from({ length: 40 }, (_, id) => ({ id, time: id, lane: 0, pitch: 60, velocity: 100 }));
    const j = new Judge(many, 1);
    for (let i = 0; i < 40; i++) j.ring(0, i);
    expect(j.state.multiplier).toBe(4);
    expect(j.state.maxStreak).toBe(40);
  });
});
