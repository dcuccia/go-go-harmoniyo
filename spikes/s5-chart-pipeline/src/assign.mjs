// Bell -> ringer assignment.
//
// Handbell convention: each ringer covers a run of adjacent naturals plus their accidentals
// (an accidental travels with the natural a semitone below it: C# with C, Bb=A# with A).
// So an assignment is a partition of the sorted list of "natural slots" into K contiguous groups.
// We pick the partition minimizing an additive cost with dynamic programming (O(K * n^2) groups,
// n = number of slots, typically < 30):
//   balance   (strikes - ideal)^2 / ideal  (x2 if under-loaded)   ideal = total strikes / K
//   violations  simultaneous strikes > profile.maxSimultaneous,
//               same-bell repeats faster than profile.minRepeatSec,
//               bell-to-bell switches faster than profile.minSwitchSec,
//               bell swaps (bell not "in hand") faster than profile.swapSec
//   swaps     total bells picked up / put down (mild)
//   capacity  bells beyond profile.maxBells (heavy)
import { naturalSlot, pitchName } from './score.mjs';
import { ROLE_PRIORITY } from './arrange.mjs';

// All thresholds are assumptions to be calibrated by S1 (phones) and playtests (real bells).
export const PROFILES = {
  handbell: {
    label: 'Traditional two-in-hand ringing with table pickups (real bells)',
    maxSimultaneous: 2, inHand: 2, maxBells: 6,
    minRepeatSec: 0.18, minSwitchSec: 0, swapSec: 0.4,
  },
  'phone-4zone': {
    label: 'One phone covering up to 4 bells (on-screen zones), one strike at a time',
    maxSimultaneous: 1, inHand: 4, maxBells: 4,
    minRepeatSec: 0.2, minSwitchSec: 0.2, swapSec: Infinity,
  },
  'phone-pair': {
    label: 'Two phones per ringer (one bell per hand), no table bells',
    maxSimultaneous: 2, inHand: 2, maxBells: 2,
    minRepeatSec: 0.18, minSwitchSec: 0, swapSec: Infinity,
  },
  'phone-2zone': {
    label: 'One phone covering 2 bells (bell chosen by touch zone/tilt), one strike at a time',
    maxSimultaneous: 1, inHand: 2, maxBells: 2,
    minRepeatSec: 0.2, minSwitchSec: 0.2, swapSec: Infinity,
  },
  'phone-1': {
    label: 'One phone = one bell',
    maxSimultaneous: 1, inHand: 1, maxBells: 1,
    minRepeatSec: 0.2, minSwitchSec: Infinity, swapSec: Infinity,
  },
};

const W = { balance: 1, violation: 10, swap: 0.3, capacity: 60 };
const EPS = 0.03; // strikes within 30 ms count as simultaneous

function instants(notes) {
  const out = [];
  for (const n of notes) {
    const last = out[out.length - 1];
    if (last && n.time - last.time <= EPS) last.notes.push(n);
    else out.push({ time: n.time, notes: [n] });
  }
  for (const i of out) i.bells = [...new Set(i.notes.map((n) => n.midi))];
  return out;
}

// Evaluate one ringer's notes (sorted by time) against a profile. Returns counts and the
// offending instants (for repair).
export function evaluateRinger(notes, profile) {
  const ins = instants(notes);
  const r = { strikes: notes.length, bells: new Set(notes.map((n) => n.midi)).size, simul: 0, fastRepeat: 0, fastSwitch: 0, fastSwap: 0, swaps: 0, maxSimultaneous: 0, minGapSec: Infinity, offenders: [] };
  let hand = [];
  for (let k = 0; k < ins.length; k++) {
    const b = ins[k];
    r.maxSimultaneous = Math.max(r.maxSimultaneous, b.bells.length);
    if (b.bells.length > profile.maxSimultaneous) { r.simul += b.bells.length - profile.maxSimultaneous; r.offenders.push({ kind: 'simul', at: k, ins: b }); }
    const a = ins[k - 1];
    if (a) {
      const dt = b.time - a.time;
      r.minGapSec = Math.min(r.minGapSec, dt);
      for (const x of b.bells) {
        if (a.bells.includes(x)) {
          if (dt < profile.minRepeatSec) { r.fastRepeat++; r.offenders.push({ kind: 'repeat', at: k, ins: b, prev: a }); }
        } else if (dt < profile.minSwitchSec) { r.fastSwitch++; r.offenders.push({ kind: 'switch', at: k, ins: b, prev: a }); }
      }
    }
    for (const x of b.bells) {
      const idx = hand.indexOf(x);
      if (idx >= 0) { hand.splice(idx, 1); hand.push(x); continue; }
      if (hand.length >= profile.inHand) {
        r.swaps++;
        const dt = a ? b.time - a.time : Infinity;
        if (dt < profile.swapSec) { r.fastSwap++; r.offenders.push({ kind: 'swap', at: k, ins: b, prev: a }); }
        const evict = hand.findIndex((h) => !b.bells.includes(h));
        hand.splice(evict >= 0 ? evict : 0, 1);
      }
      hand.push(x);
    }
  }
  if (r.minGapSec === Infinity) r.minGapSec = null;
  r.violations = r.simul + r.fastRepeat + r.fastSwitch + r.fastSwap;
  return r;
}

function groupCost(notes, ideal, profile) {
  const e = evaluateRinger(notes, profile);
  // Under-loaded ringers (bored players) cost twice as much as over-loaded ones.
  const bal = ideal > 0 ? (((e.strikes - ideal) ** 2) / ideal) * (e.strikes < ideal ? 2 : 1) : 0;
  return W.balance * bal + W.violation * e.violations + W.swap * e.swaps + W.capacity * Math.max(0, e.bells - profile.maxBells);
}

// notes: [{ time, midi, ... }]; returns { ringers: [{ bells:[midi], slots:[midi] }], cost }
export function assignBells(notes, ringerCount, profile) {
  const sorted = [...notes].sort((a, b) => a.time - b.time || a.midi - b.midi);
  const slots = [...new Set(sorted.map((n) => naturalSlot(n.midi)))].sort((a, b) => a - b);
  const n = slots.length;
  const K = Math.min(ringerCount, n);
  const ideal = sorted.length / K;
  const slotIndex = new Map(slots.map((s, i) => [s, i]));
  const bySlot = slots.map(() => []);
  for (const note of sorted) bySlot[slotIndex.get(naturalSlot(note.midi))].push(note);

  const cost = Array.from({ length: n + 1 }, () => new Array(n + 1).fill(Infinity));
  for (let i = 0; i < n; i++) {
    let acc = [];
    for (let j = i + 1; j <= n; j++) {
      acc = acc.concat(bySlot[j - 1]).sort((a, b) => a.time - b.time || a.midi - b.midi);
      cost[i][j] = groupCost(acc, ideal, profile);
    }
  }
  const best = Array.from({ length: K + 1 }, () => new Array(n + 1).fill(Infinity));
  const back = Array.from({ length: K + 1 }, () => new Array(n + 1).fill(-1));
  best[0][0] = 0;
  for (let k = 1; k <= K; k++) {
    for (let j = k; j <= n; j++) {
      for (let i = k - 1; i < j; i++) {
        const c = best[k - 1][i] + cost[i][j];
        if (c < best[k][j]) { best[k][j] = c; back[k][j] = i; }
      }
    }
  }
  const cuts = [];
  let j = n;
  for (let k = K; k >= 1; k--) { const i = back[k][j]; cuts.unshift([i, j]); j = i; }
  const ringers = cuts.map(([a, b]) => {
    const groupSlots = slots.slice(a, b);
    const bells = [...new Set(sorted.filter((x) => groupSlots.includes(naturalSlot(x.midi))).map((x) => x.midi))].sort((x, y) => x - y);
    return { slots: groupSlots, bells };
  });
  // Idle ringers if there are fewer natural slots than people.
  while (ringers.length < ringerCount) ringers.push({ slots: [], bells: [] });
  return { ringers, cost: best[K][n] };
}

export function ringerLabel(r) {
  if (!r.slots.length) return '(idle)';
  const a = pitchName(r.slots[0]);
  const b = pitchName(r.slots[r.slots.length - 1]);
  return a === b ? a : `${a}–${b}`;
}

// Drop lowest-priority, non-melody notes that cause violations. Melody is never dropped.
export function repair(notes, ringerOf, profile, maxPasses = 6) {
  let current = notes.slice();
  const dropped = [];
  for (let pass = 0; pass < maxPasses; pass++) {
    const remove = new Set();
    const groups = new Map();
    for (const n of current) {
      const r = ringerOf(n.midi);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(n);
    }
    for (const ns of groups.values()) {
      ns.sort((a, b) => a.time - b.time || a.midi - b.midi);
      const ev = evaluateRinger(ns, profile);
      for (const o of ev.offenders) {
        const cand = o.ins.notes.filter((x) => x.role !== 'melody' && !remove.has(x));
        const prevCand = o.prev ? o.prev.notes.filter((x) => x.role !== 'melody' && !remove.has(x)) : [];
        const pick = (arr) => arr.sort((x, y) => ROLE_PRIORITY[x.role] - ROLE_PRIORITY[y.role] || x.midi - y.midi)[0];
        if (o.kind === 'simul') {
          const excess = o.ins.bells.length - profile.maxSimultaneous;
          cand.sort((x, y) => ROLE_PRIORITY[x.role] - ROLE_PRIORITY[y.role] || x.midi - y.midi).slice(0, excess).forEach((x) => remove.add(x));
        } else {
          const victim = pick(cand) || pick(prevCand);
          if (victim) remove.add(victim);
        }
      }
    }
    if (!remove.size) break;
    dropped.push(...remove);
    current = current.filter((n) => !remove.has(n));
  }
  return { notes: current, dropped };
}
