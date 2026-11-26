import type { Difficulty } from './team-chart';

export const difficultyLabels = {
  'super-easy': 'Super easy',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  expert: 'Expert',
} satisfies Record<Difficulty, string>;

const controls = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href], summary, [role="button"]')]
    .filter((el) => el.getClientRects().length > 0);

function navigateRows(rows: HTMLElement[][], target: HTMLElement, key: string): void {
  const nonempty = rows.filter((row) => row.length);
  const r = nonempty.findIndex((row) => row.includes(target));
  if (r < 0) {
    nonempty[0]?.[0].focus();
    return;
  }
  const row = nonempty[r];
  const c = row.indexOf(target);
  if (key === 'ArrowLeft' || key === 'ArrowRight') row[c + (key === 'ArrowLeft' ? -1 : 1)]?.focus();
  else {
    const next = nonempty[r + (key === 'ArrowUp' ? -1 : 1)];
    next?.[Math.min(c, next.length - 1)]?.focus();
  }
}

export class RoundNavigation {
  private layers: { dialog: HTMLDialogElement; opener: HTMLElement }[] = [];

  get panel(): HTMLDialogElement | undefined {
    return this.layers.at(-1)?.dialog;
  }

  open(dialog: HTMLDialogElement, opener: HTMLElement, initial?: HTMLElement): void {
    if (dialog.open) return;
    dialog.showModal();
    this.layers.push({ dialog, opener });
    (initial ?? controls(dialog)[0])?.focus();
  }

  close(): boolean {
    const layer = this.layers.pop();
    if (!layer) return false;
    layer.dialog.close();
    layer.opener.focus();
    return true;
  }

  dismissAll(): void {
    while (this.close()) { /* unwind nested modals */ }
  }

  key(e: KeyboardEvent, target: HTMLElement, rows: HTMLElement[][], pickerOpen: boolean): boolean {
    const panel = this.panel;
    if (pickerOpen) return e.key.startsWith('Arrow'); // The seating picker owns its own arrows.
    if (panel && e.key === 'Tab') {
      const list = controls(panel);
      if (target === (e.shiftKey ? list[0] : list.at(-1))) {
        (e.shiftKey ? list.at(-1) : list[0])?.focus();
        e.preventDefault();
      }
      return true;
    }
    if (!e.key.startsWith('Arrow') || (!panel && !rows.length)) return false;
    const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
    if (horizontal && target instanceof HTMLInputElement && target.type === 'range') return true;
    if (horizontal && target instanceof HTMLSelectElement) {
      const step = e.key === 'ArrowLeft' ? -1 : 1;
      for (let next = target.selectedIndex + step; target.options[next]; next += step) {
        if (target.options[next].disabled) continue;
        target.selectedIndex = next;
        target.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    } else {
      const panelRows = panel?.id === 'seating-options' ? rows
        : panel ? controls(panel).map((el) => [el]) : rows;
      const actions = horizontal && panel?.classList.contains('round-prompt') ? target.closest('.buttons') : null;
      navigateRows(actions ? [controls(actions)] : panelRows, target, e.key);
    }
    e.preventDefault();
    return true;
  }
}

export { controls };
