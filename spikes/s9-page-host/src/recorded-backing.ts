import { prepareRecordedBacking } from '../../i2-web-phones/src/backing/preview-player';
import type { PreviewForm } from '../../i2-web-phones/src/backing/preview-score';
import type { S5Chart, S5Part } from '../../i2-web-phones/src/team-chart';

async function get(path: string): Promise<Response> {
  const response = await fetch(`./backing/${path}`, { signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Backing asset ${path}: HTTP ${response.status}`);
  return response;
}

export async function prepareS9Backing(ctx: BaseAudioContext, chart: S5Chart, part: S5Part, form: PreviewForm, sourceHash: string) {
  const { events, sourceHash: hash } = await (await get(`${form}/${chart.song.id}.json`)).json();
  if (hash !== sourceHash || chart.form?.id !== form) throw new Error('Recorded backing does not match the selected chart form');
  return prepareRecordedBacking(ctx, chart, part, events, (note) => get(`samples/KSHarp_${note}_mf.wav`));
}
