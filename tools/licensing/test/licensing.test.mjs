import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { globToRegExp, repoRoot } from '../lib/common.mjs';
import { validate } from '../lib/schema.mjs';
import { idsOf, isAllowed, normalizeNpmLicense } from '../lib/spdx.mjs';

const allow = new Set(['MIT', 'Apache-2.0', 'CC0-1.0']);
const schema = JSON.parse(readFileSync(join(repoRoot, 'attribution/register.schema.json'), 'utf8'));
const register = JSON.parse(readFileSync(join(repoRoot, 'attribution/register.json'), 'utf8'));

test('SPDX: OR needs one allowed branch, AND needs all, WITH is never implicit', () => {
  assert.equal(isAllowed('MIT', allow), true);
  assert.equal(isAllowed('(MIT OR GPL-3.0-only)', allow), true);
  assert.equal(isAllowed('MIT AND GPL-3.0-only', allow), false);
  assert.equal(isAllowed('Apache-2.0 WITH LLVM-exception', allow), false);
  assert.equal(isAllowed('MPL-2.0', allow), false);
  assert.deepEqual(idsOf('(MIT OR Apache-2.0) AND CC0-1.0'), ['MIT', 'Apache-2.0', 'CC0-1.0']);
  assert.throws(() => isAllowed('(MIT OR', allow));
});

test('npm legacy license fields normalize to SPDX', () => {
  assert.equal(normalizeNpmLicense({ type: 'MIT' }), 'MIT');
  assert.equal(normalizeNpmLicense([{ type: 'MIT' }, { type: 'Apache-2.0' }]), 'MIT OR Apache-2.0');
  assert.equal(normalizeNpmLicense(undefined), null);
});

test('globs follow REUSE semantics: * stays in a folder, ** crosses folders', () => {
  assert.ok(globToRegExp('docs/*').test('docs/a.png'));
  assert.ok(!globToRegExp('docs/*').test('docs/x/a.png'));
  assert.ok(globToRegExp('docs/**.png').test('docs/x/y/a.png'));
  assert.ok(globToRegExp('**/song.ini').test('song.ini'));
  assert.ok(globToRegExp('a/{b,c}.json').test('a/c.json'));
  assert.ok(!globToRegExp('a/{b,c}.json').test('a/d.json'));
});

test('the committed register satisfies its schema', () => {
  assert.deepEqual(validate(schema, register), []);
});

const base = register.assets.find((a) => a.origin === 'third-party');
const clone = (patch) => ({ ...register, assets: [{ ...structuredClone(base), ...patch }] });

test('schema: third-party assets need a source and attribution', () => {
  const r = clone({});
  delete r.assets[0].source;
  assert.match(validate(schema, r).join('\n'), /missing required "source"/);
});

test('schema: AI-generated assets need the full provenance block', () => {
  assert.match(validate(schema, clone({ origin: 'ai-generated', source: undefined })).join('\n'), /missing required "ai"/);
  const partial = clone({ origin: 'ai-generated', ai: { tool: 'x', model: 'y' } });
  assert.match(validate(schema, partial).join('\n'), /missing required "prompt"/);
});

test('schema: unknown fields and bad hashes are rejected', () => {
  assert.match(validate(schema, clone({ colour: 'red' })).join('\n'), /unexpected property "colour"/);
  assert.deepEqual(validate(schema, clone({ candidate: true })), []);
  assert.match(validate(schema, clone({ candidate: 'yes' })).join('\n'), /candidate/);
  const bad = clone({});
  bad.assets[0].source.files[0].sha256 = 'abc';
  assert.match(validate(schema, bad).join('\n'), /does not match/);
});

test('generated files are in sync (license gate offline + attribution --check)', () => {
  const run = (script, ...args) => execFileSync(process.execPath, [join(repoRoot, 'tools/licensing', script), ...args], { cwd: repoRoot, encoding: 'utf8' });
  assert.match(run('license-gate.mjs', '--check', '--offline'), /License gate passed/);
  assert.match(run('attribution.mjs', '--check'), /Asset register OK/);
});

test('bundle gate: allowlisted packages need a license text; copyleft and undeclared fail', async () => {
  const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { bundleNotices, packageDirOf } = await import('../lib/bundle.mjs');
  const nm = join(mkdtempSync(join(tmpdir(), 'bundle-gate-')), 'node_modules');
  const pkg = (name, license, licenseFile) => {
    const dir = join(nm, ...name.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', license }));
    if (licenseFile) writeFileSync(join(dir, 'LICENSE'), `${license} text for ${name}`);
    return dir;
  };
  try {
    assert.equal(packageDirOf(join(nm, '@scope', 'a', 'dist', 'x.js')), join(nm, '@scope', 'a'));
    assert.equal(packageDirOf(join(nm, 'b', 'node_modules', 'c', 'i.js')), join(nm, 'b', 'node_modules', 'c'));
    assert.equal(packageDirOf(join('spikes', 'x', 'src', 'y.ts')), null);
    const packages = new Map([
      [pkg('@scope/a', 'MIT', true), new Set(['host'])],
      [pkg('nolicense', 'ISC', false), new Set(['game'])],
      [pkg('pinned', 'MIT', false), new Set(['host'])],
      [pkg('copyleft', 'GPL-3.0-only', true), new Set(['game'])],
    ]);
    const extraTexts = { 'pinned@1.0.0': { url: 'https://example.invalid/LICENSE', text: 'MIT pinned text' } };
    const { errors, rows, markdown } = bundleNotices({ packages, scope: 'tools/package/test', title: 'test', extraTexts,
      binaries: [{ name: 'Tool', version: '1', license: 'Apache-2.0', url: 'https://example.invalid/tool', text: 'Apache text' }] });
    assert.deepEqual(rows.map((r) => r.name), ['@scope/a', 'copyleft', 'nolicense', 'pinned']);
    assert.equal(errors.length, 2);
    assert.match(errors.join('\n'), /nolicense@1\.0\.0: no LICENSE/);
    assert.match(errors.join('\n'), /copyleft@1\.0\.0: license "GPL-3\.0-only"/);
    assert.match(markdown, /MIT pinned text/);
    assert.match(markdown, /### Tool 1[\s\S]*Apache text/);
  } finally {
    rmSync(dirname(nm), { recursive: true, force: true });
  }
});
