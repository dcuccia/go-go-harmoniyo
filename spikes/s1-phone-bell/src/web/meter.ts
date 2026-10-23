import { analyzeOnsets, encodeWav } from '../core/onsets.ts';
import { fmt } from '../core/stats.ts';
import { audio, TEST_BEEP_HZ } from './audio.ts';
import { deviceId, HgpClient } from './hgp-client.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const client = new HgpClient({ kind: 'meter', deviceId: `meter-${deviceId()}`, name: 'latency-meter', syncIntervalMs: 2000 });
client.connect();

let chunks: Float32Array[] = [];
let stream: MediaStream | null = null;
let node: ScriptProcessorNode | null = null;

$('rec').addEventListener('click', async () => {
  const ctx = audio();
  await ctx.resume();
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const src = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but universally available (incl. iOS Safari); fine for a meter.
  node = ctx.createScriptProcessor(4096, 1, 1);
  chunks = [];
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  src.connect(node);
  node.connect(ctx.destination);
  $('rec').toggleAttribute('disabled', true);
  $('stop').toggleAttribute('disabled', false);
  $('state').textContent = `Recording at ${ctx.sampleRate} Hz…`;
});

$('stop').addEventListener('click', async () => {
  node?.disconnect();
  stream?.getTracks().forEach((t) => t.stop());
  const sr = audio().sampleRate;
  const len = chunks.reduce((s, c) => s + c.length, 0);
  const x = new Float32Array(len);
  let o = 0;
  for (const c of chunks) {
    x.set(c, o);
    o += c.length;
  }
  const r = analyzeOnsets(x, sr, TEST_BEEP_HZ);
  const label = ($('label') as HTMLInputElement).value || 'meter';
  const text = [
    `${label}: ${(len / sr).toFixed(1)} s recorded, ${r.knocks.length} knocks, ${r.tones.length} beeps, ${r.pairs.length} pairs`,
    `knock → beep delay (ms): p50 ${fmt(r.delay.p50)}  p95 ${fmt(r.delay.p95)}  min ${fmt(r.delay.min)}  max ${fmt(r.delay.max)}  sd ${fmt(r.delay.sd)}`,
    `delays: ${r.pairs.map((p) => p.delay).join(', ')}`,
  ].join('\n');
  $('out').textContent = text;
  client.send({ type: 'result', test: 'latency-meter', data: { label, sampleRate: sr, seconds: len / sr, knocks: r.knocks.length, tones: r.tones.length, delay: r.delay, delays: r.pairs.map((p) => p.delay), ua: navigator.userAgent } });
  const wav = encodeWav(x, sr);
  const res = await fetch(`/api/upload?name=${encodeURIComponent(label)}.wav`, { method: 'POST', body: wav });
  $('state').textContent = res.ok ? 'Uploaded WAV to host.' : 'Upload failed.';
  $('rec').toggleAttribute('disabled', false);
  $('stop').toggleAttribute('disabled', true);
});
