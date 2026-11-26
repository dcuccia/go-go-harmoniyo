import type { S5Chart, S5Part } from '../team-chart';
import { protectBells, scoreEvents, type PreviewForm } from './preview-score';
import { harpSample } from './preview-samples';
import type { TrackPreview } from './track';

const request = async (path: string): Promise<Response> => {
  const res = await fetch(`/api/backing-preview/${path}`, { headers: { 'X-Backing-Preview': '1' } });
  if (!res.ok) throw new Error(`Local backing preview is unavailable (${res.status}); reopen the TV URL printed by npm start with --backing-preview.`);
  return res;
};

const decoded = new Map<number, Promise<AudioBuffer>>();

export async function preparePreview(ctx: BaseAudioContext, chart: S5Chart, part: S5Part, form: PreviewForm, sourceHash: string): Promise<TrackPreview> {
  const { events, sourceHash: hash } = await (await request(`${chart.song.id}/${form}`)).json();
  if (hash !== sourceHash || chart.form?.id !== form) throw new Error('Backing preview and the selected chart form do not match.');
  return prepareRecordedBacking(ctx, chart, part, events, (note) => request(`sample/${note}`));
}

export async function prepareRecordedBacking(ctx: BaseAudioContext, chart: S5Chart, part: S5Part, input: unknown,
                                             sample: (note: string) => Promise<Response>): Promise<TrackPreview> {
  const authored = scoreEvents(input, chart);
  const events = protectBells(authored, chart, part);

  const samples = new Map<number, AudioBuffer>();
  const harp = new Set(events.filter((e) => e.voice === 'harp').map((e) => harpSample(e.midi)));
  await Promise.all([...harp].map(async ([midi, note]) => {
    let active = decoded.get(midi);
    if (!active) {
      active = sample(note).then((res) => res.arrayBuffer()).then((bytes) => ctx.decodeAudioData(bytes))
        .catch((e: unknown) => {
          decoded.delete(midi);
          throw new Error(`Cannot load the recorded harp sample ${note}: ${String(e)}`);
        });
      decoded.set(midi, active);
    }
    samples.set(midi, await active);
  }));
  return {
    events,
    playHarp(e, when, output) {
      const [midi, , , onset, peak] = harpSample(e.midi);
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = samples.get(midi)!;
      source.playbackRate.value = 2 ** ((e.midi - midi) / 12);
      const trim = Math.max(0, onset - 0.002);
      const stop = when + Math.min(e.dur, (source.buffer.duration - trim) / source.playbackRate.value);
      const level = Math.min(7, 0.13 / peak) * e.vel;
      gain.gain.setValueAtTime(level, when);
      gain.gain.setValueAtTime(level, Math.max(when, stop - 0.09));
      gain.gain.linearRampToValueAtTime(0, stop);
      source.connect(gain).connect(output);
      source.onended = () => { source.disconnect(); gain.disconnect(); };
      source.start(when, trim);
      source.stop(stop);
    },
  };
}
