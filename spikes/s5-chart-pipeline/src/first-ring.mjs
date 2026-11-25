import { pitchName } from './score.mjs';

// In seating priority order: [fixed pitch, zero-based quarter-beat onsets in Short].
// Keep the same accents for each pitch as seats are added. Unselected notes stay in the tune.
const ACCENTS = new Map([
  ['jingle-bells', [
    ['B4', [1, 9, 18, 28, 33, 41, 50, 64, 68, 72, 76, 85, 88, 96, 100, 104, 108, 117]],
    ['A4', [2, 10, 19, 27, 34, 42, 51, 59, 75.5, 89, 92, 107.5, 123]],
    ['G4', [3, 11, 35, 43, 60, 74, 106, 124]],
    ['C5', [17, 26, 49, 58, 80, 84, 112, 116, 122]],
  ]],
  ['deck-the-halls', [
    ['G4', [3, 8, 19, 24, 32, 39, 51, 61]],
    ['F4', [4, 12, 20, 28, 52, 62]],
    ['A4', [2, 6, 10, 18, 22, 26, 36, 40, 50, 54, 60]],
    ['C5', [0, 16, 38, 46, 58]],
  ]],
]);

export const supportsFirstRing = (id) => ACCENTS.has(id);

export function firstRingAccents(formed, songId, ringerCount) {
  const accents = ACCENTS.get(songId);
  if (formed.id !== 'short' || !accents || !Number.isInteger(ringerCount) || ringerCount < 1 || ringerCount > accents.length) {
    throw new Error(`First Ring is not available for ${songId}, ${formed.id}, ${ringerCount} ringers`);
  }
  const key = (tick, bell) => `${tick}:${bell}`;
  const melody = new Map(formed.melody.map((n) => [key(n.tick, pitchName(n.midi)), n]));
  const selected = new Set();
  const pitches = new Set();
  const groups = accents.slice(0, ringerCount).map(([bell, beats]) => {
    if (!beats.length || pitches.has(bell)) throw new Error(`Invalid First Ring part in ${songId}: ${bell}`);
    pitches.add(bell);
    let previous = -Infinity;
    let midi;
    for (const beat of beats) {
      const tick = beat * formed.score.ppq;
      const k = key(tick, bell);
      const note = melody.get(k);
      const time = formed.toSec(tick);
      if (!note || selected.has(k) || time - previous < 1.5 - 1e-6) {
        throw new Error(`Invalid First Ring accent in ${songId}: ${bell} at quarter beat ${beat}`);
      }
      midi = note.midi;
      selected.add(k);
      previous = time;
    }
    return { bells: [midi], role: 'melody' };
  });
  const notes = [];
  const guide = [];
  for (const [k, n] of melody) {
    (selected.has(k) ? notes : guide).push({ ...n, time: formed.toSec(n.tick) });
  }
  return { groups, notes, guide };
}
