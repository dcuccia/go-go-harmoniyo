// Writes public/songs/jingle-bells.mid — a self-authored encoding of the public-domain
// "Jingle Bells" chorus (J. L. Pierpont, 1857). Melody track + simple bell accompaniment.
// The encoding (notes, rhythm, harmony choices) is original to this repo: MIT / CC0.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PPQ = 480;
const BPM = 116;

const C = 72, D = 74, E = 76, F = 77, G = 79;
const phraseA = [[E, 1], [E, 1], [E, 2], [E, 1], [E, 1], [E, 2], [E, 1], [G, 1], [C, 1.5], [D, 0.5], [E, 4]];
const phraseB1 = [[F, 1], [F, 1], [F, 1.5], [F, 0.5], [F, 1], [E, 1], [E, 1], [E, 0.5], [E, 0.5], [E, 1], [D, 1], [D, 1], [E, 1], [D, 2], [G, 2]];
const phraseB2 = [[F, 1], [F, 1], [F, 1], [F, 1], [F, 1], [E, 1], [E, 1], [E, 0.5], [E, 0.5], [G, 1], [G, 1], [F, 1], [D, 1], [C, 4]];
const melody = [...phraseA, ...phraseB1, ...phraseA, ...phraseB2];
const INTRO_BEATS = 4;

// One chord per bar: [bass, [upper voices]]
const CH = { C: [48, [64, 67]], F: [53, [65, 69]], D7: [50, [66, 72]], G7: [55, [65, 71]] };
const bars = ['C', 'C', 'C', 'C', 'C', 'F', 'C', 'D7', 'G7', 'C', 'C', 'C', 'C', 'F', 'C', 'G7', 'C'];

function vlq(n) {
  const out = [n & 0x7f];
  n >>= 7;
  while (n > 0) { out.unshift((n & 0x7f) | 0x80); n >>= 7; }
  return out;
}
const text = (type, s) => [0xff, type, ...vlq(s.length), ...[...s].map((c) => c.charCodeAt(0))];

function track(events) {
  // events: { tick, order, data }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const bytes = [];
  let last = 0;
  for (const e of events) { bytes.push(...vlq(e.tick - last), ...e.data); last = e.tick; }
  bytes.push(0x00, 0xff, 0x2f, 0x00);
  return [0x4d, 0x54, 0x72, 0x6b, (bytes.length >>> 24) & 0xff, (bytes.length >>> 16) & 0xff, (bytes.length >>> 8) & 0xff, bytes.length & 0xff, ...bytes];
}

function note(events, ch, pitch, startBeat, beats, vel) {
  const on = Math.round(startBeat * PPQ);
  const off = Math.round((startBeat + beats) * PPQ);
  events.push({ tick: on, order: 1, data: [0x90 | ch, pitch, vel] });
  events.push({ tick: off, order: 0, data: [0x80 | ch, pitch, 0] });
}

const us = Math.round(60_000_000 / BPM);
const conductor = [
  { tick: 0, order: 0, data: text(0x03, 'Jingle Bells (chorus)') },
  { tick: 0, order: 0, data: [0xff, 0x51, 0x03, (us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff] },
  { tick: 0, order: 0, data: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08] },
];

const mel = [{ tick: 0, order: 0, data: text(0x03, 'Melody') }];
let beat = INTRO_BEATS;
for (const [p, d] of melody) { note(mel, 0, p, beat, d * 0.9, 100); beat += d; }

const back = [{ tick: 0, order: 0, data: text(0x03, 'Backing') }];
bars.forEach((name, bar) => {
  const [bass, upper] = CH[name];
  const b0 = bar * 4;
  note(back, 1, bass, b0, 1.9, 70);
  note(back, 1, bass + 7, b0 + 2, 1.9, 55);
  for (const off of [1, 3]) for (const u of upper) note(back, 1, u, b0 + off, 0.9, 38);
});

const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 3, (PPQ >> 8) & 0xff, PPQ & 0xff];
const file = Uint8Array.from([...header, ...track(conductor), ...track(mel), ...track(back)]);
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'songs');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'jingle-bells.mid'), file);
console.log(`wrote jingle-bells.mid (${file.length} bytes, ${melody.length} melody notes, ${BPM} bpm)`);
