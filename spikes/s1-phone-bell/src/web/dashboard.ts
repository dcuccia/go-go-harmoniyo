import { DEFAULT_BELLS, midiToHz, type Bell, type SoundMode } from '../core/hgp.ts';
import { audio, bell, testBeep, unlockAudio } from './audio.ts';
import { HgpClient } from './hgp-client.ts';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const client = new HgpClient({ kind: 'dashboard', deviceId: 'dashboard', name: 'dashboard', syncIntervalMs: 2000 });
let hostAudio = false;
let soundMode: SoundMode = 'device';
let currentTest: { kind: string } | null = null;
const logLines: string[] = [];

interface DeviceRow {
  id: string;
  name: string;
  ua: string;
  online: boolean;
  rtc: boolean;
  bells: Bell[];
  events: number;
  status: Record<string, unknown>;
}

const num = (x: unknown, d = 1) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '–');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function shortUa(ua: string): string {
  const ios = /iPhone OS (\d+)_(\d+)/.exec(ua);
  if (ios) return `iPhone iOS ${ios[1]}.${ios[2]}${/CriOS/.test(ua) ? ' Chrome' : ' Safari'}`;
  const and = /Android (\d+)[^;]*; ([^)]+)\)/.exec(ua);
  if (and) return `${and[2].replace(/ Build.*/, '')} Android ${and[1]} ${/Chrome\/(\d+)/.exec(ua)?.[0] ?? ''}`;
  return ua.slice(0, 40);
}

function renderDevices(list: DeviceRow[]): void {
  const opts = (sel: string) => DEFAULT_BELLS.map((b) => `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${b.id}</option>`).join('');
  $('devices').innerHTML = list
    .map((d) => {
      const s = d.status;
      const iv = (s.interval ?? {}) as Record<string, number>;
      return `<tr>
        <td>${esc(d.name)}</td>
        <td>${d.bells.map((b) => `<span class="swatch" style="background:${b.color}" title="${b.id}"></span>`).join('')} <select data-assign="${d.id}">${opts(d.bells[0]?.id ?? '')}</select><br><span class="small">${d.bells.map((b) => b.id).join(' ')}</span></td>
        <td>${esc(String(s.api ?? '–'))} ${num(s.rateHz, 0)} Hz<br><span class="small">Δt p95 ${num(iv.intervalP95)} ms, max ${num(iv.intervalMax)}${s.gyro === false ? ' · NO GYRO' : ''}</span></td>
        <td>rtt min ${num(s.rttMin)} / p50 ${num(s.rttP50)} ms<br><span class="small">drift ${num(s.drift, 0)} ppm · n ${num(s.syncN, 0)}</span></td>
        <td>${d.online ? '🟢' : '🔴'} ${d.rtc ? 'ws+rtc' : 'ws'}${s.transport === 'rtc' ? ' (rtc active)' : ''}${s.visible === false ? ' · hidden' : ''}</td>
        <td>${d.events}</td>
        <td class="small">${esc(shortUa(d.ua))}<br>${s.axis ? 'calibrated' : 'uncalibrated'} · ${esc(String(s.mode ?? ''))}</td>
      </tr>`;
    })
    .join('');
}

function addLog(line: string): void {
  logLines.unshift(line);
  if (logLines.length > 60) logLines.pop();
  $('log').textContent = logLines.join('\n');
}

interface YargInfo {
  connected: boolean;
  port: number;
  bridgeRtt: number;
  song: { id: string; title: string } | null;
  tier: string;
  lastSong: { title: string } | null;
  ringsSent: number;
  ageP50: number;
  ageP95: number;
  songs: { id: string; title: string }[];
  seats: ({ slot: number; device: string; name: string; online: boolean; partName?: string; tier: string; bells: Bell[]; rings: number } | null)[];
}

let yargSongsShown = '';
function renderYarg(y: YargInfo): void {
  $('yarg-panel').hidden = false;
  $('yarg-status').textContent =
    `${y.connected ? `🟢 YARG bridge answering on 127.0.0.1:${y.port} (round trip ${num(y.bridgeRtt, 2)} ms)` : `🔴 YARG not answering on 127.0.0.1:${y.port} — start YARG with -hgp`}` +
    ` · bells for: ${y.song?.title ?? 'no song yet (free lanes)'}${y.lastSong ? ` · YARG last loaded “${y.lastSong.title}”` : ''}` +
    ` · rings sent ${y.ringsSent} (source→host age p50 ${num(y.ageP50, 0)} / p95 ${num(y.ageP95, 0)} ms)`;
  const songSel = $<HTMLSelectElement>('yarg-song');
  const key = y.songs.map((s) => s.id).join();
  if (key !== yargSongsShown) {
    yargSongsShown = key;
    songSel.innerHTML = `<option value="">(free lanes)</option>` + y.songs.map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`).join('');
  }
  if (document.activeElement !== songSel) songSel.value = y.song?.id ?? '';
  const diffSel = $<HTMLSelectElement>('yarg-difficulty');
  if (document.activeElement !== diffSel) diffSel.value = y.tier;
  $('yarg-seats').innerHTML = y.seats
    .map((s, i) =>
      s
        ? `<tr><td>Ringer ${s.slot + 1} (${esc(s.device)})</td><td>${s.online ? '🟢' : '🔴'} ${esc(s.name)}</td><td>${esc(s.partName ?? '?')} · ${esc(s.tier)}</td>
           <td>${s.bells.map((b) => `<span class="swatch" style="background:${b.color}"></span>${esc(b.id)}`).join(' ')}</td><td>${s.rings}</td>
           <td><button data-yarg-remove="${s.slot}">Free seat</button></td></tr>`
        : `<tr><td>Ringer ${i + 1}</td><td colspan="5" class="small">free — the next phone to join sits here</td></tr>`,
    )
    .join('');
}
$('yarg-apply').addEventListener('click', () => cmd({ cmd: 'yarg-song', song: $<HTMLSelectElement>('yarg-song').value, difficulty: $<HTMLSelectElement>('yarg-difficulty').value }));
$('yarg-seats').addEventListener('click', (e) => {
  const slot = (e.target as HTMLElement).dataset.yargRemove;
  if (slot !== undefined) cmd({ cmd: 'yarg-remove', slot: Number(slot) });
});

client.onMessage = (m) => {
  switch (m.type) {
    case 'welcome':
    case 'info': {
      const info = (m.info ?? {}) as Record<string, unknown>;
      if (typeof info.joinUrl === 'string' && info.joinUrl) {
        $('qr').innerHTML = `<img alt="QR code" src="/qr.svg?u=${encodeURIComponent(info.joinUrl)}">`;
        $('join').textContent = info.joinUrl;
      }
      $('tls').textContent = `Transport/TLS: ${String(info.tlsMode ?? '')}${info.rtcAvailable ? ' · WebRTC available (?rtc=1 on phones)' : ''}`;
      break;
    }
    case 'devices':
      soundMode = (m.soundMode as SoundMode) ?? soundMode;
      if (typeof m.bellsPerPhone === 'number' && document.activeElement !== $('bells-per-phone')) ($('bells-per-phone') as HTMLSelectElement).value = String(m.bellsPerPhone);
      renderDevices(m.devices as DeviceRow[]);
      if (m.yarg) renderYarg(m.yarg as YargInfo);
      break;
    case 'event': {
      const g = m.msg as Record<string, unknown>;
      const b = m.bell as Bell;
      const rx = m.rx as number;
      const th = g.th as number | undefined;
      if (hostAudio && (soundMode === 'host' || soundMode === 'both')) {
        if (currentTest?.kind === 'latency') testBeep();
        else bell(midiToHz(b.midi), 0, typeof g.vel === 'number' ? g.vel : 0.8);
      }
      addLog(
        `${new Date().toLocaleTimeString()} ${String(m.name).padEnd(10)} ${String(g.g).padEnd(6)} ${b.id.padEnd(3)} seq ${String(g.seq).padStart(4)} arrival−source ${num(th !== undefined ? rx - th : NaN).padStart(6)} ms det ${num(g.det).padStart(5)} ms via ${String(m.via)}`,
      );
      break;
    }
    case 'test-state':
      currentTest = (m.test as { kind: string } | null) ?? null;
      $('test-state').textContent = currentTest ? `Running: ${currentTest.kind}…` : 'Idle';
      break;
    case 'results': {
      const t = m.test as { kind: string; id: string };
      const div = document.createElement('div');
      div.innerHTML = `<h3>${esc(t.kind)} — ${esc(t.id)}</h3><div class="md">${esc(String(m.markdown))}</div>`;
      $('results').prepend(div);
      break;
    }
    case 'device-result': {
      const r = m.msg as Record<string, unknown>;
      addLog(`${String(m.name)} ${String(r.test)}: ${JSON.stringify(r.data)}`);
      break;
    }
  }
};

const cmd = (o: Record<string, unknown>) => client.send({ type: 'cmd', ...o });

document.querySelectorAll<HTMLButtonElement>('button[data-test]').forEach((b) =>
  b.addEventListener('click', () => {
    const test = b.dataset.test!;
    cmd({ cmd: 'test', test, multi: ($('multi') as HTMLInputElement).checked, bpm: Number(($('bpm') as HTMLInputElement).value), count: Number(($('count') as HTMLInputElement).value), durationMs: Number(($('dur') as HTMLInputElement).value) * 1000 });
  }),
);
$('stop').addEventListener('click', () => cmd({ cmd: 'stop' }));
$('bells-per-phone').addEventListener('change', (e) => cmd({ cmd: 'bells', n: Number((e.target as HTMLSelectElement).value) }));
$('calibrate-all').addEventListener('click', () => cmd({ cmd: 'config', deviceId: 'all', config: { calibrate: true } }));
document.querySelectorAll<HTMLInputElement>('input[name=sound]').forEach((r) => r.addEventListener('change', () => cmd({ cmd: 'sound', sound: r.value })));
$('devices').addEventListener('change', (e) => {
  const t = e.target as HTMLSelectElement;
  if (t.dataset.assign) cmd({ cmd: 'assign', deviceId: t.dataset.assign, bellId: t.value });
});
$('host-audio').addEventListener('click', async () => {
  const i = await unlockAudio();
  hostAudio = true;
  const c = audio() as AudioContext & { outputLatency?: number };
  $('audio-info').textContent = `Host audio ${i.state}; baseLatency ${(c.baseLatency * 1000).toFixed(1)} ms, outputLatency ${((c.outputLatency ?? NaN) * 1000).toFixed(1)} ms`;
  bell(midiToHz(72));
});

client.connect();
