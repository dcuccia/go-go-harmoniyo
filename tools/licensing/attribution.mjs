#!/usr/bin/env node
// Asset register tool (ADR-0008).
//
//   node tools/licensing/attribution.mjs           validate + regenerate ATTRIBUTION.md and attribution/credits.json
//   node tools/licensing/attribution.mjs --check   validate + fail if the generated files are stale (CI)
//
// Validates attribution/register.json against its JSON Schema and the license policy, checks that
// every asset file in the repo is claimed by exactly one entry, that pinned third-party files still
// match their upstream SHA-256, that REUSE.toml gives each file the register's license, and that AI
// provenance is complete (legacy entries excepted).
import { existsSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { emit, globToRegExp, licenseUrl, matchesAny, readJson, repoFiles, repoRoot, sha256File } from './lib/common.mjs';
import { validate } from './lib/schema.mjs';
import { idsOf, isAllowed } from './lib/spdx.mjs';

const CHECK = process.argv.includes('--check');
const REGISTER = 'attribution/register.json';
const schema = readJson('attribution/register.schema.json');
const register = readJson(REGISTER);
const policy = readJson('tools/licensing/policy.json');
const { exceptions } = readJson('tools/licensing/exceptions.json');
const errors = [];
const warnings = [];

const LICENSE_INFO = {
  MIT: { name: 'MIT License', url: 'https://opensource.org/license/mit' },
  'CC-BY-4.0': { name: 'Creative Commons Attribution 4.0 International', url: 'https://creativecommons.org/licenses/by/4.0/' },
  'CC0-1.0': { name: 'CC0 1.0 Universal (public domain dedication)', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  'LicenseRef-Mutopia-PublicDomain': { name: 'Public domain (Mutopia Project dedication)', url: 'https://www.mutopiaproject.org/legal.html#publicdomain' },
  'LGPL-3.0-or-later': { name: 'GNU Lesser General Public License v3.0 or later', url: 'https://www.gnu.org/licenses/lgpl-3.0.html' },
};
const licenseInfo = (id) => LICENSE_INFO[id] ?? { name: id, url: licenseUrl(id) };

// --- 1. schema --------------------------------------------------------------------------------
for (const e of validate(schema, register)) errors.push(`${REGISTER} ${e}`);
if (errors.length) finish();

const assets = register.assets;
const byId = new Map();
for (const a of assets) {
  if (byId.has(a.id)) errors.push(`${a.id}: duplicate id`);
  byId.set(a.id, a);
}

// --- 2. license policy ------------------------------------------------------------------------
const allowed = new Set([...policy.allow, ...policy.publicDomain]);
for (const a of assets) {
  let ids = [];
  try {
    ids = idsOf(a.license);
  } catch (e) {
    errors.push(`${a.id}: ${e.message}`);
    continue;
  }
  for (const id of ids) if (!existsSync(join(repoRoot, 'LICENSES', `${id}.txt`))) errors.push(`${a.id}: LICENSES/${id}.txt is missing (run \`reuse download ${id}\`)`);
  if (!isAllowed(a.license, allowed)) {
    const ex = exceptions.find((x) => x.ecosystem === 'asset' && x.name === a.id && x.license === a.license);
    if (!ex) errors.push(`${a.id}: license "${a.license}" is not allowed for assets without an ADR exception (tools/licensing/exceptions.json)`);
  }
  const expected = policy.projectLicenses[a.origin];
  if (expected && a.license !== expected) errors.push(`${a.id}: ${a.origin} assets must be ${expected} (ADR-0008), not ${a.license}`);
  for (const d of a.derivedFrom ?? []) if (!byId.has(d)) errors.push(`${a.id}: derivedFrom "${d}" is not a register id`);
}

// --- 3. AI provenance -------------------------------------------------------------------------
const blocked = policy.promptBlocklist.terms.map((t) => [t, new RegExp(`(^|[^a-z0-9])${t.replace(/[.*+?^${}()|[\]\\!]/g, '\\$&')}([^a-z0-9]|$)`, 'i')]);
for (const a of assets.filter((x) => x.ai)) {
  const hits = blocked.filter(([, re]) => re.test(a.ai.prompt)).map(([t]) => t);
  if (hits.length) errors.push(`${a.id}: AI prompt names a franchise/artist or copies a style (${hits.join(', ')}); describe the feeling, not the asset (ADR-0008)`);
  const gaps = Object.entries(a.ai).filter(([, v]) => /^(unrecorded|pending)\b/i.test(v)).map(([k]) => k);
  const reviewOnly = gaps.length && gaps.every((k) => k === 'reviewer' || k === 'reviewDate');
  if (a.candidate && a.credit !== false) errors.push(`${a.id}: candidate assets are not credited until promoted; set "credit": false`);
  if (a.candidate && a.review.status !== 'pending') errors.push(`${a.id}: an approved asset is no longer a candidate; remove "candidate"`);
  if (gaps.length && a.candidate && reviewOnly) warnings.push(`${a.id}: candidate awaiting the human resemblance review (required before promotion; ADR-0011)`);
  else if (gaps.length && !a.legacy) errors.push(`${a.id}: AI provenance incomplete (${gaps.join(', ')}); new AI assets need tool/model/version/terms/prompt and a human resemblance review before merge`);
  else if (gaps.length) warnings.push(`${a.id}: legacy AI provenance gaps: ${gaps.join(', ')}`);
}
for (const a of assets) if (a.review.status === 'pending') warnings.push(`${a.id}: review pending${a.review.notes ? ` (${a.review.notes})` : ''}`);

// --- 4. coverage ------------------------------------------------------------------------------
const files = repoFiles();
const { extensions, include, exclude } = register.coverage;
const isAsset = (f) => !matchesAny(f, exclude) && (extensions.includes(posix.extname(f).slice(1).toLowerCase()) || matchesAny(f, include));
const assetFiles = files.filter(isAsset);
const filesOf = new Map(assets.map((a) => [a.id, files.filter((f) => matchesAny(f, a.paths))]));
for (const f of assetFiles) {
  const owners = assets.filter((a) => filesOf.get(a.id).includes(f)).map((a) => a.id);
  if (owners.length === 0) errors.push(`${f}: asset file not in ${REGISTER} (add an entry: source, license, author, AI provenance)`);
  if (owners.length > 1) errors.push(`${f}: claimed by several register entries (${owners.join(', ')})`);
}
for (const a of assets) {
  for (const p of a.paths) if (!files.some((f) => globToRegExp(p).test(f))) errors.push(`${a.id}: path "${p}" matches no file`);
}

// --- 5. pinned third-party files --------------------------------------------------------------
for (const a of assets) {
  for (const pin of a.source?.files ?? []) {
    if (!filesOf.get(a.id).includes(pin.path)) {
      errors.push(`${a.id}: pinned file ${pin.path} is not one of the entry's files`);
      continue;
    }
    const actual = sha256File(pin.path);
    if (actual !== pin.sha256) errors.push(`${a.id}: ${pin.path} sha256 ${actual} ≠ pinned upstream ${pin.sha256} (third-party file modified? record the modification or restore it)`);
  }
}

// --- 6. REUSE.toml agrees with the register ---------------------------------------------------
const reuse = parseReuseToml(readFileSync(join(repoRoot, 'REUSE.toml'), 'utf8'));
for (const a of assets) {
  for (const f of filesOf.get(a.id)) {
    const match = reuse.findLast((r) => r.paths.some((p) => globToRegExp(p).test(f)));
    if (!match) errors.push(`${f}: no REUSE.toml annotation`);
    else if (match.license !== a.license) errors.push(`${f}: REUSE.toml says ${match.license}, register (${a.id}) says ${a.license}`);
  }
}

// --- 7. generate ------------------------------------------------------------------------------
if (!errors.length) {
  if (!emit('ATTRIBUTION.md', renderAttribution(), CHECK)) errors.push('ATTRIBUTION.md is stale');
  if (!emit('attribution/credits.json', JSON.stringify(renderCredits(), null, 2) + '\n', CHECK)) errors.push('attribution/credits.json is stale');
}
finish();

function finish() {
  for (const w of warnings) console.log(`⚠ ${w}`);
  for (const e of errors) console.error(`✗ ${e}`);
  if (errors.length) {
    console.error(`Asset register check FAILED with ${errors.length} error(s). See ADR-0008 and tools/licensing/README.md.`);
    process.exit(1);
  }
  console.log(`Asset register OK: ${register.assets.length} entries, ${assetFiles.length} asset files covered, ${warnings.length} warning(s).`);
  process.exit(0);
}

function parseReuseToml(text) {
  return text.split(/^\[\[annotations\]\]\s*$/m).slice(1).map((block) => {
    const pathMatch = block.match(/^path\s*=\s*(\[[\s\S]*?\]|"[^"]*")/m);
    const paths = pathMatch ? [...pathMatch[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]) : [];
    const license = block.match(/^SPDX-License-Identifier\s*=\s*"([^"]*)"/m)?.[1];
    return { paths, license };
  });
}

function renderCredits() {
  const SECTIONS = [
    ['Music', ['music-score', 'midi']],
    ['Charts', ['chart']],
    ['Art', ['image', 'animation', 'model', 'shader', 'video']],
    ['Sound', ['audio']],
    ['Fonts', ['font']],
    ['Other', ['other']],
  ];
  const credited = assets.filter((a) => a.credit !== false);
  return {
    $comment: 'Generated from attribution/register.json by tools/licensing/attribution.mjs. Do not edit; the game renders this file in its credits screen.',
    project: {
      name: 'Go Go HarmoniYo',
      url: 'https://github.com/dcuccia/go-go-harmoniyo',
      codeLicense: 'MIT',
      attributionUrl: 'https://github.com/dcuccia/go-go-harmoniyo/blob/main/ATTRIBUTION.md',
    },
    disclaimer:
      'Go Go HarmoniYo is an independent open-source project. It is not affiliated with, endorsed by, or sponsored by the makers of any game or product it mentions. All trademarks belong to their owners.',
    sections: SECTIONS.map(([title, kinds]) => ({
      title,
      entries: credited.filter((a) => kinds.includes(a.kind)).map((a) => ({
        id: a.id,
        title: a.title,
        credit: a.attribution ?? `${a.authors.join(', ')}`,
        license: { id: a.license, ...licenseInfo(a.license) },
        ...(a.source ? { source: a.source.url } : {}),
      })),
    })).filter((s) => s.entries.length),
  };
}

function renderAttribution() {
  const md = [];
  const rel = (p) => p.replace(/ /g, '%20');
  md.push(
    '<!-- Generated from attribution/register.json by tools/licensing/attribution.mjs. Do not edit by hand:',
    '     edit the register (and REUSE.toml), then run `node tools/licensing/attribution.mjs`. -->',
    '',
    '# Attribution and licensing',
    '',
    'Go Go HarmoniYo is an independent open-source project. It gratefully',
    'builds on public-domain music, the volunteers of the [Mutopia Project](https://www.mutopiaproject.org),',
    'and the open-source libraries listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Crediting a',
    'person, project or game does **not** imply their endorsement, and Go Go HarmoniYo is not affiliated with, endorsed',
    'by, or sponsored by the makers of any game it mentions as inspiration. All trademarks belong to',
    'their owners.',
    '',
    'The policy is [ADR-0008](docs/decisions/0008-assets-ip-and-attribution.md). Every file\'s license',
    'is machine-readable ([REUSE](https://reuse.software): `REUSE.toml` and `LICENSES/`), and every',
    'non-code asset has an entry in the [asset register](attribution/register.json). This file is',
    'project provenance practice, not legal advice.',
    '',
    '## License boundaries',
    '',
    '| Material | License |',
    '|---|---|',
    '| Code, docs, configs, test data (default) | [MIT](LICENSE) |',
    '| Original human-made art, audio, models and charts | [CC BY 4.0](LICENSES/CC-BY-4.0.txt) |',
    '| AI-generated assets (copyright may not attach) | [CC0 1.0](LICENSES/CC0-1.0.txt) |',
    '| Third-party assets | Their own license, recorded per file below and in `REUSE.toml` |',
    '| Explicit ADR exceptions | Listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md#exceptions-to-the-license-allowlist), e.g. the LGPL-3.0-or-later S2 patch file |',
    '| YARG / YARG.Core (LGPL-3.0-or-later) | **Not in this repository.** The spikes fetch them into gitignored folders; the YARG fork is a separate repository |',
    '',
    'The root MIT license does not override these per-file licenses. Don\'t relabel the whole',
    'repository "MIT" in a way that hides them.',
    '',
    '## Credits',
    '',
  );
  for (const a of assets.filter((x) => x.attribution)) md.push(`- ${a.attribution} License: ${licenseInfo(a.license).name}.`);
  md.push('', '## Asset inventory', '');
  md.push('| Asset | Origin | License | Files | Review |', '|---|---|---|---|---|');
  for (const a of assets) {
    const n = filesOf.get(a.id).length;
    md.push(`| [${a.title}](#${a.id}) | ${a.origin} | ${a.license} | ${n} | ${a.review.status}${a.legacy ? ' (legacy)' : ''} |`);
  }
  md.push('');
  for (const a of assets) {
    md.push(`### ${a.id}`, '', `**${a.title}**`, '');
    md.push(`- Files: ${a.paths.map((p) => `\`${p}\``).join(', ')} (${filesOf.get(a.id).length} file(s))`);
    md.push(`- Origin: ${a.origin}${a.derivedFrom ? ` — from ${a.derivedFrom.map((d) => `[${d}](#${d})`).join(', ')}` : ''}${a.generator ? ` via \`${a.generator}\`` : ''}`);
    md.push(`- Authors: ${a.authors.join('; ')}`);
    md.push(`- Copyright: ${a.copyright}`);
    md.push(`- License: [${licenseInfo(a.license).name}](${a.license.startsWith('LicenseRef-') ? rel(`LICENSES/${a.license}.txt`) : licenseInfo(a.license).url}) (\`${a.license}\`)`);
    if (a.source) {
      md.push(`- Source: <${a.source.url}>${a.source.id ? ` (${a.source.id})` : ''}, retrieved ${a.source.retrieved}`);
      if (a.source.licenseEvidence) md.push(`- License evidence: ${a.source.licenseEvidence}`);
      for (const f of a.source.files ?? []) md.push(`  - \`${f.path}\` ← <${f.url}> sha256 \`${f.sha256}\``);
    }
    md.push(`- Modifications: ${a.modifications}`);
    if (a.reuseLimits) md.push(`- Reuse limits: ${a.reuseLimits}`);
    if (a.ai) {
      const ai = a.ai;
      md.push(`- AI provenance: ${ai.tool}; model ${ai.model} (${ai.version}); terms <${ai.termsUrl}> (${ai.termsDate}); prompt: ${ai.prompt}; resemblance review: ${ai.reviewer}, ${ai.reviewDate}`);
    }
    md.push(`- Review: ${a.review.status}${a.review.reviewer ? ` by ${a.review.reviewer}` : ''}${a.review.date ? ` on ${a.review.date}` : ''}${a.review.notes ? `. ${a.review.notes}` : ''}`);
    if (a.legacy) md.push('- Legacy: added before ADR-0008; gaps are listed under "Open items".');
    if (a.notes) md.push(`- Notes: ${a.notes}`);
    md.push('');
  }
  md.push('## Open items', '');
  const open = warnings.length ? warnings : ['None.'];
  for (const w of open) md.push(`- ${w}`);
  md.push(
    '',
    '## Required record for each new asset',
    '',
    'Add a register entry **in the same pull request** as the asset: paths, title, kind, origin, authors,',
    'copyright, SPDX license, source URL with retrieval date and pinned SHA-256 (third-party), exact',
    'credit text, modifications, reuse limits, and for AI-generated assets the tool, model, version,',
    'terms URL and date, full prompt, and the human resemblance reviewer and date. See',
    '[CONTRIBUTING.md](CONTRIBUTING.md#adding-assets).',
    '',
  );
  return md.join('\n');
}
