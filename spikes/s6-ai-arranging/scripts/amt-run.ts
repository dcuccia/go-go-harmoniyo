// Anticipatory Music Transformer runs for the comparison set: export each song's melody as
// melody.mid, then run the accompaniment CLI (amt/amt_accompany.py) locally, on the compute node
// (once infra has registered the workload), or against the offline mock.
//   node scripts/amt-run.ts --local [--python <venv python>] [--model-dir <snapshot>] [--songs a,b]
//   node scripts/amt-run.ts --node  [--workload go-go-harmoniyo-amt]
//   node scripts/amt-run.ts --mock
// Outputs: results/amt/<song>/{melody.mid,args.json,accompaniment.mid,combined.mid,report.json}
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AiNodeClient } from '../src/client.ts';
import { describe, loadConfig } from '../src/env.ts';
import { melodyMidi } from '../src/midi-io.ts';
import { startMockNode } from '../src/mock-node.ts';
import { loadS5Song } from '../src/songs.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const mode = argv.includes('--node') ? 'node' : argv.includes('--mock') ? 'mock' : 'local';
const songs = (opt('songs', 'the-holly-and-the-ivy,deck-the-halls') as string).split(',');
const args = { top_p: Number(opt('top-p', '0.95')), seed: Number(opt('seed', '1')), drop_drums: true };

for (const id of songs) {
  const s = loadS5Song(id);
  const dir = join(root, 'results', 'amt', id);
  mkdirSync(dir, { recursive: true });
  // Melody on GM program 0 (piano): the most common lead in AMT's training data (Lakh MIDI).
  writeFileSync(join(dir, 'melody.mid'), melodyMidi(s.score, s.melody, 0));
  writeFileSync(join(dir, 'args.json'), JSON.stringify(args, null, 2) + '\n');
  const t0 = performance.now();
  if (mode === 'local') {
    const py = opt('python') ?? process.env.AMT_PYTHON;
    const modelDir = opt('model-dir') ?? process.env.AMT_MODEL_DIR;
    if (!py || !modelDir) throw new Error('--local needs --python and --model-dir (or AMT_PYTHON / AMT_MODEL_DIR)');
    const r = spawnSync(py, [join(root, 'amt', 'amt_accompany.py')], { env: { ...process.env, AMT_INPUTS: dir, AMT_OUTPUTS: dir, AMT_MODEL_DIR: modelDir, HF_HUB_OFFLINE: '1', TQDM_DISABLE: '1' }, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`amt failed for ${id}: ${r.stderr.slice(-2000)}`);
  } else {
    const mock = mode === 'mock' ? await startMockNode({ workloads: { 'go-go-harmoniyo-amt': (inp) => new Map([['accompaniment.mid', inp.get('melody.mid')!], ['report.json', new TextEncoder().encode('{"mock":true}')]]) } }) : null;
    const cfg = mock ? { baseUrl: mock.url, token: 'mock-token', tokenSource: 'process' as const } : loadConfig();
    console.log(`node: ${describe(cfg)}`);
    const c = new AiNodeClient(cfg);
    try {
      const jobId = await c.submitJob(opt('workload', 'go-go-harmoniyo-amt') as string, args, [{ name: 'melody.mid', data: readFileSync(join(dir, 'melody.mid')) }]);
      const j = await c.waitJob(jobId, { pollMs: 3000, onState: (x) => console.log(`  ${id}: ${x.state}`) });
      if (j.state !== 'succeeded') throw new Error(`job ${jobId} ${j.state}: ${j.error ?? ''}\n${await c.logs(jobId)}`);
      for (const o of await c.outputs(jobId)) writeFileSync(join(dir, o.name), await c.download(jobId, o.name));
    } finally {
      await mock?.close();
    }
  }
  const ms = Math.round(performance.now() - t0);
  const rep = existsSync(join(dir, 'report.json')) ? JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) : {};
  rep.wallMs = ms;
  rep.mode = mode;
  writeFileSync(join(dir, 'report.json'), JSON.stringify(rep, null, 2) + '\n');
  console.log(`${id}: ${mode} AMT done in ${(ms / 1000).toFixed(1)} s (${rep.accompaniment_events ?? '?'} accompaniment notes)`);
}
