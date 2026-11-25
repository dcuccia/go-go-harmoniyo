/**
 * Make the browser forget the typing in `input`, so nothing can be undone during play.
 *
 * iPadOS/iOS keep typed text on the page's undo stack. Ringing a bell is a shake, and a shake (or a
 * three-finger swipe/tap) is the system's undo gesture, so the "Undo Typing" Cancel/Undo dialog kept
 * popping up over the bells (owner's iPad Pro test, 2026-11-10). The page can't cancel that UIKit
 * gesture, but with an empty undo stack there is nothing to offer.
 *
 * - WebKit keeps one undo stack per page, and blurring or replacing the field does not clear it.
 *   Detaching a frame does: FrameLoader::detachFromParent → closeURL → Editor::clearUndoRedoOperations
 *   → ClearAllEditCommands. So we add and remove an empty hidden iframe.
 * - Chromium keeps the history per element: a fresh copy of the field has none.
 *
 * Checked with document.queryCommandEnabled('undo') in Playwright WebKit and Chrome (see
 * spikes/i2-web-phones/scripts/webkit-controller-check.mjs).
 */
export function forgetTyping(input: HTMLInputElement): HTMLInputElement {
  input.blur();
  const fresh = input.cloneNode() as HTMLInputElement;
  fresh.value = input.value;
  input.replaceWith(fresh);
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  document.body.append(frame);
  frame.remove();
  return fresh;
}

/**
 * Keep multi-finger touches and pinch gestures on the play surface from reaching the browser
 * (zoom, text selection, editing menus). Single touches keep working: zones use pointer events,
 * which fire before touchstart.
 */
export function blockMultiTouch(surface: HTMLElement, doc: Document = document): void {
  surface.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  // Safari only: pinch/rotate gestures.
  for (const type of ['gesturestart', 'gesturechange']) {
    doc.addEventListener(type, (e) => {
      if (e.target instanceof Node && surface.contains(e.target)) e.preventDefault();
    }, { passive: false });
  }
}
