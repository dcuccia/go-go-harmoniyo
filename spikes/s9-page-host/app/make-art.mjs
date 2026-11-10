// Rasterises the committed brand SVGs (docs/design/brand) into the app shells' icons, Android TV
// banner and splash art, so no new binary assets are committed. Derived from registered brand
// assets (CC BY 4.0). Does whichever of android/ and ios/ exist. Needs Chrome (playwright-core
// from ../node_modules, channel 'chrome').
//   node make-art.mjs [--channel chrome]
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const brand = join(here, '..', '..', '..', 'docs', 'design', 'brand');
const res = join(here, 'android', 'app', 'src', 'main', 'res');
const xcassets = join(here, 'ios', 'App', 'App', 'Assets.xcassets');
const STAGE = '#0b0d17';
const { values: args } = parseArgs({ options: { channel: { type: 'string', default: 'chrome' } } });

const svg = (f) => `data:image/svg+xml;base64,${readFileSync(join(brand, f)).toString('base64')}`;
const page = (w, h, body) =>
  `<!doctype html><html><body style="margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent">${body}</body></html>`;
const img = (src, css) => `<img src="${src}" style="display:block;${css}">`;

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const jobs = [];
const android = existsSync(res);
for (const [d, k] of android ? Object.entries(DENSITIES) : []) {
  const icon = Math.round(48 * k);
  const fg = Math.round(108 * k);
  for (const name of ['ic_launcher', 'ic_launcher_round']) {
    const radius = name === 'ic_launcher_round' ? 'border-radius:50%;' : '';
    jobs.push({ out: join(res, `mipmap-${d}`, `${name}.png`), w: icon, h: icon, html: page(icon, icon, img(svg('app-icon-maskable.svg'), `width:${icon}px;height:${icon}px;${radius}`)) });
  }
  // Adaptive-icon foreground: launchers mask to the inner 72/108; the maskable art keeps its mark
  // inside an 80 % circle, so scale it to fill ~the 72 dp safe area over the stage background.
  const inner = Math.round(fg * 0.8);
  jobs.push({
    out: join(res, `mipmap-${d}`, 'ic_launcher_foreground.png'),
    w: fg,
    h: fg,
    html: page(fg, fg, `<div style="width:${fg}px;height:${fg}px;background:${STAGE};display:grid;place-items:center">${img(svg('app-icon-maskable.svg'), `width:${inner}px;height:${inner}px`)}</div>`),
  });
}
if (android) {
  // Android TV launcher banner: 320 × 180 px in drawable-xhdpi (the documented size).
  jobs.push({
    out: join(res, 'drawable-xhdpi', 'banner.png'),
    w: 320,
    h: 180,
    html: page(320, 180, `<div style="width:320px;height:180px;background:${STAGE};display:grid;place-items:center">${img(svg('logo-line-dark.svg'), 'width:288px')}</div>`),
  });
  // Splash: the stacked lockup, centred on the stage colour by drawable/splash.xml.
  jobs.push({ out: join(res, 'drawable-xhdpi', 'splash_mark.png'), w: 480, h: 480, html: page(480, 480, img(svg('logo-stacked-dark.svg'), 'width:480px;height:480px;object-fit:contain')) });
}
if (existsSync(xcassets)) {
  // iOS: one 1024 px icon, opaque (App Store icons must not have alpha), and the 2732 px splash.
  jobs.push({ out: join(xcassets, 'AppIcon.appiconset', 'AppIcon-512@2x.png'), w: 1024, h: 1024, opaque: true, html: page(1024, 1024, img(svg('apple-touch-icon.svg'), 'width:1024px;height:1024px')) });
  const splash = page(2732, 2732, `<div style="width:2732px;height:2732px;background:${STAGE};display:grid;place-items:center">${img(svg('logo-stacked-dark.svg'), 'width:900px;height:900px;object-fit:contain')}</div>`);
  for (const n of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) jobs.push({ out: join(xcassets, 'Splash.imageset', n), w: 2732, h: 2732, opaque: true, html: splash });
}

const browser = await chromium.launch({ channel: args.channel });
try {
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  for (const j of jobs) {
    await p.setViewportSize({ width: j.w, height: j.h });
    await p.setContent(j.html);
    await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
    mkdirSync(dirname(j.out), { recursive: true });
    await p.screenshot({ path: j.out, omitBackground: !j.opaque, clip: { x: 0, y: 0, width: j.w, height: j.h } });
  }
} finally {
  await browser.close();
}
console.log(`S9 app art: ${jobs.length} PNGs (${[android && 'android', existsSync(xcassets) && 'ios'].filter(Boolean).join(', ')})`);
