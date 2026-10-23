import type { Chart } from '../core/chart';
import type { Grade, ScoreState } from '../core/judge';
import { keyLabel, laneKeys } from '../input/keyboard';
import { isAccidental, pitchColor } from '../../../shared/pitch-palette';
import type { Mode, Offsets } from '../game/session';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const GRADE_TEXT: Record<Grade | 'stray' | 'tap', string> = {
  perfect: 'PERFECT!',
  great: 'GREAT',
  good: 'GOOD',
  miss: 'MISS',
  stray: '',
  tap: 'TAP',
};

export class Hud {
  private readonly root = $('hud');
  private readonly score = $('score');
  private readonly mult = $('mult');
  private readonly streak = $('streak');
  private readonly acc = $('acc');
  private readonly title = $('song-title');
  private readonly progress = $('progress-fill');
  private readonly judge = $('judgement');
  private readonly judgeMs = $('judgement-ms');
  private readonly banner = $('banner');
  private readonly lanes = $('lane-labels');
  private readonly offsets = $('offsets');
  private lastScore = -1;
  private lastStreak = -1;
  private lastMult = -1;
  private milestone = 0;
  private bannerTimer = 0;

  show(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  reset(chart: Chart, mode: Mode): void {
    this.title.textContent = `${chart.title}${mode === 'autoplay' ? ' — autoplay' : mode === 'calibrate' ? ' — tap on each click' : ''}`;
    this.lastScore = this.lastStreak = this.lastMult = -1;
    this.milestone = 0;
    this.judge.textContent = '';
    this.judgeMs.textContent = '';
    const keys = laneKeys(chart.lanes.length);
    this.lanes.innerHTML = '';
    chart.lanes.forEach((l, i) => {
      const d = document.createElement('div');
      d.className = `lane-label${isAccidental(l.pitch) ? ' acc' : ''}`;
      d.style.setProperty('--c', pitchColor(l.pitch));
      d.innerHTML = `<b>${mode === 'calibrate' ? 'any key' : keyLabel(keys[i])}</b><span>${mode === 'calibrate' ? '' : l.name}</span>`;
      this.lanes.appendChild(d);
    });
    this.root.classList.toggle('calibrating', mode === 'calibrate');
    this.show(true);
  }

  positionLanes(pos: { x: number; y: number }[]): void {
    const els = this.lanes.children;
    for (let i = 0; i < els.length && i < pos.length; i++) {
      const el = els[i] as HTMLElement;
      el.style.left = `${pos[i].x}px`;
      el.style.top = `${pos[i].y}px`;
    }
  }

  judgement(grade: Grade | 'stray' | 'tap', offsetMs?: number): void {
    if (grade === 'stray') return;
    this.judge.textContent = GRADE_TEXT[grade];
    this.judge.className = `pop ${grade}`;
    void this.judge.offsetWidth; // restart CSS animation
    this.judge.classList.add('go');
    this.judgeMs.textContent = offsetMs !== undefined && grade !== 'miss' ? `${offsetMs >= 0 ? '+' : ''}${offsetMs.toFixed(0)} ms ${offsetMs > 0 ? 'late' : offsetMs < 0 ? 'early' : ''}` : '';
  }

  showBanner(text: string, ms = 1400): void {
    this.banner.textContent = text;
    this.banner.className = 'banner';
    void this.banner.offsetWidth;
    this.banner.classList.add('go');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => (this.banner.className = 'banner'), ms);
  }

  update(s: ScoreState, accuracy: number, songTime: number, duration: number, off: Offsets): void {
    if (s.score !== this.lastScore) {
      this.score.textContent = s.score.toLocaleString();
      this.lastScore = s.score;
    }
    if (s.streak !== this.lastStreak) {
      this.streak.textContent = s.streak > 0 ? `${s.streak} streak` : '';
      if (s.streak >= 25 && Math.floor(s.streak / 25) > this.milestone) {
        this.milestone = Math.floor(s.streak / 25);
        this.showBanner(`${s.streak} NOTE STREAK!`);
      }
      if (s.streak === 0) this.milestone = 0;
      this.lastStreak = s.streak;
    }
    if (s.multiplier !== this.lastMult) {
      this.mult.textContent = `×${s.multiplier}`;
      this.mult.className = `m${s.multiplier}`;
      if (s.multiplier > this.lastMult && this.lastMult > 0) this.showBanner(s.multiplier === 4 ? 'BELLS ON FIRE ×4' : `×${s.multiplier} MULTIPLIER`);
      this.lastMult = s.multiplier;
    }
    this.acc.textContent = s.judged ? `${(accuracy * 100).toFixed(1)}%` : '';
    this.progress.style.width = `${Math.max(0, Math.min(1, songTime / duration)) * 100}%`;
    if (songTime < 0) {
      const c = Math.ceil(-songTime);
      this.banner.textContent = c <= 3 ? String(c) : '';
      this.banner.className = 'banner count';
    } else if (this.banner.classList.contains('count')) this.banner.className = 'banner';
    this.offsets.textContent = `A/V offset ${off.visualMs.toFixed(0)} ms (←/→) · input offset ${off.inputMs.toFixed(0)} ms`;
  }
}
