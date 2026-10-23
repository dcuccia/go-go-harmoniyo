import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ChartLibrary, laneBells, LANE_COLORS, tierForDifficulty, YargLink, YargRoom, type Chart } from '../src/host/yarg.ts';

const CHARTS = fileURLToPath(new URL('../../s5-chart-pipeline/charts', import.meta.url));

function chart(): Chart {
  const ringers = (bells: string[][]) => bells.map((b, index) => ({ index, label: b.join(' '), bells: b }));
  return {
    song: { id: 'test-carol', title: 'Test Carol' },
    parts: [
      { difficulty: 'easy', ringerCount: 4, ringers: ringers([['C4', 'D4'], ['E4', 'F4'], ['G4', 'A4'], ['B4', 'C5']]) },
      { difficulty: 'hard', ringerCount: 4, ringers: ringers([['C3', 'D3', 'E3'], ['F3', 'G3'], ['A3', 'B3', 'C4'], ['D4', 'E4', 'F4', 'G4', 'A4', 'B4']]) },
    ],
  };
}

function room(opts: Partial<ConstructorParameters<typeof YargRoom>[0]> = {}) {
  const lib = new ChartLibrary();
  lib.add(chart());
  const sent: string[] = [];
  let t = 10_000;
  const r = new YargRoom({ charts: lib, song: 'test-carol', difficulty: 'expert', send: (s) => sent.push(s), now: () => t, ...opts });
  return { r, sent, setNow: (x: number) => (t = x) };
}

test('tiers: YARG difficulty → S5 tier', () => {
  assert.equal(tierForDifficulty('Easy'), 'easy');
  assert.equal(tierForDifficulty('beginner'), 'easy');
  assert.equal(tierForDifficulty('medium'), 'medium');
  assert.equal(tierForDifficulty('Expert'), 'hard');
  assert.equal(tierForDifficulty('expertplus'), 'hard');
  assert.equal(tierForDifficulty(undefined), 'hard');
});

test('laneBells: one lane per bell up to 5, S5 lane merge above 5, YARG lane colours', () => {
  const three = laneBells(['C4', 'D4', 'E4']);
  assert.deepEqual(three.map((b) => b.id), ['C4', 'D4', 'E4']);
  assert.deepEqual(three.map((b) => b.color), LANE_COLORS.slice(0, 3));
  assert.equal(three[0].midi, 60);
  const six = laneBells(['D4', 'E4', 'F4', 'G4', 'A4', 'B4']);
  assert.deepEqual(six.map((b) => b.id), ['D4', 'E4', 'F4+G4', 'A4', 'B4']);
  assert.equal(six[2].midi, 65);
});

test('seats: phones take slots in order; rejoin keeps the seat; take-over of offline seats; full room', () => {
  const { r, sent } = room({ maxPhones: 2 });
  const a = r.join('phone-a', 'Ann')!;
  const b = r.join('phone-b', 'Bob')!;
  assert.equal(a.slot, 0);
  assert.equal(b.slot, 1);
  assert.equal(a.device, 'ringer1');
  assert.deepEqual(a.bells.map((x) => x.id), ['C3', 'D3', 'E3'], 'hard part, ringer 1');
  assert.ok(sent.includes('hgp0 hello ringer1 0 Ann'));
  assert.equal(r.join('phone-c', 'Cat'), null, 'room full');
  r.leave('phone-a');
  assert.equal(r.join('phone-a', 'Ann')!.slot, 0, 'rejoin → same seat');
  r.leave('phone-a');
  const c = r.join('phone-c', 'Cat')!;
  assert.equal(c.slot, 0, 'offline seat taken over');
  assert.equal(c.device, 'ringer1', 'same YARG device → same YARG profile');
  assert.equal(r.join('phone-a', 'Ann'), null, 'Ann now has no seat');
});

test('ring: lane from bell id, source time in seconds, press + release, per-room sequence', () => {
  const scheduled: [() => void, number][] = [];
  const { r, sent } = room({ schedule: (fn, ms) => scheduled.push([fn, ms]) });
  r.join('p', 'P');
  sent.length = 0;
  assert.equal(r.ring('p', 'D3', 9_980, 10_000), 1);
  assert.deepEqual(sent, ['hgp0 ring ringer1 1 1 9.980000 1']);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0][1], 40, 'release at source + 60 ms');
  scheduled[0][0]();
  assert.equal(sent[1], 'hgp0 ring ringer1 1 0 10.040000 2');
  assert.equal(r.ring('p', 'Z9', 9_990, 10_000), null, 'not one of my bells');
  assert.equal(r.ring('nobody', 'C3', 9_990, 10_000), null);
  assert.deepEqual(r.ages, [20]);
});

test('ring: merged lane accepts any of its bells; future source times are clamped to arrival', () => {
  const { r, sent } = room();
  for (const id of ['a', 'b', 'c', 'd']) r.join(id, id);
  sent.length = 0;
  assert.equal(r.ring('d', 'G4', 10_050, 10_000), 2, 'F4+G4 lane');
  assert.match(sent[0], / 10\.000000 /);
});

test('song report: follows the instrument/difficulty each player picked in YARG', () => {
  const { r } = room();
  r.join('a', 'Ann');
  r.join('b', 'Bob');
  const changed = r.onSongReport('hgp0 song ringer1:3:easy,ringer2:1:Expert,kbd1:-1:expert Test Carol')!;
  const [a, b] = [r.seats[0]!, r.seats[1]!];
  assert.equal(a.part, 3);
  assert.equal(a.tier, 'easy');
  assert.deepEqual(a.bells.map((x) => x.id), ['B4', 'C5'], 'easy part, ringer 4');
  assert.deepEqual(b.bells.map((x) => x.id), ['F3', 'G3'], 'hard part, ringer 2 (unchanged)');
  assert.deepEqual(changed.map((s) => s.slot), [0]);
  assert.equal(r.onSongReport('hgp0 pong 1.0'), null);
  assert.deepEqual(r.onSongReport('hgp0 song - Unknown Song'), [], 'unknown song keeps bells');
  assert.equal(r.chart?.song.id, 'test-carol');
});

test('setSong: no chart → free pentatonic lanes', () => {
  const { r } = room();
  r.join('a', 'Ann');
  r.setSong(null);
  assert.deepEqual(r.seats[0]!.bells.map((x) => x.id), ['C5', 'D5', 'E5', 'G5', 'A5']);
});

test('real S5 charts load and give 4 ringers ≤ 5 lanes on every tier', () => {
  const lib = ChartLibrary.load(CHARTS);
  assert.equal(lib.charts.length, 8);
  assert.ok(lib.find('Deck the Halls'));
  assert.ok(lib.find('deck-the-halls'));
  for (const c of lib.charts) {
    const r = new YargRoom({ charts: lib, song: c.song.id, send: () => undefined, now: () => 0 });
    for (const tier of ['easy', 'medium', 'hard'] as const) {
      for (let part = 0; part < 4; part++) {
        const bells = r.bellsFor({ slot: part, part, tier });
        assert.ok(bells.length >= 1 && bells.length <= 5, `${c.song.id} ${tier} ringer ${part + 1}: ${bells.length} lanes`);
      }
    }
  }
});

test('YargLink: sync + announce to a fake bridge, pong marks connected, song reports reach the room', async () => {
  const bridge = dgram.createSocket('udp4');
  await new Promise<void>((res) => bridge.bind(0, '127.0.0.1', () => res()));
  const port = bridge.address().port;
  const got: string[] = [];
  bridge.on('message', (buf, rinfo) => {
    const text = buf.toString();
    got.push(text);
    const sync = /^hgp0 sync (\S+)/.exec(text);
    if (sync) bridge.send(`hgp0 pong ${sync[1]}`, rinfo.port, rinfo.address);
    if (text.startsWith('hgp0 hello')) bridge.send('hgp0 song ringer1:1:medium Test Carol', rinfo.port, rinfo.address);
  });
  const reports: string[] = [];
  const t0 = performance.now();
  const link = new YargLink(port, () => performance.now() - t0, (text) => reports.push(text));
  const lib = new ChartLibrary();
  lib.add(chart());
  const r = new YargRoom({ charts: lib, send: (s) => link.send(s), now: () => performance.now() - t0 });
  await link.start(() => r.announce());
  r.join('a', 'Ann');
  await new Promise((res) => setTimeout(res, 400));
  assert.ok(link.connected, 'pong received');
  assert.ok(link.rtt >= 0 && link.rtt < 50, `rtt ${link.rtt}`);
  assert.ok(got.some((g) => g.startsWith('hgp0 sync ')));
  assert.ok(got.includes('hgp0 hello ringer1 0 Ann'));
  assert.equal(reports[0], 'hgp0 song ringer1:1:medium Test Carol');
  link.close();
  bridge.close();
});
