// S9 phone entry setup: point the S1 controller's HGP connection at the TV page over WebRTC.
// Imported before the controller (phone.ts), so the factory is in place when it connects.
import { setHgpSocketFactory } from '../../s1-phone-bell/src/web/hgp-client.ts';
import { signalOrigin } from './config.ts';
import { PeerSocket, type PhoneStatus } from './peer-socket.ts';
import { trialInvite } from './turn-trial.ts';
import { demoInvite } from './turn-demo.ts';

const params = new URLSearchParams(location.search);
const room = (params.get('r') ?? '').toUpperCase();
const protectedRoom = params.get('trial') === '1';
const demo = !protectedRoom && params.get('demo') === '1';
// Never forward a private invitation to an origin chosen by a query parameter or saved config.
const origin = protectedRoom || demo ? location.origin : signalOrigin(params);
const invite = protectedRoom ? trialInvite(room, location.hash) : demo ? demoInvite(room, location.hash) : '';
const peer = `p-${Math.random().toString(36).slice(2, 10)}`;

if (!/^[A-Z0-9]{4,12}$/.test(room)) {
  // The controller still loads; tell the player what's wrong instead of retrying forever.
  addEventListener('DOMContentLoaded', () => {
    const el = document.getElementById('status') ?? document.body;
    el.textContent = 'No room code in this link: scan the QR on the TV again.';
  });
}

// The first RTCPeerConnection in a page pays the WebRTC stack start-up (~1.3 s in desktop
// Chrome on Windows, measured in S9). Pay it now, while the player is typing a name.
try {
  new RTCPeerConnection().close();
} catch {
  /* no WebRTC: PeerSocket reports it on connect */
}

const failureCopy: Partial<Record<PhoneStatus, string>> = {
  'no-tv': 'TV not found. Check that the host is still open, then scan its QR again.',
  'invalid-invite': 'Room or invitation unavailable. Scan a fresh QR on the TV.',
  'no-network-path': 'No connection to the TV. Try the same Wi-Fi as the TV and scan again.',
  'relay-unavailable': 'Relay unavailable. Try the same Wi-Fi as the TV, or scan a fresh QR.',
};
let notice: HTMLParagraphElement | undefined;
let reconnecting = false;
setHgpSocketFactory(() => {
  const socket = new PeerSocket({
    signalOrigin: origin, room, peer, params, trial: protectedRoom, demo, invite, reconnecting,
    onStatus: (state) => {
      const main = document.getElementById('main');
      if (!main) return;
      main.dataset.s9Connection = state;
      const failure = failureCopy[state];
      if (!notice && failure) {
        notice = document.createElement('p');
        notice.setAttribute('role', 'status');
        main.prepend(notice);
      }
      if (notice && (failure || state === 'waiting-for-assignment' || state === 'connected')) {
        notice.hidden = !failure;
        notice.textContent = failure ?? '';
      }
    },
  });
  reconnecting = true;
  return socket;
});
