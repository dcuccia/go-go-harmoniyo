import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadBackingPreview } from '../../s1-phone-bell/src/host/backing-preview';
import { protectBells, scoreEvents } from '../src/backing/preview-score';
import { BackingTrack } from '../src/backing/track';

const part = {
  difficulty: 'easy', ringerCount: 1, ringers: [{ index: 0, bells: ['C4'] }],
  notes: [{ ringer: 0, time: 0, tick: 0, durSec: 0.5, bell: 'C4', role: 'inner' }],
  guide: [{ time: 1, tick: 480, durSec: 0.7, bell: 'D4', role: 'melody' }],
};
const chart = {
  format: 'go-go-harmoniyo.chart', formatVersion: '0.3',
  song: { id: 'fixture', title: 'Fixture', license: { id: 'CC0-1.0' } },
  timing: { durationSec: 3, tempos: [], timeSignatures: [] },
  bells: [{ id: 'C4', midi: 60 }, { id: 'D4', midi: 62 }],
  form: { id: 'short', sections: [] }, parts: [part],
  harmony: {
    source: 'inferred', chords: [],
    beats: [0, 0.5, 1, 2].map((time, tick) => ({ time, tick, bar: 0, beat: tick, chord: null })),
  },
};

describe('preview notes', () => {
  it('uses the end beat interval after a tempo change and rejects notes outside the form', () => {
    expect(scoreEvents([[1, 0.5, 1, 44, 'harp', 0.5]], chart)[0]).toMatchObject({ time: 0.75, dur: 0.75 });
    expect(() => scoreEvents([[3, 0.5, 1, 44, 'harp', 0.5]], chart)).toThrow('exceeds');
    expect(() => scoreEvents([[3, 0.5, 0.5, 44, 'flute', 0.5]], chart)).toThrow('invalid');
  });

  it('filters occupied player and guide pitches without changing the exact surviving motif', () => {
    const written = scoreEvents([
      [0, 0, 1, 60, 'harp', 0.4],
      [1, 0.5, 1, 73, 'harp', 0.4],
      [1, 0.5, 1, 44, 'harp', 0.4],
      [3, 0, 1, 62, 'harp', 0.4],
    ], chart);
    expect(protectBells(written, chart, part)).toEqual([written[2], written[3]]);
    expect(protectBells(written, chart, { ...part, guide: [] })).toEqual(written.slice(1));
  });

  it('keeps consonant bass below a melody and preserves a dominant seventh', () => {
    const written = scoreEvents([[1, 0.5, 1, 50, 'harp', 0.4], [1, 0.5, 1, 68, 'harp', 0.4]], chart);
    expect(protectBells(written, chart, part)).toEqual(written);
    const occupiedBass = { ...part, guide: [{ ...part.guide[0], role: 'bass' }] };
    expect(protectBells(written, chart, occupiedBass)).toEqual(written.slice(1));
  });

  it('uses the same track clock for candidate notes, including practice speed', () => {
    const preview = { events: scoreEvents([[1, 0.5, 1, 44, 'harp', 0.5]], chart), playHarp: vi.fn() };
    const mixer = {}; // construction must not allocate audio
    const opts = { preview, speed: 0.5 };
    const audible = new BackingTrack(mixer, chart, [], { enabled: true, volume: 0.5, countIn: true }, opts);
    expect(audible.preview?.events[0]).toMatchObject({ time: 1.5, dur: 1.5 });
    expect(audible.clicks).toEqual(new BackingTrack(mixer, chart, [], audible.settings, { speed: 0.5 }).clicks);
    const muted = new BackingTrack(mixer, chart, [], { enabled: true, volume: 0, countIn: false }, opts);
    expect(muted.scheduled()).toEqual([]);
  });
});

it('validates a synthetic sidecar and serves only exact loopback TV fetches', () => {
  const repo = mkdtempSync(join(tmpdir(), 'backing-preview-'));
  try {
    const dist = join(repo, 'spikes', 'i2-web-phones', 'dist-backing-preview');
    const sidecar = join(repo, '.backing-preview');
    mkdirSync(join(dist, 'charts', 'short'), { recursive: true });
    mkdirSync(sidecar);
    const sourceHash = '1'.repeat(40);
    const write = (target, value) => writeFileSync(target, JSON.stringify(value));
    write(join(dist, 'charts', 'index.json'), { sourceHash, songs: [{ id: 'fixture' }] });
    write(join(dist, 'charts', 'short', 'fixture.json'), chart);
    write(join(dist, 'charts', 'fixture.json'), { ...chart, form: { ...chart.form, id: 'full' } });
    const manifest = join(sidecar, 'manifest.json');
    const tuple = [[0, 0, 1, 37, 'pad', 0.4]];
    const score = { schema: 'backing-preview-v1', songs: { fixture: { short: tuple, full: tuple } } };
    // The full part occupies this pitch; load it, but schedule no note in that chosen part.
    write(manifest, { ...score, sourceHash, songs: { fixture: { short: tuple, full: [[0, 0, 1, 60, 'pad', 0.4]] } } });
    const load = () => loadBackingPreview(repo, dist, sidecar, 18900);
    const route = load();
    const read = (path, host = '127.0.0.1:18900', site = 'same-origin', ip = '127.0.0.1', forwarded = {}) => {
      const req = { socket: { remoteAddress: ip }, method: 'GET', headers: { host, 'sec-fetch-site': site, 'x-backing-preview': '1', ...forwarded } };
      const res = { writeHead: vi.fn().mockReturnThis(), end: vi.fn() };
      route(req, res, `/api/backing-preview/${path}`);
      return res;
    };
    expect(JSON.parse(read('fixture/short').end.mock.calls[0][0])).toEqual({ sourceHash, events: tuple });
    expect(read('fixture/full').writeHead).toHaveBeenCalledWith(200, expect.anything());
    expect(read('fixture/first-ring').writeHead).toHaveBeenCalledWith(404, expect.anything());
    expect(read('fixture/short', 'example.com').writeHead).toHaveBeenCalledWith(404, expect.anything());
    expect(read('fixture/full', undefined, 'cross-site').writeHead).toHaveBeenCalledWith(404, expect.anything());
    expect(read('fixture/full', undefined, undefined, '192.168.1.40').writeHead).toHaveBeenCalledWith(404, expect.anything());
    expect(read('fixture/full', undefined, undefined, undefined, { 'x-forwarded-host': 'public.example' }).writeHead).toHaveBeenCalledWith(404, expect.anything());
    expect(() => loadBackingPreview(repo, dist, join(dist, '.backing-preview'), 18900)).toThrow('isolated I2 audition build');
    write(manifest, { ...score, sourceHash: '0'.repeat(40) });
    expect(load).toThrow('sourceHash');
    write(manifest, { ...score, sourceHash, songs: { fixture: { short: [[0, 0, 1, 38, 'harp', 0.4]], full: tuple } } });
    mkdirSync(join(sidecar, 'samples'));
    writeFileSync(join(sidecar, 'samples', 'KSHarp_D2_mf.wav'), 'not the pinned recording');
    expect(load).toThrow('does not match');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
