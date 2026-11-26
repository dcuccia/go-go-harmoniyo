// Translate Android remote buttons; the shared I2 screen owns focus, layers and navigation.

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

/** Exit only if the shared screen has no active panel or round to close. */
export function back(): void {
  const unhandled = window.dispatchEvent(new Event('i2-back', { cancelable: true }));
  if (unhandled && visible('lobby')) void capApp()?.exitApp();
}

export function installTvInput(): void {
  capApp()?.addListener('backButton', back);

  window.addEventListener('keydown', (e) => {
    const t = document.activeElement as HTMLElement | null;
    // Android TV D-pad centre arrives as key 'Enter' without a code (keyCode 23 on some WebViews).
    if ((e.key === 'Enter' && !e.code) || e.keyCode === 23) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (t?.matches('button, a[href], summary, [role="button"], input[type="checkbox"]')) t.click();
      else if (t instanceof HTMLSelectElement && e.isTrusted && navigator.userActivation?.isActive) t.showPicker?.();
      else (t ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
      return;
    }
    if (e.key === 'GoBack' || e.key === 'BrowserBack') {
      e.preventDefault();
      back();
    }
  });
}
