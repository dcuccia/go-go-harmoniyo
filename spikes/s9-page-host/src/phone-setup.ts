// S9 phone entry setup: point the S1 controller's HGP connection at the TV page over WebRTC.
// Imported before the controller (phone.ts), so the factory is in place when it connects.
import { setHgpSocketFactory } from '../../s1-phone-bell/src/web/hgp-client.ts';
import { signalOrigin } from './config.ts';
import { PeerSocket } from './peer-socket.ts';

const params = new URLSearchParams(location.search);
const room = (params.get('r') ?? '').toUpperCase();
const origin = signalOrigin(params);
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

setHgpSocketFactory(() => new PeerSocket({ signalOrigin: origin, room, peer, params }));
