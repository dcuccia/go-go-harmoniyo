// Role-aware, load-balanced parts for one song form (chart format 0.3).
//
// Arrangement styles (part.arrangement):
//   balanced     Each ringer plays one musical role in one pitch region: Bass (roots/fifths), Harmony
//                (one voice-led inner line per hand), Melody (split by range, with the descant on
//                top). Accompaniment density is chosen within the tier's range so that every
//                ringer's load (strikes) is as even as possible (Jain fairness on strikes).
//   chord-split  The chord is spread over up to three ringers, one tone each (1-3-5 in close
//                position, voice-led); the others play the tune. The backing plays the bass.
//   by-range     The S5 0.2 algorithm: bells cut into contiguous ranges by load, roles ignored.
//
// Pitch windows are disjoint per role (form.windowsFor) and start on naturals, so a bell always
// belongs to one role and an accidental travels with its natural (handbell convention).
import { pitchName, timeSigAt } from './score.mjs';
import { DEVELOPMENT } from './form.mjs';
import { PROFILES, assignBells, evaluateRinger, repair, ringerLabel } from './assign.mjs';

export const TIERS = ['super-easy', 'easy', 'medium', 'hard'];
export const ARRANGEMENTS = ['balanced', 'chord-split', 'by-range'];

// Accompaniment level ranges per tier (0 = absent; 1 = chord changes + downbeats; 2 = + strong
// beats; 3 = every beat). The lower bounds only apply with enough ringers: bass from 3 ringers
// (with 1–2 the tune needs everyone), harmony from `harmonyFrom`. A descant ringer is an option from
// `descantFrom` ringers; otherwise the host plays the descant (part `guide`). Super easy plays a
// skeleton of the tune (the host plays the rest) with at most `maxBells` bells per ringer.
// `richness`: bonus per accompaniment level (and descant) when choosing between plans, so harder
// tiers lean richer when fairness is close. `nominal` is what by-range uses (the S5 0.2 tiers);
// `chord` is chord-split's chord density.
export const TIER_SPECS = {
  'super-easy': { melody: 'skeleton', bass: [0, 1], harmony: [0, 0], richness: 0.02, maxBells: 3, minGapSec: 1, nominal: { bass: 0, harmony: 0 }, chord: 1 },
  easy: { melody: 'full', bass: [0, 1], harmony: [0, 1], richness: 0.02, nominal: { bass: 0, harmony: 0 }, chord: 1 },
  medium: { melody: 'full', bass: [1, 2], harmony: [0, 2], richness: 0.03, descantFrom: 5, nominal: { bass: 2, harmony: 0 }, chord: 2 },
  hard: { melody: 'full', bass: [2, 3], harmony: [1, 3], richness: 0.06, harmonyFrom: 4, descantFrom: 5, nominal: { bass: 2, harmony: 3 }, chord: 3 },
};

/** Chord split: preference per chord ringer, in richness units (3 ringers on 1-3-5 when it fits). */
const CHORD_BONUS = 2;
/** Penalty per bell beyond the profile's bells-per-ringer capacity. */
const OVER_CAPACITY = 0.04;
const r3 = (x) => Math.round(x * 1000) / 1000;
const mod12 = (x) => ((x % 12) + 12) % 12;
const place = (pc, low) => low + mod12(pc - low);
const range = ([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ── accompaniment hits (once per form) ──────────────────────────────────────────
function hitsOf(formed) {
  if (formed._hits) return formed._hits;
  const chords = formed.score.chords;
  const hold = formed.segments.find((s) => s.holdFrom !== undefined)?.holdFrom ?? Infinity;
  const chordIndexAt = (tick) => {
    let k = -1;
    for (let i = 0; i < chords.length && chords[i].tick <= tick; i++) k = i;
    return k >= 0 && tick < chords[k].tick + chords[k].dur ? k : -1;
  };
  const beatTicks = new Set(formed.beats.map((b) => b.tick));
  const raw = formed.beats.map((b) => ({ tick: b.tick, downbeat: b.downbeat, strong: b.strong }));
  for (const c of chords) if (!beatTicks.has(c.tick)) raw.push({ tick: c.tick, downbeat: false, strong: false });
  const hits = [];
  for (const h of raw.sort((a, b) => a.tick - b.tick)) {
    const ci = chordIndexAt(h.tick);
    if (ci < 0) continue;
    const change = chords[ci].tick === h.tick;
    if (h.tick >= hold && !change) continue; // held final bar: let it ring
    const sec = formed.sections[formed.sectionAt(h.tick)];
    hits.push({
      ...h,
      chord: ci,
      change,
      bassLevel: change || h.downbeat ? 1 : h.strong ? 2 : 3,
      harmonyLevel: change ? 1 : h.downbeat ? 2 : h.strong ? 3 : 9,
      dev: DEVELOPMENT[sec.development],
    });
  }
  formed._hits = hits;
  // Score bass lines (SATB sources): level by metric position, folded into the bass window.
  const bassTop = formed.windows.bass[1];
  const down = new Set(formed.beats.filter((b) => b.downbeat).map((b) => b.tick));
  const strong = new Set(formed.beats.filter((b) => b.strong).map((b) => b.tick));
  formed._sourceBass = formed.sourceBass.map((n) => {
    let midi = n.midi;
    while (midi > bassTop) midi -= 12;
    const ci = chordIndexAt(n.tick);
    const change = ci >= 0 && chords[ci].tick === n.tick;
    const level = change || down.has(n.tick) ? 1 : strong.has(n.tick) ? 2 : 3;
    return { ...n, midi, level, dev: DEVELOPMENT[formed.sections[formed.sectionAt(n.tick)].development] };
  });
  return hits;
}

/** Split the harmony window into `count` contiguous regions with (nearly) equal numbers of naturals. */
export function harmonyRegions(window, count) {
  const naturals = range(window).filter((m) => ![1, 3, 6, 8, 10].includes(mod12(m)));
  const out = [];
  let k = 0;
  for (let r = 0; r < count; r++) {
    const size = Math.floor(naturals.length / count) + (r < naturals.length % count ? 1 : 0);
    const lo = naturals[k];
    k += size;
    const hi = k < naturals.length ? naturals[k] - 1 : window[1];
    out.push([lo, hi]);
  }
  return out;
}

// Tone preference (lower = better). inner: guide tones first (3rd, 7th), then 5th, root last.
// triad: root, 3rd and 5th equally (1-3-5), the 5th of a seventh chord last.
function toneRank(chord, pc, priority) {
  const i = chord.tones.indexOf(pc);
  const seventh = chord.tones.length >= 4;
  if (priority === 'triad') return i === 2 && seventh ? 2 : 0;
  if (i === 1) return 0;
  if (seventh && i === 3) return 0.5;
  if (i === 2) return 1;
  return 4;
}

/**
 * Accompaniment notes for one part.
 * cfg: { bass: level, harmony: level, regions: [[lo, hi]...], voices: tones per region,
 *        priority: 'inner' | 'triad', bassFromScore: boolean }
 */
export function realize(formed, cfg) {
  const hits = hitsOf(formed);
  const chords = formed.score.chords;
  const end = formed.score.endTick;
  const out = [];
  if (cfg.bass > 0) {
    if (cfg.bassFromScore) {
      for (const n of formed._sourceBass) if (n.level <= Math.min(cfg.bass, n.dev.bass)) out.push({ tick: n.tick, dur: n.dur, midi: n.midi, role: 'bass', seg: n.seg });
    } else {
      const kept = hits.filter((h) => h.bassLevel <= Math.min(cfg.bass, h.dev.bass));
      kept.forEach((h, i) => {
        const c = chords[h.chord];
        const pc = h.bassLevel === 3 && !h.strong && c.tones.length >= 3 ? c.tones[2] : c.bass;
        out.push({ tick: h.tick, dur: (kept[i + 1]?.tick ?? end) - h.tick, midi: place(pc, formed.windows.bass[0]), role: 'bass', chord: c.symbol });
      });
    }
  }
  if (cfg.harmony > 0 && cfg.regions?.length) {
    const kept = hits.filter((h) => h.harmonyLevel <= Math.min(cfg.harmony, h.dev.harmony));
    const low = formed.windows.harmony[0];
    const prev = cfg.regions.map(() => null);
    const center = cfg.regions.map(([a, b]) => (a + b) / 2);
    let voicing = null;
    let voicedChord = -1;
    kept.forEach((h, i) => {
      const c = chords[h.chord];
      if (h.chord !== voicedChord) {
        voicedChord = h.chord;
        voicing = cfg.regions.map(([a, b], r) => {
          const cands = c.tones
            .map((pc) => ({ m: place(pc, low), rank: toneRank(c, pc, cfg.priority) }))
            .filter(({ m }) => m >= a && m <= b)
            .map((x) => ({ ...x, cost: x.rank * 2 + (prev[r] === null ? 0.5 * Math.abs(x.m - center[r]) : Math.abs(x.m - prev[r]) + 0.3 * Math.abs(x.m - center[r])) }))
            .sort((x, y) => x.cost - y.cost || x.m - y.m);
          const pick = cands.slice(0, cfg.voices).map((x) => x.m);
          if (pick.length) prev[r] = pick.reduce((s, m) => s + m, 0) / pick.length;
          return pick;
        });
      }
      const next = kept[i + 1]?.tick ?? end;
      voicing.forEach((ms, r) => ms.forEach((m) => out.push({ tick: h.tick, dur: next - h.tick, midi: m, role: 'inner', region: r, chord: c.symbol })));
    });
  }
  return out;
}

/** Tune notes on downbeats or of at least a beat, at least `minGapSec` apart (super easy). */
export function skeleton(formed, melody, minGapSec) {
  const down = new Set(formed.beats.filter((b) => b.downbeat).map((b) => b.tick));
  const ppq = formed.score.ppq;
  const beatLen = (tick) => {
    const ts = timeSigAt(formed.score, tick);
    return ts.den === 8 && ts.num % 3 === 0 && ts.num > 3 ? ppq * 1.5 : (ppq * 4) / ts.den;
  };
  const keep = [];
  const rest = [];
  let last = -Infinity;
  for (const n of melody) {
    const t = formed.toSec(n.tick);
    if ((down.has(n.tick) || n.dur >= beatLen(n.tick)) && t - last >= minGapSec - 1e-6) {
      keep.push(n);
      last = t;
    } else rest.push(n);
  }
  return { keep, rest };
}

// ── loads and fairness ─────────────────────────────────────────────────────────
/** Jain's fairness index: 1 = every ringer has the same load, 1/n = one ringer has it all. */
export function jain(xs) {
  const s = xs.reduce((a, b) => a + b, 0);
  const q = xs.reduce((a, b) => a + b * b, 0);
  return xs.length && q > 0 ? (s * s) / (xs.length * q) : 1;
}

export function ringerLoad(notes, durationSec, windowSec = 10) {
  let switches = 0;
  for (let i = 1; i < notes.length; i++) if (notes[i].midi !== notes[i - 1].midi) switches++;
  let peak = 0;
  for (let i = 0, j = 0; i < notes.length; i++) {
    while (notes[i].time - notes[j].time > windowSec) j++;
    peak = Math.max(peak, i - j + 1);
  }
  const strikes = notes.length;
  return { strikes, switches, effort: strikes + 0.5 * switches, perMin: (strikes / durationSec) * 60, peak };
}

const ROLE_NAMES = { bass: 'Bass', harmony: 'Harmony', chord: 'Chord', melody: 'Melody', descant: 'Descant' };
const QUALIFIERS = { 2: ['Low', 'High'], 3: ['Low', 'Middle', 'High'], 4: ['Low', 'Low-mid', 'High-mid', 'High'] };

/** Display names from ringer roles (low → high): "Bass", "Low melody", "Chord middle", … */
export function ringerNames(roles) {
  return roles.map((role, i) => {
    if (!role) return `Ringer ${i + 1}`;
    const same = roles.map((r, k) => (r === role ? k : -1)).filter((k) => k >= 0);
    const base = ROLE_NAMES[role];
    if (same.length < 2) return base;
    const q = QUALIFIERS[same.length]?.[same.indexOf(i)] ?? String(same.indexOf(i) + 1);
    return role === 'chord' ? `${base} ${q.toLowerCase()}` : `${q} ${base.toLowerCase()}`;
  });
}

// ── part building ──────────────────────────────────────────────────────────────
// A plan fixes the accompaniment levels and how many ringers play each role.
function plans(formed, tier, K, arrangement, profile) {
  const spec = TIER_SPECS[tier];
  const bassFromScore = formed.sourceBass.length > 0;
  const melodyOnly = { bass: 0, harmony: 0, descant: false, regions: [], voices: 1, priority: 'inner', bassFromScore, players: { bass: 0, harmony: 0, melody: K, descant: 0 } };
  if (arrangement === 'by-range') {
    return [{ bass: spec.nominal.bass, harmony: spec.nominal.harmony, descant: false, regions: [formed.windows.harmony], voices: 2, priority: 'inner', bassFromScore, players: null }];
  }
  if (arrangement === 'chord-split') {
    // 1–3 chord ringers (3 = a 1-3-5 triad, one tone each); the plan chooser weighs the chord
    // against the tune ringers' bell capacity (a 9-bell tune on one 4-bell phone is no fun).
    if (K < 2) return [{ ...melodyOnly, priority: 'triad' }];
    return range([1, Math.min(3, K - 1)]).map((h) => ({ bass: 0, harmony: spec.chord, descant: false, regions: harmonyRegions(formed.windows.harmony, h), voices: 1, priority: 'triad', bassFromScore, players: { bass: 0, harmony: h, melody: K - h, descant: 0 }, chord: true }));
  }
  const out = [];
  // With one or two ringers the tune needs everyone, so every tier may leave the bass out.
  const bassRange = K <= 2 ? [0, spec.bass[1]] : spec.bass;
  const harmonyRange = K < (spec.harmonyFrom ?? Infinity) ? [0, spec.harmony[1]] : spec.harmony;
  const descants = K >= (spec.descantFrom ?? Infinity) && formed.descant.length ? [0, 1] : [0];
  for (const bl of range(bassRange)) {
    for (const hl of range(harmonyRange)) {
      for (const d of descants) {
        const b = bl > 0 ? 1 : 0;
        const h = hl > 0 ? (K >= 6 ? 2 : 1) : 0;
        if (K - b - h - d < 1) continue;
        out.push({ bass: bl, harmony: hl, descant: d > 0, regions: h ? harmonyRegions(formed.windows.harmony, h) : [], voices: Math.min(2, profile.maxSimultaneous), priority: 'inner', bassFromScore, players: { bass: b, harmony: h, melody: K - b - h - d, descant: d } });
      }
    }
  }
  return out.length ? out : [melodyOnly];
}

function tune(formed, tier, plan) {
  const spec = TIER_SPECS[tier];
  let melody = formed.melody;
  let guide = [];
  if (spec.melody === 'skeleton') {
    const s = skeleton(formed, melody, spec.minGapSec);
    melody = s.keep;
    guide = s.rest;
  }
  // Without a descant ringer the host plays the descant, so later verses still develop.
  return { melody, descant: plan.descant ? formed.descant : [], guide: plan.descant ? guide : [...guide, ...formed.descant] };
}

/** Pick the plan with the fairest per-ringer load (exact split before repair), richer on near-ties. */
function choosePlan(formed, tier, K, arrangement, profile) {
  const cands = plans(formed, tier, K, arrangement, profile);
  if (cands.length === 1) return cands[0];
  const timed = (ns) => ns.map((n) => ({ ...n, time: formed.toSec(n.tick) })).sort((a, b) => a.time - b.time || a.midi - b.midi);
  const { melody } = tune(formed, tier, { descant: false });
  const tuneNotes = timed(melody);
  const splits = new Map();
  const tuneSplit = (m) => {
    if (!splits.has(m)) {
      const rs = assignBells(tuneNotes, m, profile).ringers;
      splits.set(m, rs.map((r) => groupLoad(tuneNotes.filter((n) => r.bells.includes(n.midi)))));
    }
    return splits.get(m);
  };
  const descantLoad = groupLoad(timed(formed.descant));
  let best = null;
  for (const p of cands) {
    const acc = realize(formed, p).sort((a, b) => a.tick - b.tick || a.midi - b.midi);
    const loads = [];
    if (p.players.bass) loads.push(groupLoad(acc.filter((n) => n.role === 'bass')));
    for (let r = 0; r < p.players.harmony; r++) loads.push(groupLoad(acc.filter((n) => n.role === 'inner' && n.region === r)));
    loads.push(...tuneSplit(p.players.melody));
    if (p.players.descant) loads.push(descantLoad);
    const over = loads.reduce((s, l) => s + Math.max(0, l.bells - profile.maxBells), 0);
    const score = jain(loads.map((l) => l.effort)) + TIER_SPECS[tier].richness * (p.bass + p.harmony + (p.descant ? 1 : 0) + (p.chord ? CHORD_BONUS * p.players.harmony : 0)) - OVER_CAPACITY * over;
    if (!best || score > best.score + 1e-9) best = { score, p };
  }
  return best.p;
}

function groupLoad(notes) {
  let switches = 0;
  for (let i = 1; i < notes.length; i++) if (notes[i].midi !== notes[i - 1].midi) switches++;
  return { strikes: notes.length, effort: notes.length + 0.5 * switches, bells: new Set(notes.map((n) => n.midi)).size };
}

function groupsFor(notes, plan, K, profile) {
  if (!plan.players) return assignBells(notes, K, profile).ringers.map((r) => ({ ...r, role: null }));
  const groups = [];
  const byMidi = (ns) => [...new Set(ns.map((n) => n.midi))].sort((a, b) => a - b);
  const split = (ns, k, role) => {
    if (!k) return;
    const rs = k === 1 ? [{ bells: byMidi(ns) }] : assignBells(ns, k, profile).ringers;
    groups.push(...rs.map((r) => ({ bells: r.bells, role })));
  };
  split(notes.filter((n) => n.role === 'bass'), plan.players.bass, 'bass');
  const inner = notes.filter((n) => n.role === 'inner');
  for (let r = 0; r < plan.players.harmony; r++) groups.push({ bells: byMidi(inner.filter((n) => n.region === r)), role: plan.chord ? 'chord' : 'harmony' });
  groups.push(...assignBells(notes.filter((n) => n.role === 'melody'), plan.players.melody, profile).ringers.map((r) => ({ bells: r.bells, role: 'melody' })));
  split(notes.filter((n) => n.role === 'descant'), plan.players.descant, 'descant');
  return groups;
}
function mapper(groups) {
  const m = new Map();
  groups.forEach((g, i) => g.bells.forEach((b) => m.set(b, i)));
  return (midi) => m.get(midi);
}

/**
 * One part: { difficulty, ringerCount, profile, arrangement, ringers[], notes[], guide[]?, metrics }.
 * Notes keep `role` (melody, descant, bass, inner); the melody is never dropped for playability
 * (super easy moves rare melody bells to the host's `guide` instead).
 */
export function buildFormPart(formed, tier, ringerCount, profileId, arrangement = 'balanced') {
  const profile = PROFILES[profileId];
  const spec = TIER_SPECS[tier];
  const toSec = formed.toSec;
  const plan = choosePlan(formed, tier, ringerCount, arrangement, profile);
  const { melody, descant, guide: guide0 } = tune(formed, tier, plan);
  const timed = (ns) => ns.map((n) => ({ ...n, time: toSec(n.tick) }));
  let notes = timed([...melody, ...descant, ...realize(formed, plan)]).sort((a, b) => a.time - b.time || a.midi - b.midi);
  let guide = timed(guide0);
  // Same bell struck twice at once (e.g. descant meets tune): keep one strike.
  const seen = new Set();
  notes = notes.filter((n) => {
    const k = `${n.tick}:${n.midi}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let groups = groupsFor(notes, plan, ringerCount, profile);
  let dropped = [];
  for (let iter = 0; iter < 2; iter++) {
    const rep = repair(notes, mapper(groups), profile);
    dropped = dropped.concat(rep.dropped);
    notes = rep.notes;
    groups = groupsFor(notes, plan, ringerCount, profile);
  }
  // Super easy: at most `maxBells` bells per ringer (their most-rung ones); the rest go to the guide.
  if (spec.maxBells) {
    const ringerOf = mapper(groups);
    const count = new Map();
    for (const n of notes) count.set(n.midi, (count.get(n.midi) ?? 0) + 1);
    const keep = new Set();
    groups.forEach((g, i) => {
      const mine = g.bells.filter((b) => ringerOf(b) === i).sort((a, b) => (count.get(b) ?? 0) - (count.get(a) ?? 0) || a - b);
      mine.slice(0, spec.maxBells).forEach((b) => keep.add(b));
    });
    const out = notes.filter((n) => !keep.has(n.midi));
    guide = guide.concat(out.filter((n) => n.role === 'melody'));
    notes = notes.filter((n) => keep.has(n.midi));
    groups = groups.map((g) => ({ ...g, bells: g.bells.filter((b) => keep.has(b)) }));
  }
  while (groups.length < ringerCount) groups.push({ bells: [], role: null });
  const ringerOf = mapper(groups);
  const durationSec = toSec(formed.score.endTick);
  const loads = [];
  const roles = plan.players ? groups.map((g) => g.role) : groups.map((g) => majorityRole(notes.filter((n) => ringerOf(n.midi) === groups.indexOf(g))));
  const names = ringerNames(roles);
  const ringers = groups.map((g, i) => {
    const mine = notes.filter((n) => ringerOf(n.midi) === i).sort((a, b) => a.time - b.time || a.midi - b.midi);
    const ev = evaluateRinger(mine, profile);
    const load = ringerLoad(mine, durationSec);
    loads.push(load);
    return {
      index: i,
      label: ringerLabel({ slots: g.bells }),
      ...(roles[i] ? { role: roles[i] } : {}),
      name: names[i],
      bells: g.bells.map(pitchName),
      stats: {
        strikes: ev.strikes,
        bells: g.bells.length,
        strikesPerMinute: r3(load.perMin),
        switches: load.switches,
        peakPer10s: load.peak,
        maxSimultaneous: ev.maxSimultaneous,
        minGapSec: ev.minGapSec === null ? null : r3(ev.minGapSec),
        swaps: ev.swaps,
        violations: ev.violations,
      },
    };
  });
  const strikes = ringers.map((r) => r.stats.strikes);
  const active = strikes.filter((s) => s > 0);
  const bellCounts = ringers.map((r) => r.stats.bells);
  const peaks = loads.map((l) => l.peak);
  const sorted = (ns) => ns.sort((a, b) => a.tick - b.tick || a.midi - b.midi);
  return {
    difficulty: tier,
    ringerCount,
    profile: profileId,
    arrangement,
    ringers,
    notes: sorted(notes).map((n) => ({
      tick: n.tick,
      time: r3(n.time),
      dur: n.dur,
      durSec: r3(toSec(n.tick + n.dur) - n.time),
      bell: pitchName(n.midi),
      ringer: ringerOf(n.midi),
      role: n.role,
    })),
    ...(guide.length ? { guide: sorted(guide).map((n) => ({ tick: n.tick, time: r3(n.time), dur: n.dur, durSec: r3(toSec(n.tick + n.dur) - n.time), bell: pitchName(n.midi), role: n.role })) } : {}),
    metrics: {
      strikes: notes.length,
      distinctBells: new Set(notes.map((n) => n.midi)).size,
      accompaniment: { bass: plan.bass, harmony: plan.harmony, descant: plan.descant, ...(plan.players ? { players: plan.players } : {}) },
      droppedForPlayability: { total: dropped.length, bass: dropped.filter((n) => n.role === 'bass').length, inner: dropped.filter((n) => n.role === 'inner').length, descant: dropped.filter((n) => n.role === 'descant').length },
      remainingViolations: ringers.reduce((s, r) => s + r.stats.violations, 0),
      loadBalance: active.length ? r3(Math.max(...active) / Math.min(...active)) : null,
      fairness: {
        jain: r3(jain(loads.map((l) => l.effort))),
        jainStrikes: r3(jain(strikes)),
        strikes: [Math.min(...strikes), Math.max(...strikes)],
        bells: [Math.min(...bellCounts), Math.max(...bellCounts)],
        peakPer10s: [Math.min(...peaks), Math.max(...peaks)],
      },
      maxBellsPerRinger: Math.max(...bellCounts),
      idleRingers: ringers.filter((r) => r.stats.strikes === 0).length,
      ...(guide.length ? { guideNotes: guide.length } : {}),
    },
  };
}

function majorityRole(notes) {
  const c = { bass: 0, harmony: 0, melody: 0 };
  for (const n of notes) c[n.role === 'inner' ? 'harmony' : n.role === 'bass' ? 'bass' : 'melody']++;
  if (!notes.length) return null;
  return Object.keys(c).reduce((a, b) => (c[b] > c[a] ? b : a), 'melody');
}
