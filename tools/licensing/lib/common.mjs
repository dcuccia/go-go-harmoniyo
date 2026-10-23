// Shared helpers for the licensing tools. Node built-ins only (no dependencies to gate).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const readJson = (rel) => JSON.parse(readFileSync(join(repoRoot, rel), 'utf8'));

/** Tracked files plus untracked files that are not ignored, as forward-slash repo paths. */
export function repoFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return [...new Set(out.split('\0').filter(Boolean))]
    .filter((p) => existsSync(join(repoRoot, p)))
    .sort();
}

export function isGitIgnored(rel) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--no-index', rel], { cwd: repoRoot });
    return true;
  } catch {
    return false;
  }
}

/** Glob → RegExp. Supports `**`, `*`, `?` and `{a,b}`; paths use `/`. */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?';
        } else re += '.*';
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      re += '(?:' + glob.slice(i + 1, end).split(',').map(escapeRe).join('|') + ')';
      i = end;
    } else re += escapeRe(c);
  }
  return new RegExp('^' + re + '$');
}
const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\*?]/g, '\\$&');

export const matchesAny = (path, globs) => globs.some((g) => globToRegExp(g).test(path));

/** SHA-256 of a file; text files (no NUL byte) are hashed with CRLF normalized to LF. */
export function sha256File(rel) {
  let buf = readFileSync(join(repoRoot, rel));
  if (!buf.includes(0)) buf = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  return createHash('sha256').update(buf).digest('hex');
}

/** Write generated content, or (check mode) report whether the committed file is stale. */
export function emit(rel, content, check) {
  const abs = join(repoRoot, rel);
  const current = existsSync(abs) ? readFileSync(abs, 'utf8').replace(/\r\n/g, '\n') : null;
  if (current === content) return true;
  if (check) {
    console.error(`✗ ${rel} is out of date. Run the generator without --check and commit the result.`);
    return false;
  }
  writeFileSync(abs, content);
  console.log(`wrote ${rel}`);
  return true;
}

export const licenseUrl = (id) =>
  id.startsWith('LicenseRef-') ? `LICENSES/${id}.txt` : `https://spdx.org/licenses/${id}.html`;
