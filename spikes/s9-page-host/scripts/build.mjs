// S9 web build → dist/web/ (the Worker's static assets and the app shells' webDir):
//   /       the I2 TV game with the host in the page (src/tv.ts), built by Vite from spikes/i2-web-phones
//   /c/     the S1 phone controller over WebRTC (src/phone.ts), bundled by esbuild
// Needs spikes/i2-web-phones' node_modules (three) and its generated public/ (charts, brand):
// `npm ci && npm run charts && npm run brand` there (CI does it).
//   node scripts/build.mjs [--signal https://….workers.dev]   (or env S9_SIGNAL_ORIGIN)
// The signal origin is baked in for the app shells, whose pages load from https://localhost or
// capacitor://localhost; the hosted web build uses its own origin when none is baked in.
import { build as esbuild } from 'esbuild';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build as vite } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const repo = join(root, '..', '..');
const i2 = join(repo, 'spikes', 'i2-web-phones');
const s1web = join(repo, 'spikes', 's1-phone-bell', 'src', 'web');
const brand = join(repo, 'docs', 'design', 'brand');
const out = join(root, 'dist', 'web');

const { values: args } = parseArgs({ options: { signal: { type: 'string' } } });
const signal = (args.signal ?? process.env.S9_SIGNAL_ORIGIN ?? '').replace(/\/+$/, '');
if (signal && !/^https?:\/\/[^/]+$/.test(signal)) throw new Error(`--signal must be an origin like https://example.workers.dev, got ${signal}`);

for (const need of [join(i2, 'node_modules', 'three'), join(i2, 'public', 'charts'), join(i2, 'public', 'brand')]) {
  if (!existsSync(need)) throw new Error(`missing ${need}: run "npm ci && npm run charts && npm run brand" in spikes/i2-web-phones`);
}

rmSync(out, { recursive: true, force: true });
const define = { __S9_SIGNAL_ORIGIN__: JSON.stringify(signal) };

// ── TV page: i2's index.html with its entry swapped for src/tv.ts ─────────────
const tvEntry = join(root, 'src', 'tv.ts').replaceAll('\\', '/');
await vite({
  root: i2,
  base: './',
  configFile: false,
  logLevel: 'warn',
  define,
  publicDir: join(i2, 'public'),
  resolve: { dedupe: ['three'] },
  build: { outDir: out, emptyOutDir: false, target: 'es2022', chunkSizeWarningLimit: 2000 },
  plugins: [
    {
      name: 's9-tv-entry',
      enforce: 'pre',
      resolveId(id, importer) {
        if (id === '/src/main.ts' && importer?.endsWith('index.html')) return tvEntry;
        return null;
      },
      transformIndexHtml: (html) => html.replace('<title>', '<title>S9 · '),
    },
  ],
});

// ── phone controller: s1 controller.html at /c/ with relative paths ─────────────
const c = join(out, 'c');
mkdirSync(join(c, 'brand', 'yo'), { recursive: true });
await esbuild({
  entryPoints: [join(root, 'src', 'phone.ts')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari15', 'chrome100'],
  minify: true,
  sourcemap: false,
  define,
  outfile: join(c, 'controller.js'),
  logLevel: 'warning',
});
const html = readFileSync(join(s1web, 'controller.html'), 'utf8')
  .replaceAll('src="/dist/controller.js"', 'src="./controller.js"')
  .replace(/(href|src)="\/(?!\/)/g, '$1="./');
if (/(href|src)="\//.test(html)) throw new Error('controller.html still has absolute paths');
writeFileSync(join(c, 'index.html'), html);
copyFileSync(join(s1web, 'style.css'), join(c, 'style.css'));
const manifest = JSON.parse(readFileSync(join(s1web, 'manifest.webmanifest'), 'utf8'));
manifest.start_url = './';
manifest.scope = './';
for (const i of manifest.icons) i.src = i.src.replace(/^\//, './');
writeFileSync(join(c, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));
const used = new Set([...html.matchAll(/\.\/brand\/([\w/-]+\.\w+)/g)].map((m) => m[1]));
for (const i of manifest.icons) used.add(i.src.replace('./brand/', ''));
used.add('favicon.ico');
for (const f of used) copyFileSync(join(brand, f), join(c, 'brand', f));
copyFileSync(join(brand, 'favicon.ico'), join(c, 'favicon.ico'));
// Licences and attribution travel with the build (Worker assets and the APK/IPA), as in the Windows zip.
// THIRD_PARTY_NOTICES.md is the repo-wide superset; a release build would tailor it like tools/package/windows.
const legal = join(out, 'legal');
mkdirSync(join(legal, 'LICENSES'), { recursive: true });
copyFileSync(join(repo, 'LICENSE'), join(legal, 'LICENSE.txt'));
for (const f of ['ATTRIBUTION.md', 'THIRD_PARTY_NOTICES.md']) copyFileSync(join(repo, f), join(legal, f));
for (const f of readdirSync(join(repo, 'LICENSES')).filter((f) => !f.startsWith('LGPL'))) copyFileSync(join(repo, 'LICENSES', f), join(legal, 'LICENSES', f));
writeFileSync(join(out, 's9-build.json'), JSON.stringify({ signal, builtAt: new Date().toISOString() }, null, 2));
console.log(`S9 web build → ${out}${signal ? ` (signal ${signal})` : ' (signal: same origin)'}`);
