import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { protectBells, scoreEvents } from '../../../i2-web-phones/src/backing/preview-score.ts';
import { harpSample, HARP_SAMPLES } from '../../../i2-web-phones/src/backing/preview-samples.ts';
import type { S5Chart } from '../../../i2-web-phones/src/team-chart.ts';

const PREFIX = '/api/backing-preview';
const FORMS = ['short', 'full'] as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const samePath = (a: string, b: string): boolean => relative(a, b) === '';

function directory(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || !samePath(path, realpathSync(path))) throw new Error(`Not an ordinary directory: ${path}`);
  return path;
}

function file(path: string, maxBytes: number): Buffer {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes || !samePath(path, realpathSync(path))) {
    throw new Error(`Not an ordinary single-link file of at most ${maxBytes} bytes: ${path}`);
  }
  return readFileSync(path);
}

export function exactLoopbackRequest(req: IncomingMessage, port: number): boolean {
  const host = `127.0.0.1:${port}`;
  const headers = req.headers;
  return req.socket.remoteAddress === '127.0.0.1' && req.method === 'GET' &&
    headers.host === host && headers['x-backing-preview'] === '1' &&
    headers['sec-fetch-site'] === 'same-origin' && (!headers.origin || headers.origin === `http://${host}`) &&
    !Object.keys(headers).some((h) => h === 'forwarded' || h.startsWith('x-forwarded-') || h.startsWith('cf-'));
}

export function loadBackingPreview(repoPath: string, gamePath: string, sidecar: string, port: number) {
  const repo = realpathSync(repoPath);
  const game = directory(join(repo, 'spikes', 'i2-web-phones', 'dist-backing-preview'));
  const root = join(repo, '.backing-preview');
  if (!samePath(gamePath, game) || !isAbsolute(sidecar) || !samePath(resolve(sidecar), root) || repo.startsWith('\\\\')) {
    throw new Error(`Use the local worktree's ${root} and the isolated I2 audition build; custom roots are not supported`);
  }
  directory(root);
  const index = JSON.parse(readFileSync(join(game, 'charts', 'index.json'), 'utf8')) as {
    sourceHash: string;
    songs: { id: string }[];
  };
  const manifest: unknown = JSON.parse(file(join(root, 'manifest.json'), 12 * 1024 * 1024).toString('utf8'));
  if (!record(manifest) || manifest.schema !== 'backing-preview-v1' || !record(manifest.songs)) {
    throw new Error('manifest.json must use backing-preview-v1 with a songs map');
  }
  if (!/^[\da-f]{40}$/.test(index.sourceHash) || manifest.sourceHash !== index.sourceHash) {
    throw new Error('manifest.json sourceHash does not match the built chart catalog');
  }
  if (Object.keys(manifest.songs).length !== index.songs.length || index.songs.some(({ id }) => !Object.hasOwn(manifest.songs as object, id))) {
    throw new Error('manifest.json must cover every catalog song, with no extras');
  }
  const enc = (obj: unknown): Buffer => Buffer.from(JSON.stringify(obj));
  const scores = new Map<string, Buffer>();
  const needed = new Set<(typeof HARP_SAMPLES)[number]>();
  let fullyOccupiedParts = 0;
  for (const { id } of index.songs) {
    const song = manifest.songs[id];
    if (!SLUG.test(id) || !record(song) || Object.keys(song).length !== FORMS.length) throw new Error(`${id}: expected Short and Full only`);
    for (const form of FORMS) {
      const path = join(game, 'charts', form === 'short' ? 'short' : '', `${id}.json`);
      const chart = JSON.parse(readFileSync(path, 'utf8')) as S5Chart;
      if (chart.song.id !== id || chart.form?.id !== form) throw new Error(`Wrong chart at ${path}`);
      const events = scoreEvents(song[form], chart);
      fullyOccupiedParts += chart.parts.filter((p) => protectBells(events, chart, p).length === 0).length;
      for (const e of events) if (e.voice === 'harp') needed.add(harpSample(e.midi));
      scores.set(`${id}/${form}`, enc({ sourceHash: index.sourceHash, events: song[form] }));
    }
  }
  const samples = new Map<string, Buffer>();
  if (needed.size) {
    const dir = directory(join(root, 'samples'));
    for (const [, note, hash] of needed) {
      const bytes = file(join(dir, `KSHarp_${note}_mf.wav`), 8 * 1024 * 1024);
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`Harp sample ${note} does not match the pinned CC0 WAV`);
      samples.set(note, bytes);
    }
  }
  console.log(`  Backing preview: validated ${scores.size} forms and ${samples.size} pinned harp WAVs (loopback only)`);
  if (fullyOccupiedParts) console.log(`  Backing preview: ${fullyOccupiedParts} chart part(s) leave no space for candidate notes`);
  return (req: IncomingMessage, res: ServerResponse, path: string): boolean => {
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return false;
    const suffix = path.slice(PREFIX.length + 1);
    const wave = suffix.startsWith('sample/');
    const bytes = exactLoopbackRequest(req, port) && (wave ? samples.get(suffix.slice(7)) : scores.get(suffix));
    if (!bytes) res.writeHead(404, { 'cache-control': 'no-store' }).end('not found');
    else res.writeHead(200, {
      'content-type': wave ? 'audio/wav' : 'application/json',
      'cache-control': 'no-store',
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    }).end(bytes);
    return true;
  };
}
