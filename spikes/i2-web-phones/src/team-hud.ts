// Per-ringer overlays on each highway column: player name, bell (note) names under the strike
// targets, a judgement pop and live per-player accuracy. The team score/streak HUD is S4's Hud.
import type { Grade } from '../../s4-web-host/src/core/judge';
import type { MultiHighway } from './multi-highway';
import type { TeamChart } from './team-chart';

export interface PlayerStats {
  name: string;
  notes: number;
  counts: Record<Grade, number>;
  strays: number;
  streak: number;
  maxStreak: number;
  offsetsMs: number[];
}

export function newStats(name: string, notes: number): PlayerStats {
  return { name, notes, counts: { perfect: 0, great: 0, good: 0, miss: 0 }, strays: 0, streak: 0, maxStreak: 0, offsetsMs: [] };
}

export function accuracyOf(s: PlayerStats): number {
  const c = s.counts;
  const judged = c.perfect + c.great + c.good + c.miss;
  return judged ? (c.perfect + 0.7 * c.great + 0.4 * c.good) / judged : 0;
}

const TEXT: Record<Grade, string> = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };

export class TeamHud {
  private cols: { head: HTMLElement; name: HTMLElement; stat: HTMLElement; judge: HTMLElement; lanes: HTMLElement[] }[] = [];

  constructor(private readonly mh: MultiHighway) {}

  setup(team: TeamChart, names: string[], kinds: string[]): void {
    this.cols = team.ringers.map((r, i) => {
      const col = this.mh.column(i);
      col.querySelectorAll('.hw-overlay').forEach((e) => e.remove());
      const head = el('div', 'hw-overlay hw-head');
      const name = el('div', 'hw-name');
      name.textContent = names[i] ?? `Ringer ${r.index + 1}`;
      const sub = el('div', 'hw-sub');
      sub.textContent = `Ringer ${r.index + 1} · ${kinds[i] ?? ''}${r.autoBells.length ? ` · host rings ${r.autoBells.join(' ')}` : ''}`;
      const stat = el('div', 'hw-stat');
      head.append(name, sub, stat);
      const judge = el('div', 'hw-overlay hw-judge');
      const lanes = r.bells.map((b) => {
        const l = el('div', 'hw-overlay hw-lane');
        l.style.setProperty('--c', b.color);
        l.innerHTML = `<b>${b.name}</b>`;
        col.appendChild(l);
        return l;
      });
      col.append(head, judge);
      return { head, name, stat, judge, lanes };
    });
    this.position();
  }

  /** Re-place lane labels under each highway's strike targets (after resize / layout). */
  position(): void {
    this.cols.forEach((c, i) => {
      const rect = this.mh.column(i).getBoundingClientRect();
      const pos = this.mh.laneScreenPositions(i);
      c.lanes.forEach((l, k) => {
        if (!pos[k]) return;
        l.style.left = `${pos[k].x - rect.left}px`;
        l.style.top = `${pos[k].y - rect.top}px`;
      });
    });
  }

  setName(i: number, name: string): void {
    if (this.cols[i]) this.cols[i].name.textContent = name;
  }

  judgement(i: number, grade: Grade, offsetMs?: number): void {
    const c = this.cols[i];
    if (!c) return;
    c.judge.textContent = TEXT[grade] + (offsetMs !== undefined && grade !== 'miss' && grade !== 'perfect' ? (offsetMs > 0 ? ' ›' : ' ‹') : '');
    c.judge.className = `hw-overlay hw-judge ${grade}`;
    void c.judge.offsetWidth;
    c.judge.classList.add('go');
  }

  stats(i: number, s: PlayerStats): void {
    const c = this.cols[i];
    if (!c) return;
    const hits = s.counts.perfect + s.counts.great + s.counts.good;
    c.stat.textContent = `${hits}/${s.notes} · ${(accuracyOf(s) * 100).toFixed(0)}%${s.streak >= 5 ? ` · ${s.streak} streak` : ''}`;
  }

  clearStats(): void {
    for (const c of this.cols) c.stat.textContent = '';
  }
}

function el(tag: string, cls: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  return e;
}
