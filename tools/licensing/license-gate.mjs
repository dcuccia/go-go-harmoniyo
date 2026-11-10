#!/usr/bin/env node
// Dependency license gate (ADR-0008).
//
//   node tools/licensing/license-gate.mjs            check + regenerate THIRD_PARTY_NOTICES.md
//   node tools/licensing/license-gate.mjs --check    check + fail if THIRD_PARTY_NOTICES.md is stale (CI)
//   add --offline to skip NuGet lookups (warns)
//
// Checks: every npm project has a lockfile and declares MIT; every locked npm package and every NuGet
// PackageReference has an allowlisted license or a matching exception (exceptions.json → ADR); every
// pinned binary in a binaries.json (redistributed by tools/package/*) has an allowlisted license, a
// pinned hash and a pinned license text; fetched LGPL sources (YARG) stay gitignored and unvendored.
import { readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';
import { emit, isGitIgnored, licenseUrl, readJson, repoFiles, repoRoot } from './lib/common.mjs';
import { idsOf, isAllowed, normalizeNpmLicense } from './lib/spdx.mjs';

const args = new Set(process.argv.slice(2));
const CHECK = args.has('--check');
const OFFLINE = args.has('--offline');

const policy = readJson('tools/licensing/policy.json');
const { exceptions, copyleftGate = [] } = readJson('tools/licensing/exceptions.json');
const allowed = new Set(policy.allow);
const isCopyleft = (id) => policy.copyleft.prefixes.some((p) => id.startsWith(p));
const allowedPermissive = new Set(policy.allow.filter((id) => !isCopyleft(id)));
const errors = [];
const warnings = [];
const usedExceptions = new Set();

// --- exceptions must reference an existing ADR; copyleft entries carry a gate status ----------
const adrFiles = readdirSync(join(repoRoot, 'docs/decisions'));
for (const ex of [...exceptions, ...copyleftGate]) {
  if (!adrFiles.some((f) => f.startsWith(`${ex.adr}-`))) errors.push(`${ex.id}: ADR ${ex.adr} not found in docs/decisions/`);
  if (ex.status && !['accepted', 'pending-owner'].includes(ex.status)) errors.push(`${ex.id}: unknown status "${ex.status}"`);
  if (idsOf(ex.license).some(isCopyleft) && !ex.gate) errors.push(`${ex.id}: copyleft entries need a "gate" status (ADR-0008 Copyleft adoption gate)`);
}

const inScope = (ex, dir) => ex.scope.some((s) => dir === s || dir.startsWith(s + '/'));
const find = (list, ecosystem, name, license, dir) =>
  list.find((ex) => ex.ecosystem === ecosystem && ex.name === name && ex.license === license && inScope(ex, dir));

function judge(ecosystem, name, version, license, dir, scope = 'runtime') {
  if (!license) {
    errors.push(`${ecosystem} ${name}@${version} (${dir}): no license declared`);
    return 'missing';
  }
  try {
    if (isAllowed(license, allowedPermissive)) return 'allowed';
    if (isAllowed(license, allowed)) {
      // Allowlisted copyleft (e.g. MPL-2.0): fine for dev tooling; anything that could ship stays tracked.
      if (scope.startsWith('dev')) return 'allowed';
      const cg = find(copyleftGate, ecosystem, name, license, dir);
      if (cg) {
        usedExceptions.add(cg.id);
        return cg.id;
      }
      errors.push(`${ecosystem} ${name}@${version} (${dir}): copyleft license "${license}" must be tracked in copyleftGate[] of tools/licensing/exceptions.json (ADR-0008 Copyleft adoption gate)`);
      return 'untracked';
    }
  } catch (e) {
    errors.push(`${ecosystem} ${name}@${version} (${dir}): ${e.message}`);
    return 'invalid';
  }
  const ex = find(exceptions, ecosystem, name, license, dir);
  if (ex) {
    usedExceptions.add(ex.id);
    return ex.id;
  }
  errors.push(`${ecosystem} ${name}@${version} (${dir}): license "${license}" is not allowlisted and has no exception (tools/licensing/exceptions.json)`);
  return 'denied';
}

const files = repoFiles();

// --- npm ---------------------------------------------------------------------------------------
const npm = new Map(); // name@version → { name, version, license, scope, dirs:Set, status }
const npmProjects = [];
for (const pj of files.filter((f) => posix.basename(f) === 'package.json' && !f.includes('node_modules/'))) {
  const dir = posix.dirname(pj);
  const manifest = JSON.parse(readFileSync(join(repoRoot, pj), 'utf8'));
  if (manifest.license !== policy.projectLicenses.code) errors.push(`${pj}: project license must be "${policy.projectLicenses.code}" (found ${JSON.stringify(manifest.license)})`);
  const depCount = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
    .reduce((n, k) => n + Object.keys(manifest[k] ?? {}).length, 0);
  const lockRel = posix.join(dir, 'package-lock.json');
  if (!files.includes(lockRel)) {
    if (depCount > 0) errors.push(`${pj}: has dependencies but no committed package-lock.json`);
    npmProjects.push({ dir, packages: 0 });
    continue;
  }
  const lock = JSON.parse(readFileSync(join(repoRoot, lockRel), 'utf8'));
  if (!lock.packages) {
    errors.push(`${lockRel}: lockfileVersion ${lock.lockfileVersion} has no "packages" map; regenerate with npm ≥ 7`);
    continue;
  }
  let count = 0;
  for (const [key, meta] of Object.entries(lock.packages)) {
    if (!key || meta.link) continue;
    const name = meta.name ?? key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    const license = normalizeNpmLicense(meta.license);
    const scope = meta.dev ? 'dev' : meta.devOptional ? 'dev (optional)' : meta.optional ? 'optional' : 'runtime';
    const id = `${name}@${meta.version}`;
    const status = judge('npm', name, meta.version, license, dir, scope);
    const entry = npm.get(id) ?? { name, version: meta.version, license, scopes: new Set(), dirs: new Set(), status };
    entry.scopes.add(scope);
    entry.dirs.add(dir);
    npm.set(id, entry);
    count++;
  }
  npmProjects.push({ dir, packages: count });
}

// --- NuGet (direct PackageReference / PackageVersion) ----------------------------------------
const nuget = [];
const msbuildFiles = files.filter((f) => /\.(csproj|fsproj|vbproj|props|targets)$/.test(f));
for (const f of msbuildFiles) {
  const xml = readFileSync(join(repoRoot, f), 'utf8');
  for (const m of xml.matchAll(/<Package(?:Reference|Version)\s+[^>]*?Include="([^"]+)"[^>]*?(?:Version="([^"]+)")?[^>]*?\/?>/g)) {
    nuget.push({ file: f, dir: posix.dirname(f), name: m[1], version: m[2] ?? null });
  }
}
for (const ref of nuget) {
  if (!ref.version || ref.version.includes('$(')) {
    errors.push(`nuget ${ref.name} (${ref.file}): version must be a literal so its license can be checked`);
    continue;
  }
  if (OFFLINE) {
    warnings.push(`nuget ${ref.name}@${ref.version}: license not checked (--offline)`);
    continue;
  }
  const id = ref.name.toLowerCase();
  const v = ref.version.toLowerCase();
  const res = await fetch(`https://api.nuget.org/v3-flatcontainer/${id}/${v}/${id}.nuspec`);
  if (!res.ok) {
    errors.push(`nuget ${ref.name}@${ref.version}: nuspec lookup failed (HTTP ${res.status})`);
    continue;
  }
  const nuspec = await res.text();
  ref.license = nuspec.match(/<license\s+type="expression"\s*>([^<]+)<\/license>/)?.[1]?.trim() ?? null;
  if (!ref.license) {
    const url = nuspec.match(/<licenseUrl>([^<]+)<\/licenseUrl>/)?.[1];
    errors.push(`nuget ${ref.name}@${ref.version}: no SPDX license expression in nuspec${url ? ` (licenseUrl ${url})` : ''}; add an exception after reviewing it`);
    continue;
  }
  ref.status = judge('nuget', ref.name, ref.version, ref.license, ref.dir);
}

// --- pinned third-party binaries redistributed by packages (e.g. tools/package/windows) --------
const binaries = [];
for (const f of files.filter((f) => posix.basename(f) === 'binaries.json')) {
  const dir = posix.dirname(f);
  for (const b of JSON.parse(readFileSync(join(repoRoot, f), 'utf8')).binaries ?? []) {
    const where = `binary ${b.name}@${b.version} (${f})`;
    if (!/^https:\/\//.test(b.url ?? '') || !/^[0-9a-f]{64}$/.test(b.sha256 ?? '')) errors.push(`${where}: needs an https "url" and a pinned lowercase "sha256"`);
    if (!/^https:\/\//.test(b.licenseText?.url ?? '') || !/^[0-9a-f]{64}$/.test(b.licenseText?.sha256 ?? '')) errors.push(`${where}: needs "licenseText": { url, sha256 } so the package can ship the full license text`);
    binaries.push({ ...b, file: f, dir, status: judge('binary', b.name, b.version, b.license, dir) });
  }
}

// --- fetched sources stay fetched (never vendored) --------------------------------------------
for (const ex of exceptions.filter((e) => e.ecosystem === 'external')) {
  for (const dir of ex.fetchedInto ?? []) {
    if (!isGitIgnored(`${dir}/probe`)) errors.push(`${ex.id}: ${dir}/ must be gitignored (fetched ${ex.name} must not be committed)`);
    const tracked = files.filter((f) => f.startsWith(dir + '/'));
    if (tracked.length) errors.push(`${ex.id}: ${tracked.length} file(s) under ${dir}/ are tracked or unignored, e.g. ${tracked[0]}`);
    usedExceptions.add(ex.id);
  }
}
for (const f of files.filter((f) => f.endsWith('.cs'))) {
  const src = readFileSync(join(repoRoot, f), 'utf8');
  if (/^\s*namespace\s+YARG\b/m.test(src)) errors.push(`${f}: declares a YARG namespace; YARG/YARG.Core code must be fetched, not vendored (ADR-0008)`);
}
for (const f of files) if (/(^|\/)YARG(\.Core)?\//.test(f)) errors.push(`${f}: looks like vendored YARG sources (ADR-0008)`);

for (const ex of exceptions.filter((e) => e.ecosystem === 'file')) {
  if (files.some((f) => f === ex.name)) usedExceptions.add(ex.id);
  else warnings.push(`${ex.id}: ${ex.name} no longer exists; remove the exception`);
}
const gated = [...exceptions, ...copyleftGate].filter((e) => e.gate);
for (const ex of [...exceptions, ...copyleftGate]) {
  if (!usedExceptions.has(ex.id)) warnings.push(`${ex.id} (${ex.name}) matched nothing; remove it from exceptions.json`);
  else if (ex.status === 'pending-owner') warnings.push(`${ex.id} (${ex.name}, ${ex.license}) is pending owner sign-off in ADR-${ex.adr}`);
}

// --- THIRD_PARTY_NOTICES.md -------------------------------------------------------------------
const esc = (s) => String(s).replace(/\|/g, '\\|');
const npmRows = [...npm.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version, undefined, { numeric: true }));
const licenseIds = new Set();
for (const p of [...npmRows, ...nuget, ...binaries]) {
  if (!p.license) continue;
  try {
    idsOf(p.license).forEach((id) => licenseIds.add(id));
  } catch {}
}
const lines = [
  '<!-- Generated by tools/licensing/license-gate.mjs from package-lock.json files, MSBuild files and',
  '     tools/licensing/exceptions.json. Do not edit by hand; run `node tools/licensing/license-gate.mjs`. -->',
  '',
  '# Third-party notices',
  '',
  'Go Go HarmoniYo\'s own code is [MIT](LICENSE). This file lists the third-party software the repository',
  'depends on, with each component\'s declared license, so the obligations are visible in one place.',
  'Assets (art, audio, songs, charts) are credited separately in [ATTRIBUTION.md](ATTRIBUTION.md).',
  '',
  'Nothing listed here is vendored into this repository: npm packages are installed from the',
  'lockfiles, fetched sources are cloned into gitignored folders and pinned binaries are downloaded at',
  'package time. A package that bundles dependencies also ships their full license texts and copyright',
  'notices (see [ADR-0008](docs/decisions/0008-assets-ip-and-attribution.md)): the portable Windows',
  'package ([tools/package/windows](tools/package/windows/README.md)) generates its own',
  'THIRD_PARTY_NOTICES.md listing exactly what it bundles.',
  'Licenses are as declared in package metadata; they are not legal advice.',
  '',
  '## Fetched sources (not vendored)',
  '',
  '| Source | License | Used by | Fetched into (gitignored) | Exception |',
  '|---|---|---|---|---|',
  ...exceptions.filter((e) => e.ecosystem === 'external').map((e) =>
    `| ${esc(e.name)} | ${e.license} | ${e.scope.map((s) => `\`${s}\``).join(', ')} | ${(e.fetchedInto ?? []).map((s) => `\`${s}/\``).join(', ')} | ${e.id} (${e.status}) |`),
  '',
  `## npm packages (${npmRows.length})`,
  '',
  `Projects: ${npmProjects.map((p) => `\`${p.dir}\` (${p.packages})`).join(', ')}. Scope comes from the lockfile:`,
  '*runtime* ships with the app; *dev* is build/test tooling only; *optional* installs only when available.',
  '',
  '| Package | Version | License | Scope | Used by |',
  '|---|---|---|---|---|',
  ...npmRows.map((p) => `| ${esc(p.name)} | ${p.version} | ${esc(p.license)}${/^(EX|CG)-/.test(p.status) ? ` (${p.status})` : ''} | ${[...p.scopes].sort().join(', ')} | ${[...p.dirs].sort().map((d) => `\`${d}\``).join(', ')} |`),
  '',
  `## NuGet packages (${nuget.length})`,
  '',
  ...(nuget.length
    ? ['| Package | Version | License | Declared in |', '|---|---|---|---|', ...nuget.map((r) => `| ${esc(r.name)} | ${r.version} | ${r.license ?? '(not checked)'} | \`${r.file}\` |`)]
    : ['No direct `PackageReference`s. The S2/S3 harnesses get their NuGet packages transitively through the fetched YARG.Core project (see above); they are restored, not redistributed.']),
  '',
  `## Pinned binaries (${binaries.length})`,
  '',
  'Downloaded at package time, verified against the pinned SHA-256 and redistributed unmodified.',
  '',
  '| Binary | Version | License | Role | Pinned in |',
  '|---|---|---|---|---|',
  ...binaries.map((b) => `| [${esc(b.name)}](${b.source ?? b.url}) | ${b.version} | ${esc(b.license)}${/^(EX|CG)-/.test(b.status) ? ` (${b.status})` : ''} | ${esc(b.role ?? '')} | \`${b.file}\` |`),
  '',
  '## Exceptions to the license allowlist',
  '',
  '| Id | Component | License | Status | Reason |',
  '|---|---|---|---|---|',
  ...exceptions.map((e) => `| ${e.id} | ${esc(e.name)} (${e.ecosystem}) | ${e.license} | ${e.status} | ${esc(e.reason)} |`),
  '',
  '## Copyleft adoption gate',
  '',
  'Copyleft components are fine in spikes when labeled. Before one moves into a shipped product or',
  'distribution, a compliance ADR is required ([ADR-0008](docs/decisions/0008-assets-ip-and-attribution.md#copyleft-adoption-gate)).',
  '',
  '| Id | Component | License | Scope | Gate |',
  '|---|---|---|---|---|',
  ...gated.map((e) => `| ${e.id} | ${esc(e.name)} (${e.ecosystem}) | ${e.license} | ${e.scope.map((s) => `\`${s}\``).join(', ')} | ${e.gate} |`),
  '',
  '## License texts',
  '',
  ...[...licenseIds].sort().map((id) => `- **${id}**: ${licenseUrl(id)}`),
  '',
];
const notices = lines.join('\n');

const fresh = emit('THIRD_PARTY_NOTICES.md', notices, CHECK);
if (!fresh) errors.push('THIRD_PARTY_NOTICES.md is stale');

const counts = {};
for (const p of npm.values()) counts[p.license ?? '(none)'] = (counts[p.license ?? '(none)'] ?? 0) + 1;
console.log(`npm: ${npm.size} package versions in ${npmProjects.length} projects ${JSON.stringify(counts)}`);
console.log(`nuget: ${nuget.length} direct package reference(s)`);
console.log(`binaries: ${binaries.map((b) => `${b.name}@${b.version} (${b.license})`).join(', ') || 'none'}`);
for (const w of warnings) console.log(`⚠ ${w}`);
for (const g of gated) console.log(`ℹ ${g.id} ${g.name} (${g.license}): ${g.gate}`);
for (const e of errors) console.error(`✗ ${e}`);
if (errors.length) {
  console.error(`License gate FAILED with ${errors.length} error(s). See ADR-0008 and tools/licensing/README.md.`);
  process.exit(1);
}
console.log('License gate passed.');
