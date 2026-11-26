import { appendFileSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { AiNodeClient, NodeError } from '../src/client.ts';
import { loadConfig, redact } from '../src/env.ts';
import { compare, MODEL, PROMPT_VERSION } from '../src/phrase-experiment.ts';
import { loadExcerpt, SONGS } from '../src/phrase-score.ts';
import { auditionOrder, renderWav } from '../src/phrase-audio.ts';

const { values } = parseArgs({ options: {
  output: { type: 'string' }, live: { type: 'boolean' }, 'long-effort': { type: 'string', default: 'high' },
} });
const longEffort = values['long-effort'];
if (!values.output || (longEffort !== 'high' && longEffort !== 'none')) {
  throw new Error('Usage: node scripts/compare-phrases.ts --output <new directory outside the repo> [--live] [--long-effort high|none]');
}
const requested = resolve(values.output);
const out = join(realpathSync(dirname(requested)), basename(requested));
const repo = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
const local = relative(repo, out);
if (!local || (!isAbsolute(local) && !local.startsWith(`..${sep}`))) throw new Error('Audition and logs must stay outside the repository');

async function main() {
  if (values.live && process.env.CUCCIA_AI_OFFLINE_GUARD) throw new Error('Live access is disabled under the offline test guard');
  const config = values.live ? loadConfig() : null;
  const client = config ? new AiNodeClient(config, { retry: { maxRetries: 0, timeoutMs: 90000 } }) : null;
  let node: Record<string, unknown> | null = null;
  if (client) {
    if (!client.hasToken) throw new Error('Set CUCCIA_AI_TOKEN in the process or Windows User environment');
    if (!await client.ensureAwake({ waitSeconds: 30, pollSeconds: 5 })) throw new Error('AI node did not wake within the probe window');
    const health = await client.health(5000);
    const status = await client.status();
    const models = await client.models();
    // The health busy bit can disagree with the authenticated scheduler's availability.
    const available = status.available === true
      ? status.mode === 'normal' && !status.lease && !status.running && status.llm_active === 0
      : status.available === undefined && health.ok && health.busy !== true;
    if (!available || !models.includes(MODEL)) throw new Error(`Node is not available for arranging or does not list ${MODEL}`);
    node = { healthOk: health.ok, healthBusy: health.busy, healthMs: health.latencyMs, models,
      agentVersion: status.version ?? status.agent_version ?? null,
      backendModelDigest: null };
  }
  mkdirSync(out, { mode: 0o700 });
  const meta = { time: new Date().toISOString(), node, nodeJs: process.version,
    prompt: PROMPT_VERSION, longEffort, modelTerms: 'https://huggingface.co/Qwen/Qwen3-8B/blob/main/LICENSE',
    modelTermsChecked: '2026-11-25',
    audio: { renderer: 'phrase-wav-v1', rate: 24000, rmsDbFS: -21 } };
  const write = (name: string, contents: string | Buffer) =>
    writeFileSync(join(out, name), contents, { flag: 'wx', mode: 0o600 });
  const scrub = (_: string, value: unknown) =>
    typeof value === 'string' ? redact(value, config?.token ?? null) : value;
  const log = (entry: unknown) => appendFileSync(join(out, 'private-runs.jsonl'),
    JSON.stringify(entry, scrub) + '\n', { mode: 0o600 });
  log(meta);
  const key: Record<string, string> = {};
  const sections: string[] = [];
  const rows = [];
  for (const id of SONGS) {
    const excerpt = loadExcerpt(id);
    log({ id, source: excerpt.source, sourceSha256LF: excerpt.sha256, excerptSha256: excerpt.inputSha256 });
    const result = await compare(excerpt, client ? (r) => client.chat(r) : undefined, (a) => log({ song: id, ...a }), longEffort);
    const variants = [{ id: 'procedural-baseline', assessment: result.baseline }];
    if (result.short) variants.push({ id: result.short.id, assessment: result.short.assessment });
    if (result.exploratory && result.exploratory.id !== result.short?.id) {
      variants.push({ id: result.exploratory.id, assessment: result.exploratory.assessment });
    }
    const controls = [];
    for (const v of auditionOrder(id, variants)) {
      const name = `${id}-${v.label}.wav`;
      write(name, renderWav(excerpt, v.assessment));
      key[name] = v.id;
      controls.push(`<p><label for="${v.label}-${id}">Clip ${v.label}</label> <audio id="${v.label}-${id}" controls preload="none" src="${name}"></audio></p>`);
    }
    sections.push(`<section><h2>${id.replaceAll('-', ' ')}</h2>${controls.join('\n')}</section>`);
    rows.push({
      song: id, baselineMs: result.baselineMs, baseline: result.baseline.metrics,
      attempts: result.attempts.map((a) => ({ id: a.id, valid: !a.errors.length, errors: a.errors,
        elapsedMs: a.elapsedMs, finish: a.result?.finishReason, completionTokens: a.result?.usage?.completion_tokens,
        reasoningReturned: a.result?.reasoningReturned,
        metrics: a.assessment?.metrics })),
      longerTotalMs: result.attempts.reduce((sum, a) => sum + a.elapsedMs, 0),
      shortlisted: result.winner?.id ?? null,
    });
  }
  write('listen.html', `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>S6 private audition</title><style>body{margin:2rem auto;max-width:42rem;padding:0 1rem;font:1rem system-ui}audio{vertical-align:middle}</style>
<h1>S6 private audition</h1>
<p>Listen before opening the private key or report. Compare phrasing (breath and contrast), harmonic motion into cadences, and whether the upper line sounds playable by four handbell ringers. Note favorites, ties or no preference for each song. Then check resemblance separately before considering promotion.</p>
${sections.join('\n')}\n`);
  write('private-key.json', JSON.stringify(key, null, 2));
  write('summary.json', JSON.stringify({ ...meta, rows }, scrub, 2));
  console.log(`Private audition written to ${out}`);
}

main().catch((e) => {
  // NodeError may contain service response text. Never print it from the harness.
  console.error(e instanceof NodeError ? `Node request failed (${e.status ?? 'no HTTP status'})` : (e as Error).message);
  process.exitCode = 1;
});
