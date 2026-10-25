import { describe, expect, it } from 'vitest';
import { buildTeamChart, CHART_FORMAT, findPart, isChartFormat, shortestIoiMs, type S5Chart, type S5Part } from '../src/team-chart';
import { pitchColor } from '../../shared/pitch-palette';

function fixture(): S5Chart {
  const bells = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5'].map((id, i) => ({ id, midi: [60, 62, 64, 65, 67, 69, 71, 72][i] }));
  // Ringer 0 has 5 bells; F4 is struck once (least) and must go to the host.
  const r0 = ['C4', 'D4', 'E4', 'F4', 'G4'];
  const r1 = ['A4', 'B4', 'C5'];
  const seq = ['C4', 'A4', 'D4', 'B4', 'E4', 'C5', 'G4', 'C4', 'F4', 'D4', 'E4', 'G4', 'A4'];
  const notes = seq.map((bell, i) => ({ tick: i * 480, time: i * 0.5, durSec: 0.5, bell, ringer: r0.includes(bell) ? 0 : 1, role: 'melody' as const }));
  const part: S5Part = { difficulty: 'easy', ringerCount: 2, ringers: [{ index: 0, bells: r0 }, { index: 1, bells: r1 }], notes };
  return {
    format: 'go-go-harmoniyo.chart',
    formatVersion: '0.1.0',
    song: { id: 'fixture', title: 'Fixture', license: { id: 'CC0-1.0' } },
    timing: { tempos: [{ tick: 0, time: 0, bpm: 120 }], timeSignatures: [{ tick: 0, numerator: 4, denominator: 4 }], durationSec: 7 },
    bells,
    parts: [part],
  };
}

describe('buildTeamChart', () => {
  it('splits a part into per-ringer lanes, ≤4 bells per phone, overflow to the host', () => {
    const c = fixture();
    const t = buildTeamChart(c, findPart(c, 'easy', 2)!);
    expect(t.ringers.map((r) => r.bells.map((b) => b.id))).toEqual([
      ['C4', 'D4', 'E4', 'G4'],
      ['A4', 'B4', 'C5'],
    ]);
    expect(t.ringers[0].autoBells).toEqual(['F4']);
    expect(t.chart.lanes.map((l) => l.name)).toEqual(['C4', 'D4', 'E4', 'G4', 'A4', 'B4', 'C5']);
    expect(t.ringers[1].laneStart).toBe(4);
    expect(t.chart.notes.length).toBe(12);
    expect(t.chart.backing.map((b) => b.pitch)).toEqual([65 + 12]);
    // Sounding pitch = written + 12 by default.
    expect(t.chart.lanes[0].pitch).toBe(72);
    // Note ids are sequential and map to each highway's local notes.
    t.chart.notes.forEach((n, i) => expect(n.id).toBe(i));
    t.ringers.forEach((r, ri) => {
      const sub = t.subCharts[ri];
      expect(sub.notes.length).toBe(r.noteIds.length);
      r.noteIds.forEach((id, k) => {
        expect(t.localIndex[id]).toBe(k);
        expect(sub.notes[k].lane).toBe(t.chart.notes[id].lane - r.laneStart);
        expect(sub.notes[k].time).toBe(t.chart.notes[id].time);
      });
    });
    expect(t.laneRinger).toEqual([0, 0, 0, 0, 1, 1, 1]);
  });

  it('colours each bell by its pitch class, never its lane', () => {
    const c = fixture();
    const t = buildTeamChart(c, findPart(c, 'easy', 2)!);
    const bells = t.ringers.flatMap((r) => r.bells);
    const byId = new Map(bells.map((b) => [b.id, b]));
    // C4 (ringer 1, lane 0) and C5 (ringer 2, lane 2) share a colour; lane 0 of each ringer does not.
    expect(byId.get('C4')!.color).toBe(pitchColor(60));
    expect(byId.get('C5')!.color).toBe(byId.get('C4')!.color);
    expect(t.ringers[1].bells[0].color).not.toBe(t.ringers[0].bells[0].color);
    expect(new Set(bells.filter((b) => b.id[0] !== 'C').map((b) => b.color)).size).toBe(bells.length - 2);
    expect(bells.every((b) => !b.accidental)).toBe(true);
  });

  it('plays inactive ringers on the host and gives them no highway', () => {
    const c = fixture();
    const t = buildTeamChart(c, findPart(c, 'easy', 2)!, { active: [false, true] });
    expect(t.ringers.length).toBe(1);
    expect(t.autoRingers).toEqual([0]);
    expect(t.ringers[0].laneStart).toBe(0);
    expect(t.chart.notes.length).toBe(4);
    expect(t.chart.backing.length).toBe(9);
  });

  it('accepts the current chart format id and the pre-rename one', () => {
    expect(isChartFormat(CHART_FORMAT)).toBe(true);
    expect(isChartFormat('go-go-harmoniyo.chart')).toBe(true);
    expect(isChartFormat('handbell-hero.chart')).toBe(true);
    expect(isChartFormat('other.chart')).toBe(false);
  });

  const charts = import.meta.glob('../public/charts/*.json', { eager: true, import: 'default' }) as Record<string, S5Chart | { songs: unknown[] }>;
  const songs = Object.entries(charts).filter(([k]) => !k.endsWith('index.json')) as [string, S5Chart][];
  it.skipIf(songs.length === 0)('handles every generated part (run "npm run charts" first)', () => {
    for (const [, c] of songs) {
      for (const p of c.parts) {
        const t = buildTeamChart(c, p);
        expect(t.chart.notes.length + t.chart.backing.length).toBe(p.notes.length);
        for (const r of t.ringers) expect(r.bells.length).toBeLessThanOrEqual(4);
        expect(t.ringers.length).toBe(p.ringerCount);
        for (let i = 1; i < t.chart.notes.length; i++) expect(t.chart.notes[i].time).toBeGreaterThanOrEqual(t.chart.notes[i - 1].time);
      }
    }
  });
});

describe('shortestIoiMs', () => {
  it('finds the shortest gap between strokes, a chord counting once', () => {
    expect(shortestIoiMs([0, 0.5, 1, 1.25, 1.5])).toBe(250);
    expect(shortestIoiMs([0, 0.01, 0.3])).toBe(300);
    expect(shortestIoiMs([1])).toBeNull();
  });
});