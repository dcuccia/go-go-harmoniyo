import { loadHarp, prepareRecordedBacking } from '../../i2-web-phones/src/backing/preview-player';
import type { PreviewForm } from '../../i2-web-phones/src/backing/preview-score';
import type { S5Chart, S5Part } from '../../i2-web-phones/src/team-chart';

declare const __S9_HARP_BANK__: { version: string; notes: string[] };

async function get(path: string): Promise<Response> {
  const response = await fetch(`./backing/${path}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Backing asset ${path}: HTTP ${response.status}`);
  return response;
}

const sample = (note: string) => get(`audio/${__S9_HARP_BANK__.version}/KSHarp_${note}_mf.wav`);
const scores = new Map<string, Promise<{ events: unknown; sourceHash: string }>>();

export async function preloadS9Harp(ctx: BaseAudioContext): Promise<void> {
  const { notes, version } = __S9_HARP_BANK__;
  const results = await Promise.allSettled(notes.map((note) => loadHarp(ctx, note, sample, version)));
  const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failed) throw failed.reason;
}

export async function prepareS9Backing(ctx: BaseAudioContext, chart: S5Chart, part: S5Part, form: PreviewForm, sourceHash: string, scoreReady: () => void) {
  const key = `${form}/${chart.song.id}.json`;
  let pending = scores.get(key);
  if (!pending) {
    pending = get(key).then((r) => r.json()).catch((error: unknown) => {
      scores.delete(key);
      throw error;
    });
    scores.set(key, pending);
  }
  const { events, sourceHash: hash } = await pending;
  try {
    if (hash !== sourceHash || chart.form?.id !== form) throw new Error('Recorded backing does not match the selected chart form');
    scoreReady();
    return await prepareRecordedBacking(ctx, chart, part, events, sample, __S9_HARP_BANK__.version);
  } catch (error) {
    scores.delete(key);
    throw error;
  }
}
