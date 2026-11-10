// S9: TV remote and tablet input for the app shells. The I2 lobby already supports arrows/Enter
// (lobbyNav in main.ts); this adds what a TV remote needs on top: a visible focus ring, D-pad
// centre → Enter, results-screen navigation, and the Back key (Escape in game, exit in the lobby).
const FOCUS_CSS = `
button:focus-visible, [role="button"]:focus-visible, select:focus-visible, a:focus-visible {
  outline: 3px solid #f3b01d; outline-offset: 3px;
}`;

interface CapacitorApp {
  addListener(ev: 'backButton', cb: (e: { canGoBack: boolean }) => void): unknown;
  exitApp(): Promise<void>;
}

function capApp(): CapacitorApp | undefined {
  return (window as { Capacitor?: { Plugins?: { App?: CapacitorApp } } }).Capacitor?.Plugins?.App;
}

const visible = (id: string): boolean => {
  const el = document.getElementById(id);
  return !!el && !el.classList.contains('hidden');
};

function escape(): void {
  for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', bubbles: true }));
}

/** Back: leave a song or the results screen; in the lobby, close the app. */
export function back(): void {
  const inLobby = visible('lobby') && !visible('results');
  if (inLobby) void capApp()?.exitApp();
  else escape();
}

export function installTvInput(): void {
  const style = document.createElement('style');
  style.textContent = FOCUS_CSS;
  document.head.append(style);

  capApp()?.addListener('backButton', back);

  // Registered before the game's own keydown handler (tv-setup is imported first), so it can
  // translate keys the game doesn't know and keep arrows on the results buttons.
  window.addEventListener('keydown', (e) => {
    const t = document.activeElement as HTMLElement | null;
    // Android TV D-pad centre arrives as key 'Enter' without a code (keyCode 23 on some WebViews).
    if ((e.key === 'Enter' && !e.code) || e.keyCode === 23) {
      if (t && t !== document.body && (t.tagName === 'BUTTON' || t.getAttribute('role') === 'button')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        t.click();
      } else if (!e.code) {
        e.stopImmediatePropagation();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      }
      return;
    }
    if (e.key === 'GoBack' || e.key === 'BrowserBack') {
      e.preventDefault();
      back();
      return;
    }
    if (visible('results') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      const buttons = [...document.querySelectorAll<HTMLElement>('#results button')].filter((b) => b.offsetParent !== null);
      if (!buttons.length) return;
      const i = buttons.indexOf(t as HTMLElement);
      const step = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
      buttons[i < 0 ? 0 : (i + step + buttons.length) % buttons.length].focus();
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  });

  // Give the results screen a focused button so the remote has somewhere to start.
  const results = document.getElementById('results');
  if (results) {
    new MutationObserver(() => {
      if (visible('results') && !results.contains(document.activeElement)) document.getElementById('btn-again')?.focus();
    }).observe(results, { attributes: true, attributeFilter: ['class'] });
  }
}
