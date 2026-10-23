import { matchNearest } from '../core/match.ts';
import { centeredAbs, fmt, summarize, type Summary } from '../core/stats.ts';

export interface LoggedGesture {
  deviceId: string;
  g: string;
  seq: number;
  /** device-mapped host time */
  th: number;
  /** host receive time */
  rx: number;
  det?: number;
  via: string;
  bell?: string;
  /** strike time − bell-selection time (device clock), ms; negative = selected after the strike */
  lead?: number;
}

export interface DeviceLabel {
  id: string;
  name: string;
  ua?: string;
  api?: string;
  rateHz?: number;
  rttP50?: number;
  rttMin?: number;
}

export interface MetronomeDeviceResult {
  device: DeviceLabel;
  beats: number;
  detected: number;
  extra: number;
  detectedPct: number;
  extraPct: number;
  /** strike - beat: median is (human + system) offset; spread is what calibration can't remove */
  offset: Summary;
  spread: Summary;
  arrival: Summary;
  detLatency: Summary;
  seqGaps: number;
  /** multi-bell only: matched strikes that carried the expected bell */
  rightBell?: number;
  rightBellPct?: number;
  lead?: Summary;
  lateTouches?: number;
}

function seqGaps(gs: readonly LoggedGesture[]): number {
  let gaps = 0;
  const byVia = new Map<string, number[]>();
  for (const g of gs) {
    const a = byVia.get(g.via) ?? [];
    a.push(g.seq);
    byVia.set(g.via, a);
  }
  for (const seqs of byVia.values()) {
    seqs.sort((a, b) => a - b);
    for (let i = 1; i < seqs.length; i++) if (seqs[i] - seqs[i - 1] > 1) gaps += seqs[i] - seqs[i - 1] - 1;
  }
  return gaps;
}

export function analyzeMetronome(
  beats: readonly number[],
  period: number,
  devices: readonly DeviceLabel[],
  gestures: readonly LoggedGesture[],
  expect: Readonly<Record<string, readonly string[]>> = {},
): MetronomeDeviceResult[] {
  const window = Math.min(period * 0.45, 300);
  const lo = beats[0] - period / 2;
  const hi = beats[beats.length - 1] + period / 2;
  return devices.map((device) => {
    const gs = gestures.filter((g) => g.deviceId === device.id && g.g === 'ring' && g.th >= lo && g.th <= hi);
    const m = matchNearest(beats, gs.map((g) => g.th), window);
    const diffs = m.pairs.map((p) => p.diff);
    const exp = expect[device.id];
    let multi: Pick<MetronomeDeviceResult, 'rightBell' | 'rightBellPct' | 'lead' | 'lateTouches'> = {};
    if (exp) {
      const rightBell = m.pairs.filter((p) => gs[p.evIndex].bell === exp[p.refIndex]).length;
      multi = {
        rightBell,
        rightBellPct: (100 * rightBell) / beats.length,
        lead: summarize(m.pairs.map((p) => gs[p.evIndex].lead ?? NaN)),
        lateTouches: m.pairs.filter((p) => (gs[p.evIndex].lead ?? 0) < 0).length,
      };
    }
    return {
      device,
      beats: beats.length,
      detected: m.pairs.length,
      extra: m.extra.length,
      detectedPct: (100 * m.pairs.length) / beats.length,
      extraPct: (100 * m.extra.length) / beats.length,
      offset: summarize(diffs),
      spread: summarize(centeredAbs(diffs)),
      arrival: summarize(gs.map((g) => g.rx - g.th)),
      detLatency: summarize(gs.map((g) => g.det ?? NaN)),
      seqGaps: seqGaps(gs),
      ...multi,
    };
  });
}

export interface ClinkPairResult {
  a: DeviceLabel;
  b: DeviceLabel;
  impactsA: number;
  impactsB: number;
  paired: number;
  diff: Summary;
  absDiff: Summary;
}

export function analyzeClink(devices: readonly DeviceLabel[], gestures: readonly LoggedGesture[], start: number, end: number): ClinkPairResult[] {
  const out: ClinkPairResult[] = [];
  const times = (id: string) =>
    gestures.filter((g) => g.deviceId === id && (g.g === 'impact' || g.g === 'tap') && g.th >= start && g.th <= end).map((g) => g.th);
  for (let i = 0; i < devices.length; i++) {
    for (let j = i + 1; j < devices.length; j++) {
      const ta = times(devices[i].id);
      const tb = times(devices[j].id);
      const m = matchNearest(ta, tb, 100);
      const diffs = m.pairs.map((p) => p.diff);
      out.push({
        a: devices[i],
        b: devices[j],
        impactsA: ta.length,
        impactsB: tb.length,
        paired: m.pairs.length,
        diff: summarize(diffs),
        absDiff: summarize(diffs.map(Math.abs)),
      });
    }
  }
  return out;
}

export interface IdleDeviceResult {
  device: DeviceLabel;
  rings: number;
  minutes: number;
  perMin: number;
}

export function analyzeIdle(devices: readonly DeviceLabel[], gestures: readonly LoggedGesture[], start: number, end: number): IdleDeviceResult[] {
  const minutes = (end - start) / 60_000;
  return devices.map((device) => {
    const rings = gestures.filter((g) => g.deviceId === device.id && g.g === 'ring' && g.th >= start && g.th <= end).length;
    return { device, rings, minutes, perMin: rings / minutes };
  });
}

const label = (d: DeviceLabel) => `${d.name} (${d.api ?? '?'} @ ${fmt(d.rateHz ?? NaN, 0)} Hz)`;

export function metronomeMarkdown(rs: readonly MetronomeDeviceResult[]): string {
  const lines = [
    '| Device | Detected | Extra | strike−beat median (ms) | spread p95 (ms) | arrival−source p50 / p95 / max (ms) | detection latency p50 / p95 (ms) | seq gaps | RTT min / p50 (ms) |',
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const r of rs) {
    lines.push(
      `| ${label(r.device)} | ${r.detected}/${r.beats} (${fmt(r.detectedPct)} %) | ${r.extra} (${fmt(r.extraPct)} %) | ${fmt(r.offset.p50)} | ${fmt(r.spread.p95)} | ${fmt(r.arrival.p50)} / ${fmt(r.arrival.p95)} / ${fmt(r.arrival.max)} | ${fmt(r.detLatency.p50)} / ${fmt(r.detLatency.p95)} | ${r.seqGaps} | ${fmt(r.device.rttMin ?? NaN)} / ${fmt(r.device.rttP50 ?? NaN)} |`,
    );
  }
  if (rs.some((r) => r.lead)) {
    lines.push('', 'Multi-bell selection (thumb zones; lead = strike − zone touch, negative = touched after the strike):', '');
    lines.push('| Device | right bell (of all beats) | lead p05 / p50 / p95 (ms) | late touches (lead < 0) |', '|---|---|---|---|');
    for (const r of rs) {
      if (!r.lead) continue;
      lines.push(`| ${label(r.device)} | ${r.rightBell}/${r.beats} (${fmt(r.rightBellPct ?? NaN)} %) | ${fmt(r.lead.p05)} / ${fmt(r.lead.p50)} / ${fmt(r.lead.p95)} | ${r.lateTouches ?? 0} |`);
    }
  }
  return lines.join('\n');
}

export function clinkMarkdown(rs: readonly ClinkPairResult[]): string {
  const lines = ['| Phone A | Phone B | impacts A / B | paired | A−B median (ms) | abs(A−B) p50 (ms) | abs(A−B) p95 (ms) |', '|---|---|---|---|---|---|---|'];
  for (const r of rs) {
    lines.push(`| ${label(r.a)} | ${label(r.b)} | ${r.impactsA} / ${r.impactsB} | ${r.paired} | ${fmt(r.diff.p50)} | ${fmt(r.absDiff.p50)} | ${fmt(r.absDiff.p95)} |`);
  }
  return lines.join('\n');
}

export function idleMarkdown(rs: readonly IdleDeviceResult[]): string {
  const lines = ['| Device | false rings | minutes | per minute |', '|---|---|---|---|'];
  for (const r of rs) lines.push(`| ${label(r.device)} | ${r.rings} | ${fmt(r.minutes, 1)} | ${fmt(r.perMin, 2)} |`);
  return lines.join('\n');
}
