import { baselinePlan, evaluate, parsePlan, CURVES, RHYTHMS, SECTIONS, type Evaluation, type Excerpt } from './phrase-score.ts';
import { NodeError, type ChatRequest, type ChatResult } from './client.ts';

export const MODEL = 'qwen3:8b';
export const PROMPT_VERSION = 'phrase-plan-v1';
type Chat = (request: ChatRequest) => Promise<ChatResult>;
type Attempt = {
  id: string;
  request: ChatRequest;
  result?: ChatResult;
  elapsedMs: number;
  assessment?: Evaluation;
  errors: string[];
};

function brief(excerpt: Excerpt) {
  const { score, sections, melody } = excerpt;
  const material = sections.map((starts, i) => {
    const from = starts[0];
    const to = sections[i + 1]?.[0] ?? score.endTick;
    return {
      section: SECTIONS[i], bars: starts.length,
      chords: score.chords.filter((c) => c.tick >= from && c.tick < to).map((c) => c.symbol),
      melodyOnsetsByBar: starts.map((start, j) => melody.filter((n) => n.tick >= start && n.tick < (starts[j + 1] ?? to)).length),
    };
  });
  return [
    `Plan a light upper-bell line over a fixed ${excerpt.meter}/4 carol in F. Melody and harmony already exist and must stay unchanged.`,
    'Plan the intro, four body phrases, and tonic coda. Make adjacent body phrases audibly distinct without crowding the tune.',
    `Reply ONLY with a JSON array of 6 arrays: one [rhythm, curve] pair for each section in order. Valid rhythms: ${RHYTHMS.join(', ')}. Valid curves: ${CURVES.join(', ')}.`,
    'space = held first-beat tone; answer = brief late-bar reply; pulse = two gentle attacks per bar. rise/arch/fall target the register, not exact pitches.',
    'A renderer chooses consonant pitches, avoids the pickup, gives the melody room at phrase ends, and forces a tonic on the last beat. Infeasible slots are dropped.',
    `Locked input summary: ${JSON.stringify(material)}`,
  ].join('\n');
}

function critique(a: Attempt) {
  if (!a.assessment) return `Draft unusable. ${a.errors.join('; ')}. Start a corrected plan from scratch.`;
  const { plan, phrasing, metrics } = a.assessment;
  return JSON.stringify({
    prior: plan.map(({ rhythm, curve }) => [rhythm, curve]),
    sections: phrasing,
    issues: a.errors,
    score: metrics.points, densityContrasts: metrics.contrasts, unusedSlots: metrics.losses,
    wideLeaps: metrics.wideLeaps, parallelPerfects: metrics.parallels.parallels,
    fourRingerViolations: metrics.violations,
  });
}

export function eligible(candidate: Evaluation, baseline: Evaluation): boolean {
  return candidate.problems.length === 0 && candidate.identity !== baseline.identity &&
    candidate.metrics.points > baseline.metrics.points &&
    candidate.metrics.violations <= baseline.metrics.violations &&
    candidate.metrics.maxBells <= baseline.metrics.maxBells &&
    candidate.metrics.parallels.parallels <= baseline.metrics.parallels.parallels;
}

export function proceduralBaseline(excerpt: Excerpt) {
  const plan = baselinePlan(excerpt.id);
  const anchor = evaluate(excerpt, plan);
  if (anchor.problems.length) throw new Error(`Invalid baseline for ${excerpt.id}: ${anchor.problems.join('; ')}`);
  let best = anchor;
  for (const [i, phrase] of plan.entries()) {
    // Polish the authored reference with a deterministic one-field neighborhood.
    for (const variant of [...RHYTHMS.map((rhythm) => ({ ...phrase, rhythm })),
      ...CURVES.map((curve) => ({ ...phrase, curve }))]) {
      if (variant.rhythm === phrase.rhythm && variant.curve === phrase.curve) continue;
      const current = evaluate(excerpt, plan.map((p, j) => i === j ? variant : p));
      if (eligible(current, anchor) && current.metrics.points > best.metrics.points) best = current;
    }
  }
  return best;
}

export function rank(attempts: Attempt[], baseline: Evaluation) {
  const seen = new Set([baseline.identity]);
  return attempts.filter((a): a is Attempt & { assessment: Evaluation } => {
    if (!a.assessment || a.errors.length || seen.has(a.assessment.identity)) return false;
    seen.add(a.assessment.identity);
    return true;
  }).sort((a, b) => b.assessment.metrics.points - a.assessment.metrics.points);
}

export async function compare(excerpt: Excerpt, chat?: Chat, record: (a: Attempt) => void = () => {}, longEffort: 'none' | 'high' = 'high') {
  const start = performance.now();
  const baseline = proceduralBaseline(excerpt);
  const baselineMs = Math.round(performance.now() - start);
  const attempts: Attempt[] = [];
  const prompt = brief(excerpt);
  async function ask(id: string, seed: number, effort: 'none' | 'high', previous?: Attempt) {
    const request: ChatRequest = {
      model: MODEL, temperature: 0.4, top_p: 0.9, seed, max_tokens: effort === 'none' ? 192 : 1536,
      reasoning_effort: effort,
      messages: [{ role: 'user', content: previous ? `${prompt}\n\nRevise your draft using this deterministic feedback: ${critique(previous)}. Address errors; keep contrast and reduce missed slots, parallel perfects and large leaps. Output the full revised array only.` : prompt }],
    };
    const a: Attempt = { id, request, elapsedMs: 0, errors: [] };
    const started = performance.now();
    try { a.result = await chat!(request); }
    catch (e) {
      if (!(e instanceof NodeError)) throw e;
      a.errors.push(e.status === null ? 'node request failed (no HTTP status)' : `node HTTP ${e.status}`);
    }
    a.elapsedMs = Math.round(performance.now() - started);
    if (a.result) {
      if (a.result.finishReason !== 'stop') a.errors.push(`incomplete response (${a.result.finishReason ?? 'missing finish reason'})`);
      else {
        let plan;
        try { plan = parsePlan(a.result.content); }
        catch (e) { a.errors.push((e as Error).message); }
        if (plan) {
          a.assessment = evaluate(excerpt, plan);
          a.errors.push(...a.assessment.problems);
        }
      }
    }
    attempts.push(a);
    record(a);
    return a;
  }
  if (chat) {
    const short = await ask('short-draft', 1101, 'none');
    const extra = await ask('second-draft', 1102, longEffort);
    await ask('short-revision', 1103, longEffort, short);
    await ask('second-revision', 1104, longEffort, extra);
  }
  const ranked = rank(attempts, baseline);
  const short = ranked.find((a) => a.id === 'short-draft');
  const winner = ranked.find((a) => eligible(a.assessment, baseline));
  // Auditioning a valid alternative is useful even if no variant clears the shortlist gate.
  const exploratory = winner ?? ranked[0];
  return { baseline, baselineMs, attempts, short, winner, exploratory };
}
