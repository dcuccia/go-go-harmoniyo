// Readability check for the pitch-class palette (docs/design/pitch-class-palette.json).
//   node tools/design/palette-check.mjs [--md] [--sheet=docs/design/media/pitch-class-palette-cvd.png]
// Checks: hex ↔ OKLCH agreement, WCAG contrast against the stage/highway backgrounds and with the
// dark label text, and CIEDE2000 distances between pitch classes that sit next to each other on
// a ringer's highway, under normal vision and simulated protanopia, deuteranopia and tritanopia
// (Machado, Oliveira & Fernandes 2009, severity 1.0). Exit code 1 if a check fails.
// --sheet renders a swatch sheet (normal + three simulations) with playwright-core from
// spikes/s4-web-host (run `npm ci` there first) and a locally installed Chrome.
import { readFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const palette = JSON.parse(readFileSync(join(root, 'docs/design/pitch-class-palette.json'), 'utf8'));
const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];

// Thresholds (see docs/design/visual-identity.md, "Readability check").
const MIN_CONTRAST = 4.5;
const MIN_DE_NEIGHBOR = 10; // ΔE00 between natural neighbours (whole/half step) — at a glance
const MIN_DE_ACC = 8; // ΔE00 natural vs. its sharp/flat neighbour (also differs by the ring outline)
const BACKGROUNDS = { stage: palette.background, highway: '#05040d' };

// ── colour math ──────────────────────────────────────────────────────────────
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const lin = (h) => hexToRgb(h).map(toLin);
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const contrast = (a, b) => {
  const [x, y] = [luminance(lin(a)), luminance(lin(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const rgbToHex = (rgbLin) => '#' + rgbLin.map((c) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255).toString(16).padStart(2, '0')).join('');

function oklchToLin([L, C, h]) {
  const a = C * Math.cos((h * Math.PI) / 180);
  const b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const MACHADO = {
  protanopia: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritanopia: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const simulate = (hex, kind) => {
  if (kind === 'normal') return hex;
  const c = lin(hex);
  return rgbToHex(MACHADO[kind].map((row) => row[0] * c[0] + row[1] * c[1] + row[2] * c[2]));
};

function lab(hex) {
  const [r, g, b] = lin(hex);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const Z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** CIEDE2000 colour difference (Sharma, Wu & Dalal 2005). */
function de2000(h1, h2) {
  const [L1, a1, b1] = lab(h1);
  const [L2, a2, b2] = lab(h2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hp = (a, b) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) dhp = Math.abs(h2p - h1p) <= 180 ? h2p - h1p : h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p + 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) hbp = Math.abs(h1p - h2p) <= 180 ? (h1p + h2p) / 2 : h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

// ── checks ───────────────────────────────────────────────────────────────────
const pcs = palette.pitchClasses;
const NATURAL = new Set([0, 2, 4, 5, 7, 9, 11]);
const failures = [];
const out = [];

out.push('### Hex vs. OKLCH, contrast\n');
out.push(`| Pitch | Hex | OKLCH → sRGB | vs stage \`${BACKGROUNDS.stage}\` | vs highway \`${BACKGROUNDS.highway}\` | \`${palette.textOnFill}\` text on fill |`);
out.push('|---|---|---|---|---|---|');
for (const p of pcs) {
  const fromOklch = rgbToHex(oklchToLin(p.oklch));
  const drift = Math.max(...hexToRgb(fromOklch).map((v, i) => Math.abs(v - hexToRgb(p.hex)[i]))) * 255;
  if (drift > 2) failures.push(`${p.name}: hex ${p.hex} does not match OKLCH ${p.oklch.join(' ')} (${fromOklch})`);
  const cs = contrast(p.hex, BACKGROUNDS.stage);
  const ch = contrast(p.hex, BACKGROUNDS.highway);
  const ct = contrast(p.hex, palette.textOnFill);
  for (const [what, c] of [['stage', cs], ['highway', ch], ['text', ct]]) if (c < MIN_CONTRAST) failures.push(`${p.name}: contrast vs ${what} ${c.toFixed(2)} < ${MIN_CONTRAST}`);
  out.push(`| ${p.name} | \`${p.hex}\` | \`${fromOklch}\` | ${cs.toFixed(2)} | ${ch.toFixed(2)} | ${ct.toFixed(2)} |`);
}

const pairs = [];
for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) pairs.push([i, j]);
const interval = (i, j) => Math.min((j - i + 12) % 12, (i - j + 12) % 12);
// Pitch classes that end up next to each other on a ringer's highway: natural neighbours (C-D,
// D-E, E-F, F-G, G-A, A-B, B-C) and every natural/accidental half step.
const isNatNeighbor = ([i, j]) => NATURAL.has(i) && NATURAL.has(j) && interval(i, j) <= 2;
const isAccPair = ([i, j]) => interval(i, j) === 1 && NATURAL.has(i) !== NATURAL.has(j);
const KINDS = ['normal', 'protanopia', 'deuteranopia', 'tritanopia'];

out.push('\n### Neighbouring pitch classes, CIEDE2000\n');
out.push(`Worst pair per vision type. Pass: ΔE00 ≥ ${MIN_DE_NEIGHBOR} between natural neighbours, ≥ ${MIN_DE_ACC} between a natural and its sharp/flat neighbour (which also differ by the ring outline and lightness). The last two columns are for information.\n`);
out.push('| Vision | Natural neighbours | Natural ↔ accidental | Any two naturals | Any two of 12 |');
out.push('|---|---|---|---|---|');
const worst = (kind, filter) => {
  let best = null;
  for (const pr of pairs.filter(filter)) {
    const d = de2000(simulate(pcs[pr[0]].hex, kind), simulate(pcs[pr[1]].hex, kind));
    if (!best || d < best.d) best = { d, pr };
  }
  return best;
};
const fmt = (w) => `${pcs[w.pr[0]].name}–${pcs[w.pr[1]].name} ${w.d.toFixed(1)}`;
for (const kind of KINDS) {
  const nat = worst(kind, isNatNeighbor);
  const acc = worst(kind, isAccPair);
  const nats = worst(kind, ([i, j]) => NATURAL.has(i) && NATURAL.has(j));
  const all = worst(kind, () => true);
  if (nat.d < MIN_DE_NEIGHBOR) failures.push(`${kind}: natural neighbours ${fmt(nat)} < ${MIN_DE_NEIGHBOR}`);
  if (acc.d < MIN_DE_ACC) failures.push(`${kind}: natural/accidental ${fmt(acc)} < ${MIN_DE_ACC}`);
  out.push(`| ${kind} | ${fmt(nat)} | ${fmt(acc)} | ${fmt(nats)} | ${fmt(all)} |`);
}

console.log(out.join('\n'));
console.log(failures.length ? `\nFAIL\n- ${failures.join('\n- ')}` : '\nPASS: all checks');

// ── swatch sheet ─────────────────────────────────────────────────────────────
const sheet = opt('sheet');
if (sheet) {
  const order = [0, 2, 4, 5, 7, 9, 11, 1, 3, 6, 8, 10];
  const row = (kind) =>
    `<tr><th>${kind}</th>${order
      .map((pc) => {
        const p = pcs[pc];
        return `<td><div class="sw${NATURAL.has(pc) ? '' : ' acc'}" style="background:${simulate(p.hex, kind)}">${p.name.split('/')[0].replace('#', '♯')}</div></td>`;
      })
      .join('')}</tr>`;
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:${palette.background};color:#e8e8f0;font:600 15px system-ui,sans-serif;padding:16px;display:inline-block}
table{border-collapse:separate;border-spacing:8px}th{text-align:right;padding-right:8px;font-weight:600;color:#aab}
.sw{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:${palette.textOnFill};font-size:20px;font-weight:800}
.sw.acc{box-shadow:0 0 0 3px ${palette.background},0 0 0 6px #f4f4ff}
h1{font-size:16px;margin:0 0 6px;color:#ccd}small{color:#889;font-weight:400}</style>
<h1>Pitch-class palette: naturals, then sharps/flats (ring outline)<br><small>Colour-vision simulation: Machado et al. 2009, severity 1.0 (tools/design/palette-check.mjs)</small></h1>
<table>${KINDS.map(row).join('')}</table>`;
  const require = createRequire(join(root, 'spikes/s4-web-host/package.json'));
  const { chromium } = require('playwright-core');
  const browser = await chromium.launch({ channel: opt('channel') ?? 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 500 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  const file = resolve(root, sheet);
  mkdirSync(dirname(file), { recursive: true });
  await page.locator('body').screenshot({ path: file });
  await browser.close();
  console.log(`wrote ${file}`);
}
process.exitCode = failures.length ? 1 : 0;
