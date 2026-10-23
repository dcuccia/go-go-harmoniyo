// Captures an animated GIF of autoplay via CDP screencast.
//   node scripts/capture-gif.mjs [baseUrl] [--seconds=10] [--start=14] [--width=720] [--fps=15] [--out=../../docs/spikes/media/s4-autoplay.gif]
import { chromium } from 'playwright-core';
import gifenc from 'gifenc';
import jpeg from 'jpeg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { GIFEncoder, quantize, applyPalette } = gifenc;

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:5173/';
const opt = (k, d) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const seconds = Number(opt('seconds', 10));
const startAt = Number(opt('start', 14));
const width = Number(opt('width', 720));
const fps = Number(opt('fps', 15));
const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', opt('out', '../../docs/spikes/media/s4-autoplay.gif'));
const height = Math.round((width * 9) / 16);

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--autoplay-policy=no-user-gesture-required', '--force_high_performance_gpu'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const cdp = await page.context().newCDPSession(page);
await page.goto(`${base}?mode=autoplay&auto=1`);
await page.waitForTimeout(startAt * 1000);

const frames = [];
cdp.on('Page.screencastFrame', (f) => {
  frames.push({ t: f.metadata.timestamp, data: f.data });
  cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: width, maxHeight: height, everyNthFrame: 1 });
await page.waitForTimeout(seconds * 1000);
await cdp.send('Page.stopScreencast');
await browser.close();
console.log(`captured ${frames.length} screencast frames`);

const gif = GIFEncoder();
const t0 = frames[0].t;
let fi = 0;
const delay = Math.round(1000 / fps);
for (let k = 0; k < seconds * fps; k++) {
  const t = t0 + k / fps;
  while (fi + 1 < frames.length && frames[fi + 1].t <= t) fi++;
  const img = jpeg.decode(Buffer.from(frames[fi].data, 'base64'), { useTArray: true, formatAsRGBA: true });
  const palette = quantize(img.data, Number(opt('colors', 128)), { format: 'rgb565' });
  gif.writeFrame(applyPalette(img.data, palette, 'rgb565'), img.width, img.height, { palette, delay });
}
gif.finish();
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gif.bytes());
console.log(`wrote ${out} (${(gif.bytes().length / 1e6).toFixed(1)} MB)`);
