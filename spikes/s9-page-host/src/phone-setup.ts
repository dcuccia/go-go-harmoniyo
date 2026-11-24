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

const validRoom = /^[A-Z0-9]{4,12}$/.test(room);
const target = document.getElementById('connection-target');
if (target && validRoom) target.textContent = `TV room ${room}`;

// The first RTCPeerConnection in a page pays the WebRTC stack start-up (~1.3 s in desktop
// Chrome on Windows, measured in S9). Pay it now, while the player is typing a name.
try {
  new RTCPeerConnection().close();
} catch {
  /* no WebRTC: PeerSocket reports it on connect */
}

const copy: Record<PhoneStatus, { title: string; detail?: string; problem?: boolean }> = {
  'looking-for-tv': { title: 'Finding the TV…' },
  connecting: { title: 'Connecting directly…' },
  'trying-relay': { title: 'Trying a relay…', detail: 'The direct connection didn’t open.' },
  'waiting-for-assignment': { title: 'Connected — waiting for your part' },
  connected: { title: 'Connected to the TV' },
  reconnecting: { title: 'Reconnecting to the TV…', detail: 'Keep this page open.' },
  'no-tv': { title: 'TV not found.', detail: 'Check that the host is still open, then scan its QR again.', problem: true },
  'invalid-invite': { title: 'Room or invitation unavailable.', detail: 'Scan a fresh QR on the TV.', problem: true },
  'no-network-path': { title: 'No connection to the TV.', detail: 'Try the same Wi-Fi as the TV and scan again.', problem: true },
  'relay-unavailable': { title: 'Relay unavailable.', detail: 'Try the same Wi-Fi as the TV, or scan a fresh QR.', problem: true },
};
let reconnecting = false;
setHgpSocketFactory(() => {
  const socket = new PeerSocket({
    signalOrigin: origin, room, peer, params, trial: protectedRoom, demo, invite, reconnecting,
    onStatus: (state) => {
      const main = document.getElementById('main');
      if (!main) return;
      main.dataset.s9Connection = validRoom ? state : 'invalid-invite';
      main.dispatchEvent(new CustomEvent('s9-connection', { detail: validRoom ? copy[state] : copy['invalid-invite'] }));
    },
  });
  reconnecting = true;
  return socket;
});
