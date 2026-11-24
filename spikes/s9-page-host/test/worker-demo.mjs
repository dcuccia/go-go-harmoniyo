// Local-only Wrangler entry point for the demo E2E. It keeps the production Worker routes and
// Durable Objects, replacing only the Cloudflare TURN provider call with a deterministic response.
import worker, { SignalRoom, TurnTrial, TurnDemo as ProductionTurnDemo } from '../worker/index.js';
import { mintTurn } from '../worker/turn-trial.mjs';

export class TurnDemo extends ProductionTurnDemo {
  async mint(ttl) {
    const fakeFetch = async (_url, _init) => this.env.S9_DEMO_UNAVAILABLE === '1'
      ? new Response(null, { status: 503 })
      : Response.json({
        iceServers: [{
          urls: [`turn:127.0.0.1:${this.env.S9_DEMO_TURN_PORT || 18965}?transport=udp`],
          username: 's9',
          credential: 's9-local',
        }],
      });
    return mintTurn(this.env, ttl, fakeFetch);
  }
}

export { SignalRoom, TurnTrial };
export default worker;
