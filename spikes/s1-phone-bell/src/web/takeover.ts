/**
 * "This phone is connected in another tab — [Use this tab]". A full-screen overlay for a controller
 * tab that is not (or no longer) the phone's active one: a second tab opened from the TV's join QR,
 * or the old tab after the user took over in a new one. Self-contained (builds its own DOM and
 * styles) so the controller page only wires it up.
 */
export type TakeoverReason = 'other-tab' | 'replaced';

export interface TakeoverScreen {
  show(reason: TakeoverReason): void;
  hide(): void;
  readonly shown: boolean;
}

const CSS = `
#takeover{position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1em;
  padding:2em 1.2em;background:rgba(17,17,17,.97);text-align:center}
#takeover h2{margin:0;font-size:1.4em}
#takeover p{margin:0;max-width:24em}
`;

export function takeoverScreen(onUse: () => void): TakeoverScreen {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const el = document.createElement('section');
  el.id = 'takeover';
  el.hidden = true;
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-labelledby', 'takeover-title');
  el.innerHTML =
    '<h2 id="takeover-title">📱 This phone is connected in another tab</h2>' +
    '<p id="takeover-msg"></p>' +
    '<button id="takeover-use" class="big">Use this tab</button>' +
    '<p class="small">Only one tab per phone can be the bell. You can also just switch back to the other tab.</p>';
  document.body.appendChild(el);
  const btn = el.querySelector<HTMLButtonElement>('#takeover-use')!;
  btn.addEventListener('click', () => {
    el.hidden = true;
    onUse();
  });
  return {
    show(reason) {
      el.querySelector('#takeover-msg')!.textContent =
        reason === 'replaced' ? 'Another tab on this phone took over as the bell, so this one stopped.' : 'The bell is already running in another tab on this phone (it keeps playing).';
      el.dataset.reason = reason;
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
    get shown() {
      return !el.hidden;
    },
  };
}
