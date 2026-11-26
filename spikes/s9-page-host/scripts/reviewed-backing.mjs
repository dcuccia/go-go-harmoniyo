import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { harpSample } from '../../i2-web-phones/src/backing/preview-samples.ts';
import { scoreEvents } from '../../i2-web-phones/src/backing/preview-score.ts';

export const catalogDigest = '78be33e61d3613ea8532acb6670570e37c75be08beab540faa89924fddcf1c4d';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const backingDir = 'spikes/s9-page-host/backing';
const forms = ['short', 'full'];
const assetId = 's9-reviewed-harp-backing';

export function assertBackingRelease(adr, assets) {
  const score = assets.find((asset) => asset.id === assetId);
  const harp = assets.find((asset) => asset.id === 's9-vsco2-harp');
  if (!adr.includes('# 0015 — Reviewed, fixed backing arrangements for public S9') ||
      !/^- Status: (?:\*\*)?Accepted\b/m.test(adr) || !adr.includes(catalogDigest)) {
    throw new Error('Public S9 backing requires accepted ADR-0015 for the pinned catalog digest.');
  }
  if (!score || score.candidate || score.credit === false || score.review?.status !== 'approved' ||
      !score.review.reviewer || !/^\d{4}-\d{2}-\d{2}$/.test(score.review.date ?? '') ||
      score.ai?.reviewer !== score.review.reviewer || score.ai.reviewDate !== score.review.date ||
      !score.review.notes?.includes(catalogDigest) || harp?.review?.status !== 'approved' || harp.credit === false) {
    throw new Error('Public S9 backing requires the recorded owner review for this exact digest and an approved sample register entry.');
  }
}

export function prepareBacking(repo, charts, mode) {
  const base = join(repo, backingDir);
  const { assets } = readJson(join(repo, 'attribution', 'register.json'));
  if (mode === 'release') {
    let adr = '';
    try { adr = readFileSync(join(repo, 'docs', 'decisions', '0015-reviewed-s9-backing.md'), 'utf8'); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    assertBackingRelease(adr, assets);
  }
  const manifestBytes = readFileSync(join(base, 'catalog.json'));
  if (sha256(manifestBytes) !== catalogDigest) throw new Error('S9 backing catalog digest mismatch.');
  const { schema, sourceHash, songs } = JSON.parse(manifestBytes);
  const provenance = readJson(join(base, 'provenance', 'catalog.json'));
  const index = readJson(join(charts, 'index.json'));
  if (schema !== 'backing-preview-v1' || sourceHash !== provenance.repo.chartsSourceHash ||
      provenance.manifest.sha256 !== catalogDigest || index.keyChange || index.songs.length !== 24 ||
      Object.keys(songs).length !== index.songs.length || !/^[0-9a-f]{40}$/.test(index.sourceHash)) {
    throw new Error('The pinned S9 backing requires the matching standard 24-song catalog.');
  }
  const scores = new Map();
  const samples = new Map();
  for (const { id } of index.songs) {
    if (!/^[a-z0-9-]+$/.test(id) || !Object.hasOwn(songs, id) || Object.keys(songs[id]).length !== 2) {
      throw new Error(`Missing or invalid backing for ${id}`);
    }
    for (const form of forms) {
      const chartBytes = readFileSync(join(charts, form === 'short' ? 'short' : '', `${id}.json`));
      // The generated sourceHash includes source-file line endings. Pin the actual chart bytes
      // so the reviewed Windows export also works on Linux without changing the input score.
      if (sha256(chartBytes) !== provenance.songs[id]?.charts[form]) {
        throw new Error(`${id}/${form}: built chart differs from the reviewed backing's chart`);
      }
      const chart = JSON.parse(chartBytes);
      if (chart.song.id !== id || chart.form?.id !== form) throw new Error(`${id}/${form}: wrong chart`);
      const events = songs[id][form];
      for (const e of scoreEvents(events, chart)) {
        if (e.voice !== 'harp') throw new Error(`${id}/${form}: expected recorded harp`);
        const [, note, hash] = harpSample(e.midi);
        samples.set(`KSHarp_${note}_mf.wav`, hash);
      }
      scores.set(`${form}/${id}.json`, JSON.stringify({ sourceHash: index.sourceHash, events }));
    }
  }
  const harp = assets.find((asset) => asset.id === 's9-vsco2-harp');
  const files = new Map(harp?.source?.files.map(({ path, sha256 }) => [path, sha256]));
  const originals = ['LICENSE.txt', 'README.md'];
  for (const name of [...samples.keys(), ...originals]) {
    const path = `${backingDir}/samples/${name}`;
    const pin = files.get(path);
    if (!pin || (samples.has(name) && samples.get(name) !== pin) ||
        sha256(readFileSync(join(repo, path))) !== pin) throw new Error(`S9 backing ${name}: upstream pin mismatch`);
  }
  return (out) => {
    for (const form of forms) mkdirSync(join(out, 'backing', form), { recursive: true });
    for (const [name, data] of scores) writeFileSync(join(out, 'backing', name), data);
    for (const [dir, names] of [['backing/samples', [...samples.keys()]], ['legal/vsco2-ce', originals]]) {
      mkdirSync(join(out, dir), { recursive: true });
      for (const name of names) copyFileSync(join(base, 'samples', name), join(out, dir, name));
    }
    console.log(`S9 backing: ${scores.size} fixed chart forms, ${samples.size} pinned WAVs (${mode})`);
  };
}
