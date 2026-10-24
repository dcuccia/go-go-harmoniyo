// TV lobby seating chart: part cards × player chips. Updates the DOM in place (only the pieces whose
// markup changed), never replaces a control the user is interacting with, and keeps the "who plays
// this part?" picker open across device broadcasts. Mouse: drag a chip onto a part (an occupied
// part swaps). Keyboard / TV remote: Enter on a part opens the picker, ↑/↓ + Enter choose, Esc closes.
import type { PartCard } from './parts';
import { KEYBOARD, TV } from './seating';

export interface PlayerView {
  id: string;
  name: string;
  kind: 'phone' | 'keyboard' | 'tv';
  online: boolean;
  ready: boolean;
  /** Part index, -1 = bench. */
  part: number;
}

export interface SeatingActions {
  /** Put `player` (id, KEYBOARD or TV) on `part` (swaps / benches as the model decides). */
  assign(part: number, player: string): void;
  swap(a: number, b: number): void;
  /** The player in `part` sits out (the TV plays it). */
  unseat(part: number): void;
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const icon = (k: PlayerView['kind']): string => (k === 'tv' ? '🤖' : k === 'keyboard' ? '⌨' : '📱');
const DRAG_TYPE = 'application/x-gogoharmoniyo-seat';

const shown = new WeakMap<Element, string>();
/** Replace an element's markup only when it changed. */
function setHtml(el: Element, html: string): void {
  if (shown.get(el) === html) return;
  shown.set(el, html);
  el.innerHTML = html;
}

export class SeatingView {
  readonly tray: HTMLElement;
  readonly partsEl: HTMLElement;
  readonly picker: HTMLElement;
  private pickerTitle: HTMLElement;
  private pickerList: HTMLElement;
  private cards: PartCard[] = [];
  private seats: string[] = [];
  private players: PlayerView[] = [];
  private structKey = '';
  private pickerPart = -1;
  private activeId = TV;
  private drag: { player: string; from: number } | null = null;
  private pending = false;

  constructor(
    readonly root: HTMLElement,
    private act: SeatingActions,
  ) {
    root.innerHTML =
      '<div class="tray" aria-label="Players: drag one onto a part"></div>' +
      '<div class="parts" role="group" aria-label="Parts"></div>' +
      '<div class="picker" role="listbox" tabindex="-1" hidden><div class="picker-title"></div><div class="picker-list"></div></div>';
    this.tray = root.querySelector('.tray')!;
    this.partsEl = root.querySelector('.parts')!;
    this.picker = root.querySelector('.picker')!;
    this.pickerTitle = this.picker.querySelector('.picker-title')!;
    this.pickerList = this.picker.querySelector('.picker-list')!;
    this.wire();
  }

  get pickerOpen(): boolean {
    return this.pickerPart >= 0;
  }

  get cardEls(): HTMLElement[] {
    return [...this.partsEl.querySelectorAll<HTMLElement>('.part')];
  }

  update(cards: PartCard[], seats: string[], players: PlayerView[]): void {
    this.cards = cards;
    this.seats = seats;
    this.players = players;
    if (this.drag) {
      this.pending = true; // don't swap nodes under a drag; apply on drop/dragend
      return;
    }
    this.render();
  }

  private player(id: string): PlayerView {
    return this.players.find((p) => p.id === id) ?? { id, name: id === TV ? 'TV plays' : id === KEYBOARD ? 'Keyboard' : id, kind: id === TV ? 'tv' : id === KEYBOARD ? 'keyboard' : 'phone', online: false, ready: false, part: -1 };
  }

  private chip(p: PlayerView, from: number, detail: string): string {
    const cls = `chip k-${p.kind}${p.ready ? ' ready' : ''}${p.kind === 'phone' && !p.online ? ' off' : ''}${p.part < 0 && p.kind !== 'tv' ? ' bench' : ''}`;
    const name = p.kind === 'tv' ? 'TV plays' : esc(p.name);
    return `<span class="${cls}" draggable="true" data-player="${esc(p.id)}"${from >= 0 ? ` data-from="${from}"` : ''}>${icon(p.kind)} ${name}${p.ready ? ' <em title="Ready">✓</em>' : ''}${detail ? ` <small>${detail}</small>` : ''}</span>`;
  }

  private render(): void {
    // Player tray: phones (online), keyboard, TV.
    const tray = this.players
      .filter((p) => p.kind !== 'phone' || p.online)
      .map((p) => {
        const detail = p.kind === 'tv' ? '' : p.part >= 0 ? esc(this.cards[p.part]?.name ?? '') : p.kind === 'keyboard' ? 'A S D F' : 'not playing';
        return this.chip(p, -1, detail);
      })
      .join('');
    setHtml(this.tray, tray);

    // Part cards: rebuilt only when the arrangement changes; otherwise patched in place.
    const key = this.cards.map((c) => `${c.name}|${c.range}`).join('§');
    if (key !== this.structKey) {
      const focused = this.cardEls.indexOf(document.activeElement as HTMLElement);
      this.structKey = key;
      this.partsEl.style.setProperty('--n', String(Math.max(1, this.cards.length)));
      this.partsEl.innerHTML = this.cards
        .map(
          (_, i) =>
            `<div class="part" data-part="${i}" tabindex="0" role="button" aria-haspopup="listbox"><div class="part-head"></div><div class="bells part-bells"></div><div class="part-meta"></div><div class="part-seat"></div></div>`,
        )
        .join('');
      if (focused >= 0) this.cardEls[Math.min(focused, this.cards.length - 1)]?.focus();
    }
    this.cardEls.forEach((el, i) => {
      const c = this.cards[i];
      const occ = this.player(this.seats[i] ?? TV);
      el.classList.toggle('tv', occ.kind === 'tv');
      el.classList.toggle('ready', occ.ready);
      el.setAttribute('aria-label', `${c.name}, ${c.range}, difficulty ${c.level} of 5: ${occ.kind === 'tv' ? 'TV plays' : occ.name}${occ.ready ? ', ready' : ''}. Enter to choose who plays.`);
      el.setAttribute('aria-expanded', String(this.pickerPart === i));
      const [head, bells, meta, seat] = el.children;
      setHtml(head, `<b class="part-name">${esc(c.name)}</b><small>Ringer ${c.index + 1}</small>`);
      setHtml(
        bells,
        c.bells.map((b) => `<i class="${b.accidental ? 'acc' : ''}" style="background:${b.color}" title="${b.name}">${esc(b.name)}</i>`).join('') +
          (c.autoBells.length ? `<small> +${c.autoBells.map(esc).join(' ')} by TV</small>` : ''),
      );
      setHtml(
        meta,
        `<span class="meter lv${c.level}" title="Difficulty ${c.level} of 5">${'<i></i>'.repeat(5)}</span><span>${esc(c.range)} · ${c.notes} notes · ${c.perSec.toFixed(1)}/s</span>`,
      );
      setHtml(seat, this.chip(occ, i, ''));
    });

    if (this.pickerPart >= this.cards.length) this.closePicker(false);
    else if (this.pickerOpen) this.renderPicker();
  }

  // ── picker ─────────────────────────────────────────────────────────────────
  private options(): PlayerView[] {
    const tv = this.player(TV);
    const phones = this.players.filter((p) => p.kind === 'phone' && p.online);
    return [tv, ...phones, this.player(KEYBOARD)];
  }

  openPicker(part: number): void {
    if (part < 0 || part >= this.cards.length) return;
    this.pickerPart = part;
    this.activeId = this.seats[part] ?? TV;
    const card = this.cardEls[part];
    this.picker.hidden = false;
    this.picker.style.left = `${card.offsetLeft}px`;
    this.picker.style.top = `${card.offsetTop + card.offsetHeight + 4}px`;
    this.picker.style.minWidth = `${Math.max(200, card.offsetWidth)}px`;
    card.setAttribute('aria-expanded', 'true');
    this.renderPicker();
    this.picker.focus();
  }

  closePicker(refocus = true): void {
    const part = this.pickerPart;
    if (part < 0) return;
    this.pickerPart = -1;
    this.picker.hidden = true;
    const card = this.cardEls[part];
    card?.setAttribute('aria-expanded', 'false');
    if (refocus) card?.focus();
  }

  private renderPicker(): void {
    const c = this.cards[this.pickerPart];
    const opts = this.options();
    if (!opts.some((o) => o.id === this.activeId)) this.activeId = this.seats[this.pickerPart] ?? TV;
    setHtml(this.pickerTitle, `Who plays <b>${esc(c?.name ?? '')}</b>?`);
    setHtml(
      this.pickerList,
      opts
        .map((o, k) => {
          const current = this.seats[this.pickerPart] === o.id;
          const where = o.kind === 'tv' ? 'the TV rings it' : o.part >= 0 ? (current ? 'playing this' : `now: ${esc(this.cards[o.part]?.name ?? '')} → swap`) : o.kind === 'keyboard' ? 'A S D F on this PC' : 'not playing';
          return `<div role="option" id="seat-opt-${k}" class="opt${o.id === this.activeId ? ' active' : ''}${current ? ' current' : ''}" data-player="${esc(o.id)}" aria-selected="${current}">${icon(o.kind)} ${o.kind === 'tv' ? 'TV plays' : esc(o.name)}${o.ready ? ' ✓' : ''} <small>${where}</small></div>`;
        })
        .join(''),
    );
    const k = opts.findIndex((o) => o.id === this.activeId);
    this.picker.setAttribute('aria-activedescendant', `seat-opt-${k}`);
  }

  private moveActive(delta: number | 'first' | 'last'): void {
    const opts = this.options();
    const k = opts.findIndex((o) => o.id === this.activeId);
    const n = opts.length;
    const next = delta === 'first' ? 0 : delta === 'last' ? n - 1 : (k + delta + n) % n;
    this.activeId = opts[next].id;
    this.renderPicker();
  }

  private choose(id: string): void {
    const part = this.pickerPart;
    this.closePicker();
    if (part >= 0 && this.seats[part] !== id) this.act.assign(part, id);
  }

  // ── events ─────────────────────────────────────────────────────────────────
  private wire(): void {
    this.partsEl.addEventListener('click', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.part');
      if (!card) return;
      const i = Number(card.dataset.part);
      if (this.pickerPart === i) this.closePicker();
      else this.openPicker(i);
    });
    this.partsEl.addEventListener('keydown', (e) => {
      const card = (e.target as HTMLElement).closest<HTMLElement>('.part');
      if (!card || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      e.stopPropagation();
      this.openPicker(Number(card.dataset.part));
    });
    this.pickerList.addEventListener('click', (e) => {
      const opt = (e.target as HTMLElement).closest<HTMLElement>('[data-player]');
      if (opt) this.choose(opt.dataset.player!);
    });
    this.picker.addEventListener('keydown', (e) => {
      const keys: Record<string, () => void> = {
        ArrowDown: () => this.moveActive(1),
        ArrowUp: () => this.moveActive(-1),
        Home: () => this.moveActive('first'),
        End: () => this.moveActive('last'),
        ArrowLeft: () => {},
        ArrowRight: () => {},
        Enter: () => this.choose(this.activeId),
        ' ': () => this.choose(this.activeId),
        Escape: () => this.closePicker(),
        Backspace: () => this.closePicker(),
        Tab: () => this.closePicker(),
      };
      const f = keys[e.key];
      if (!f) return;
      e.preventDefault();
      e.stopPropagation();
      f();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!this.pickerOpen) return;
      const t = e.target as HTMLElement;
      if (!this.picker.contains(t) && !t.closest('.part')) this.closePicker(false);
    });

    // Drag and drop (mouse; the picker covers touch and remotes).
    this.root.addEventListener('dragstart', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('[data-player]');
      if (!chip || !e.dataTransfer) return;
      this.closePicker(false);
      this.drag = { player: chip.dataset.player!, from: chip.dataset.from !== undefined ? Number(chip.dataset.from) : -1 };
      e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(this.drag));
      e.dataTransfer.setData('text/plain', this.drag.player);
      e.dataTransfer.effectAllowed = 'move';
      this.root.classList.add('dragging');
    });
    const target = (e: DragEvent): HTMLElement | null => (e.target as HTMLElement).closest<HTMLElement>('.part, .tray');
    this.root.addEventListener('dragover', (e) => {
      const t = target(e);
      if (!t || !this.drag) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      this.root.querySelectorAll('.over').forEach((x) => x !== t && x.classList.remove('over'));
      t.classList.add('over');
    });
    this.root.addEventListener('dragleave', (e) => {
      const t = target(e);
      if (t && !t.contains(e.relatedTarget as Node | null)) t.classList.remove('over');
    });
    this.root.addEventListener('drop', (e) => {
      const t = target(e);
      let d = this.drag;
      if (!d) {
        try {
          d = JSON.parse(e.dataTransfer?.getData(DRAG_TYPE) ?? '');
        } catch {
          d = null;
        }
      }
      if (!t || !d) return;
      e.preventDefault();
      this.endDrag();
      if (t.classList.contains('part')) {
        const j = Number(t.dataset.part);
        // The seats may have changed during the drag (a phone claimed a part): move the player, not the index.
        if (d.from >= 0 && this.seats[d.from] === d.player) {
          if (d.from !== j) this.act.swap(d.from, j);
        } else if (d.from < 0 || d.player !== TV) this.act.assign(j, d.player);
      } else if (d.from >= 0 && d.player !== TV && this.seats[d.from] === d.player) this.act.unseat(d.from);
    });
    this.root.addEventListener('dragend', () => this.endDrag());
  }

  private endDrag(): void {
    if (!this.drag) return;
    this.drag = null;
    this.root.classList.remove('dragging');
    this.root.querySelectorAll('.over').forEach((x) => x.classList.remove('over'));
    if (this.pending) {
      this.pending = false;
      this.render();
    }
  }
}
