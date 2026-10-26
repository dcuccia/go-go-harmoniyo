// Part cards for the seating chart: a musical name, bell range, pitch-class colours and a difficulty
// meter per ringer part of an S5 arrangement. Pure logic: no DOM, audio or network.
import type { S5Chart, S5Part, TeamChart } from './team-chart';
import { bellName } from './team-chart';

export interface PartBell {
  id: string;
  name: string;
  letter: string;
  /** Sounding MIDI pitch (what the phone plays). */
  midi: number;
  color: string;
  accidental: boolean;
}

export interface PartCard {
  /** Part (ringer) index = highway position, left → right. */
  index: number;
  /** "Melody", "Bass", "Harmony", "Low melody", … or "Ringer N" when the chart has no roles. */
  name: string;
  /** Bells on the player's phone (≤ 4), low → high, in pitch-class colours. */
  bells: PartBell[];
  /** Bells of this part the TV rings because they do not fit on one phone. */
  autoBells: string[];
  /** e.g. "G4–D5". */
  range: string;
  /** Notes the player rings. */
  notes: number;
  /** Changes of bell between consecutive notes (zone switches on a phone). */
  switches: number;
  /** Notes per second over the song. */
  perSec: number;
  /** Difficulty score: (notes + ½·switches) per second. */
  effort: number;
  /** 1–5 meter. */
  level: number;
}

const ROLE_NAME = { melody: 'Melody', bass: 'Bass', inner: 'Harmony' } as const;
type Role = keyof typeof ROLE_NAME;
const QUALIFIERS: Record<number, string[]> = { 2: ['Low', 'High'], 3: ['Low', 'Middle', 'High'], 4: ['Low', 'Low-mid', 'High-mid', 'High'] };

/**
 * Musical part names from the chart's note roles: each ringer is named after the role most of its
 * notes have (melody / bass / inner → Harmony). When several ringers share a role (e.g. an easy
 * arrangement splits the melody by range) they are qualified low → high ("Low melody", "High
 * melody"). Charts without roles fall back to "Ringer N". Format 0.3 charts name each part from
 * its arrangement role (`ringers[].name`); those names are used as they are.
 */
export function partNames(part: S5Part): string[] {
  if (part.ringers.length && part.ringers.every((r) => r.name)) return part.ringers.map((r) => r.name!);
  const roles: (Role | null)[] = part.ringers.map((r) => {
    const count: Record<Role, number> = { melody: 0, bass: 0, inner: 0 };
    let any = false;
    for (const n of part.notes) {
      if (n.ringer === r.index && n.role && n.role in count) {
        count[n.role as Role]++;
        any = true;
      } else if (n.ringer === r.index && n.role === 'descant') {
        count.melody++;
        any = true;
      }
    }
    if (!any) return null;
    return (Object.keys(count) as Role[]).reduce((a, b) => (count[b] > count[a] ? b : a), 'melody');
  });
  if (roles.some((r) => r === null)) return part.ringers.map((r) => `Ringer ${r.index + 1}`);
  return roles.map((role, i) => {
    const same = roles.map((r, k) => (r === role ? k : -1)).filter((k) => k >= 0);
    const base = ROLE_NAME[role!];
    if (same.length < 2) return base;
    const q = QUALIFIERS[same.length]?.[same.indexOf(i)] ?? String(same.indexOf(i) + 1);
    return `${q} ${base.toLowerCase()}`;
  });
}

/** Difficulty meter thresholds on `effort` (notes + ½ switches per second), calibrated on the S5 carols. */
export const LEVELS = [0.5, 0.9, 1.4, 2.0];
export const levelOf = (effort: number): number => 1 + LEVELS.filter((t) => effort >= t).length;

/** One card per ringer of `part`. `team` must be built with every ringer active (lobby preview). */
export function partCards(src: S5Chart, part: S5Part, team: TeamChart): PartCard[] {
  const names = partNames(part);
  const duration = Math.max(1, team.chart.duration);
  return part.ringers.map((r, i) => {
    const tr = team.ringers.find((x) => x.index === r.index);
    const bells: PartBell[] = (tr?.bells ?? []).map((b) => ({ id: b.id, name: b.name, letter: b.letter, midi: b.pitch, color: b.color, accidental: b.accidental }));
    const lanes = (tr?.noteIds ?? []).map((id) => team.chart.notes[id].lane);
    let switches = 0;
    for (let k = 1; k < lanes.length; k++) if (lanes[k] !== lanes[k - 1]) switches++;
    const notes = lanes.length;
    const effort = (notes + 0.5 * switches) / duration;
    const all = [...(tr?.bells.map((b) => b.id) ?? []), ...(tr?.autoBells ?? [])];
    const midi = new Map(src.bells.map((b) => [b.id, b.midi] as const));
    const sorted = [...new Set(all.length ? all : r.bells)].sort((a, b) => (midi.get(a) ?? 0) - (midi.get(b) ?? 0));
    const range = sorted.length ? (sorted.length === 1 ? bellName(sorted[0]) : `${bellName(sorted[0])}–${bellName(sorted[sorted.length - 1])}`) : '';
    return {
      index: r.index,
      name: names[i],
      bells,
      autoBells: tr?.autoBells ?? [],
      range,
      notes,
      switches,
      perSec: Math.round((notes / duration) * 100) / 100,
      effort: Math.round(effort * 1000) / 1000,
      level: levelOf(effort),
    };
  });
}
