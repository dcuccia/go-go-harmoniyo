// S9 TV/tablet entry setup: run the HGP host in this page and point the game's link at it.
// Imported before the game (tv.ts), so the transport is in place when the game creates its link.
import { setLinkTransport } from '../../i2-web-phones/src/hgp-link.ts';
import { isAppShell, roomCode, setSignalOrigin, signalOrigin } from './config.ts';
import { installTvInput } from './tv-input.ts';
import { PageHost } from './page-host.ts';
import { qrDataUrl } from './qr.ts';

const params = new URLSearchParams(location.search);
const origin = signalOrigin(params);
const room = roomCode(params);

export const host = new PageHost({ signalOrigin: origin, room, params, forward: ['ice', 'relay', 'turn', 'tu', 'tc'] });
setLinkTransport({ socket: () => host.gameSocket(), qrSrc: qrDataUrl });
host.start();
(window as { __s9host?: PageHost }).__s9host = host;

installTvInput();

// Keep a TV/tablet awake during a session (the Android shell also sets FLAG_KEEP_SCREEN_ON).
async function wake(): Promise<void> {
  try {
    await (navigator as { wakeLock?: { request(t: string): Promise<unknown> } }).wakeLock?.request('screen');
  } catch {
    /* not allowed or not supported */
  }
}
void wake();
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void wake());

// A small badge: room, signalling state, and a way to change the service (the app shell has no URL bar).
function badge(): void {
  const el = document.createElement('div');
  el.id = 's9-badge';
  el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:50;font:12px system-ui,sans-serif;color:#cfd3e6;background:#0b0d17cc;padding:4px 8px;border-radius:6px;display:flex;gap:8px;align-items:center';
  const text = document.createElement('span');
  const btn = document.createElement('button');
  btn.textContent = 'Service…';
  btn.style.cssText = 'font:inherit;padding:2px 6px';
  btn.onclick = () => {
    const v = window.prompt('Signalling service (https://…), empty to reset', origin);
    if (v === null) return;
    try {
      setSignalOrigin(v);
      location.reload();
    } catch (e) {
      window.alert(String(e instanceof Error ? e.message : e));
    }
  };
  el.append(text, btn);
  const render = () => {
    const s = host.signalState;
    const phones = host.session.phones().length;
    text.textContent = `S9 · host in this page · room ${room} · ${s === 'open' ? 'signalling ok' : s === 'no-service' ? 'no signalling service' : s}${phones ? ` · ${phones} phone${phones > 1 ? 's' : ''}` : ''}${isAppShell() ? ' · app' : ''}`;
  };
  host.onChange = render;
  setInterval(render, 2000);
  render();
  document.body.append(el);
  if (!origin) btn.click();
}
if (document.readyState === 'loading') addEventListener('DOMContentLoaded', badge);
else badge();
