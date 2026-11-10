// ICE servers for both ends. The signalling service's /ice says what to use (STUN only by default;
// short-lived Cloudflare TURN credentials if the owner configured a TURN key). URL overrides, for
// tests and diagnosis:
//   ?ice=none                      no STUN/TURN (host candidates only: same LAN, no AP isolation)
//   ?turn=<url>&tu=<user>&tc=<pw>  add a TURN server (e.g. the dev server's local TURN)
//   ?relay=1                       force relayed paths (iceTransportPolicy 'relay'), to test TURN

export const DEFAULT_ICE: RTCIceServer[] = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

export interface IceConfig {
  iceServers: RTCIceServer[];
  iceTransportPolicy: RTCIceTransportPolicy;
  /** Where the servers came from (diagnostics). */
  source: string;
}

export async function iceConfig(signalOrigin: string, params = new URLSearchParams(location.search), fetchFn: typeof fetch = fetch): Promise<IceConfig> {
  const policy: RTCIceTransportPolicy = params.get('relay') === '1' ? 'relay' : 'all';
  let servers: RTCIceServer[] = DEFAULT_ICE;
  let source = 'default STUN';
  if (params.get('ice') === 'none') {
    servers = [];
    source = 'none';
  } else if (signalOrigin) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 3000);
      const r = await fetchFn(`${signalOrigin}/ice`, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(t);
      if (r.ok) {
        const j = (await r.json()) as { iceServers?: RTCIceServer[]; turn?: boolean };
        if (Array.isArray(j.iceServers)) {
          servers = j.iceServers;
          source = j.turn ? 'service STUN+TURN' : 'service STUN';
        }
      }
    } catch {
      /* keep the default */
    }
  }
  const turn = params.get('turn');
  if (turn) {
    servers = [...servers, { urls: turn, username: params.get('tu') ?? '', credential: params.get('tc') ?? '' }];
    source += ' + URL TURN';
  }
  return { iceServers: servers, iceTransportPolicy: policy, source };
}

/** 'relay' if the selected candidate pair goes through TURN, else 'direct'; '' if unknown yet. */
export async function routeOf(pc: RTCPeerConnection): Promise<{ route: string; local?: string; remote?: string; rttMs?: number }> {
  try {
    const stats = await pc.getStats();
    let pair: any;
    stats.forEach((s: any) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
    });
    if (!pair) stats.forEach((s: any) => {
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s;
    });
    if (!pair) return { route: '' };
    const local = stats.get(pair.localCandidateId) as any;
    const remote = stats.get(pair.remoteCandidateId) as any;
    const relay = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
    return {
      route: relay ? 'relay' : 'direct',
      local: local ? `${local.candidateType}/${local.protocol}` : undefined,
      remote: remote ? `${remote.candidateType}/${remote.protocol}` : undefined,
      rttMs: typeof pair.currentRoundTripTime === 'number' ? pair.currentRoundTripTime * 1000 : undefined,
    };
  } catch {
    return { route: '' };
  }
}
