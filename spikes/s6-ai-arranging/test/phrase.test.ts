import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { AiNodeClient, NodeError, type ChatRequest } from '../src/client.ts';
import { auditionOrder, renderWav } from '../src/phrase-audio.ts';
import { compare, eligible, proceduralBaseline } from '../src/phrase-experiment.ts';
import { baselinePlan, evaluate, loadExcerpt, parsePlan, preservesScore, SONGS } from '../src/phrase-score.ts';

const encode = (plan: ReturnType<typeof baselinePlan>) => JSON.stringify(plan.map((p) => [p.rhythm, p.curve]));

test('model plans cannot add arbitrary notes, sections, or free-form text', () => {
  const plan = baselinePlan('deck-the-halls');
  assert.deepEqual(parsePlan(encode(plan)), plan);
  assert.throws(() => parsePlan(`\`\`\`json\n${encode(plan)}\n\`\`\``), /bare JSON array/);
  assert.throws(() => parsePlan(encode(plan.slice(1))), /six ordered/);
  assert.throws(() => parsePlan(encode(plan).replace('"pulse"', '72')), /intro/);
});

test('both excerpts preserve original melody, including Holly pickup, and lock tempo, chords, and meter', () => {
  for (const id of SONGS) {
    const excerpt = loadExcerpt(id);
    const { score, fixed, melody, sections } = excerpt;
    const baseline = proceduralBaseline(excerpt);
    assert.deepEqual(baseline.problems, []);
    assert.ok(baseline.metrics.contrasts >= 2);
    assert.equal(baseline.metrics.chordFit, baseline.line.length);
    assert.ok(baseline.metrics.maxBells > 0);
    assert.ok(baseline.metrics.violations > 0); // Full texture, not a repaired chart that can drop strikes.
    assert.equal(baseline.identity, proceduralBaseline(excerpt).identity);
    assert.equal(preservesScore(excerpt, baseline.line), true);
    assert.equal(preservesScore(excerpt, [...baseline.line, { ...baseline.line[0], midi: 99 }]), false);
    assert.equal(melody[0].tick, excerpt.offset);
    assert.ok(score.chords.some((c) => c.symbol.includes(id === 'deck-the-halls' ? 'G7' : 'F/C')));
    if (id === 'the-holly-and-the-ivy') {
      assert.equal(sections[1][1] - sections[1][0], score.ppq);
      assert.deepEqual(new Set(fixed.filter((n) => n.tick >= excerpt.offset && n.tick < excerpt.tail).map((n) => n.voice)), new Set(['S', 'A', 'T', 'B']));
    }
  }
});

test('paired budget retains the short draft, critiques valid and broken drafts, rejects truncation and duplicates', async () => {
  const excerpt = loadExcerpt('deck-the-halls');
  const plan = baselinePlan(excerpt.id);
  const requests: ChatRequest[] = [];
  const run = await compare(excerpt, async (req) => {
    requests.push(req);
    if (requests.length === 2) throw new NodeError('response body must not enter the critique', 503, true);
    return { content: encode(plan), model: 'fake', finishReason: requests.length === 3 ? 'length' : 'stop',
      usage: null, latencyMs: 1, totalMs: 1, attempts: 1, retries: [] };
  });
  assert.deepEqual(requests.map((r) => [r.seed, r.reasoning_effort]), [[1101, 'none'], [1102, 'high'], [1103, 'high'], [1104, 'high']]);
  assert.equal(requests[0].messages[0].content, requests[1].messages[0].content);
  assert.match(requests[2].messages[0].content, /fourRingerViolations/);
  assert.match(requests[3].messages[0].content, /node HTTP 503/);
  assert.doesNotMatch(requests[3].messages[0].content, /response body/);
  assert.deepEqual(run.attempts.map((a) => a.errors), [[], ['node HTTP 503'], ['incomplete response (length)'], []]);
  assert.equal(run.exploratory?.id, 'short-draft');
  assert.equal(run.winner, undefined);
  assert.equal(eligible(evaluate(excerpt, plan), run.baseline), false);
});

test('client preserves only the presence of returned reasoning metadata', async () => {
  const client = new AiNodeClient({ baseUrl: 'http://127.0.0.1', token: 'test', tokenSource: 'process' }, {
    fetch: async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: '[]', reasoning_content: 'private' } }] }),
  });
  const result = await client.chat({ reasoning_effort: 'high', messages: [] });
  assert.equal(result.content, '[]');
  assert.equal(result.reasoningReturned, true);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});

test('only different, valid strict improvements can make the shortlist', () => {
  const baseline = proceduralBaseline(loadExcerpt('deck-the-halls'));
  const improved = { ...baseline, identity: 'different', metrics: { ...baseline.metrics, points: baseline.metrics.points + 1 } };
  assert.equal(eligible(improved, baseline), true);
  assert.equal(eligible({ ...improved, identity: baseline.identity }, baseline), false);
  assert.equal(eligible({ ...improved, problems: ['invalid'] }, baseline), false);
  for (const [field, value] of [['points', baseline.metrics.points], ['violations', baseline.metrics.violations + 1],
    ['maxBells', baseline.metrics.maxBells + 1]] as const) {
    assert.equal(eligible({ ...improved, metrics: { ...improved.metrics, [field]: value } }, baseline), false, field);
  }
  const parallels = { ...baseline.metrics.parallels, parallels: baseline.metrics.parallels.parallels + 1 };
  assert.equal(eligible({ ...improved, metrics: { ...improved.metrics, parallels } }, baseline), false);
});

test('both renders use equal frame counts, one timbre path and matched RMS without clipping', () => {
  const excerpt = loadExcerpt('the-holly-and-the-ivy');
  const reference = proceduralBaseline(excerpt);
  const alternate = evaluate(excerpt, baselinePlan(excerpt.id));
  assert.notEqual(reference.identity, alternate.identity);
  const files = [reference, alternate].map((e) => renderWav(excerpt, e));
  assert.equal(files[0].length, files[1].length);
  assert.notDeepEqual(files[0], files[1]);
  for (const wav of files) {
    assert.equal(wav.toString('ascii', 36, 40), 'data');
    let squares = 0, peak = 0;
    const frames = wav.readUInt32LE(40) / 2;
    for (let i = 0; i < frames; i++) {
      const sample = wav.readInt16LE(44 + 2 * i) / 32767;
      squares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    assert.ok(Math.abs(10 * Math.log10(squares / frames) + 21) < 0.01);
    assert.ok(peak <= 10 ** (-1 / 20) + 1 / 32767);
  }
  const variants = [{ id: 'baseline' }, { id: 'short' }, { id: 'long' }];
  const labels = auditionOrder(excerpt.id, variants);
  assert.deepEqual(labels, auditionOrder(excerpt.id, variants.reverse()));
  assert.deepEqual(labels.map((v) => v.label), ['A', 'B', 'C']);
});

test('CLI makes an offline listen page and key, but refuses in-repo output and live under the guard', () => {
  const dir = mkdtempSync(join(tmpdir(), 's6-offline-'));
  const script = fileURLToPath(new URL('../scripts/compare-phrases.ts', import.meta.url));
  const guard = new URL('./offline-guard.ts', import.meta.url).href;
  const out = join(dir, 'audition');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ['--import', guard, script, '--output', ...args], { encoding: 'utf8' });
  try {
    const blocked = run(out, '--live');
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /offline test guard/);
    const unsafe = run(join(process.cwd(), 's6-must-not-be-created'));
    assert.notEqual(unsafe.status, 0);
    assert.match(unsafe.stderr, /outside the repository/);
    const offline = run(out);
    assert.equal(offline.status, 0, offline.stderr);
    const page = readFileSync(join(out, 'listen.html'), 'utf8');
    const key = JSON.parse(readFileSync(join(out, 'private-key.json'), 'utf8'));
    assert.doesNotMatch(page, /procedural-baseline/);
    assert.deepEqual(Object.keys(key).sort(), SONGS.map((id) => `${id}-A.wav`).sort());
    for (const name of Object.keys(key)) assert.ok(page.includes(name));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
