// Several S4 HighwayRenderers side by side (one per ringer), presented to the S4 Session as a
// single renderer over the team chart's global lanes / note ids.
import type { Chart } from '../../s4-web-host/src/core/chart';
import type { Grade } from '../../s4-web-host/src/core/judge';
import { HighwayRenderer, type RenderOptions } from '../../s4-web-host/src/render/highway';
import type { SessionRenderer } from '../../s4-web-host/src/game/session';
import type { TeamChart } from './team-chart';

export const MAX_HIGHWAYS = 4;

export class MultiHighway implements SessionRenderer {
  private readonly pool: { canvas: HTMLCanvasElement; col: HTMLElement; r: HighwayRenderer }[] = [];
  private team: TeamChart | null = null;
  private active = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly opts: Omit<RenderOptions, 'fitCanvas' | 'fitLanes'>,
  ) {}

  /** Column element of highway `i` (for DOM overlays: name, lane labels, judgements). */
  column(i: number): HTMLElement {
    return this.ensure(i).col;
  }

  get count(): number {
    return this.active;
  }

  get gpu(): string {
    return this.pool[0]?.r.gpu ?? '';
  }

  get bufferSize(): { width: number; height: number } {
    let width = 0;
    let height = 0;
    for (let i = 0; i < this.active; i++) {
      const s = this.pool[i].r.bufferSize;
      width += s.width;
      height = Math.max(height, s.height);
    }
    return { width, height };
  }

  private ensure(i: number) {
    while (this.pool.length <= i) {
      const col = document.createElement('div');
      col.className = 'hw-col';
      const canvas = document.createElement('canvas');
      canvas.className = 'hw-canvas';
      col.appendChild(canvas);
      this.root.appendChild(col);
      // WebGL contexts are created once and reused across songs (browsers cap live contexts).
      // fitLanes 4: every highway is framed for a full phone (4 bells), so strike lines line up.
      this.pool.push({ canvas, col, r: new HighwayRenderer(canvas, { ...this.opts, fitCanvas: true, fitLanes: 4 }) });
    }
    return this.pool[i];
  }

  /** Lay out one highway per active ringer and load their sub-charts. */
  setTeam(team: TeamChart): void {
    this.team = team;
    this.active = Math.min(MAX_HIGHWAYS, team.ringers.length);
    for (let i = 0; i < Math.max(this.active, this.pool.length); i++) {
      if (i < this.active) this.ensure(i);
      this.pool[i].col.classList.toggle('hidden', i >= this.active);
    }
    this.root.style.setProperty('--hw-count', String(Math.max(1, this.active)));
    this.resize();
    for (let i = 0; i < this.active; i++) this.pool[i].r.setChart(team.subCharts[i]);
  }

  resize(): void {
    for (let i = 0; i < this.active; i++) this.pool[i].r.resize();
  }

  /** Session calls this with the team chart; sub-charts were prepared by setTeam. */
  setChart(chart: Chart): void {
    if (!this.team || this.team.chart !== chart) throw new Error('MultiHighway.setChart: call setTeam() with this chart first');
    for (let i = 0; i < this.active; i++) this.pool[i].r.setChart(this.team.subCharts[i]);
  }

  private route(lane: number): { r: HighwayRenderer; local: number } | null {
    const t = this.team;
    if (!t) return null;
    const ri = t.laneRinger[lane];
    if (ri === undefined || ri >= this.active) return null;
    return { r: this.pool[ri].r, local: lane - t.ringers[ri].laneStart };
  }

  press(lane: number): void {
    const x = this.route(lane);
    x?.r.press(x.local);
  }

  hit(noteId: number, lane: number, grade: Grade): void {
    const x = this.route(lane);
    if (x && this.team) x.r.hit(this.team.localIndex[noteId] ?? -1, x.local, grade);
  }

  miss(noteId: number, lane: number): void {
    const x = this.route(lane);
    if (x && this.team) x.r.miss(this.team.localIndex[noteId] ?? -1, x.local);
  }

  setFire(level: number): void {
    for (let i = 0; i < this.active; i++) this.pool[i].r.setFire(level);
  }

  frame(songTime: number, dt: number, wall: number): void {
    for (let i = 0; i < this.active; i++) this.pool[i].r.frame(songTime, dt, wall);
  }

  /** CSS-pixel strike-target positions per highway (for lane labels). */
  laneScreenPositions(i: number): { x: number; y: number }[] {
    return i < this.active ? this.pool[i].r.laneScreenPositions() : [];
  }
}
