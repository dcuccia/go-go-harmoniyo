import { dotnet } from './_framework/dotnet.js';

const out = document.getElementById('out');
const t0 = performance.now();
const { getAssemblyExports, getConfig } = await dotnet.create();
const t1 = performance.now();
const exports = await getAssemblyExports(getConfig().mainAssemblyName);
const t2 = performance.now();

const iterations = Number(new URLSearchParams(location.search).get('iterations') ?? 20);
const report = exports.HandbellSpike.Wasm.Interop.RunAll(iterations);
const t3 = performance.now();

out.textContent =
  `Browser: ${navigator.userAgent}\n` +
  `Boot: dotnet.create ${(t1 - t0).toFixed(0)} ms, getAssemblyExports ${(t2 - t1).toFixed(0)} ms, ` +
  `RunAll total ${(t3 - t2).toFixed(0)} ms\n\n` + report;
document.title = report.startsWith('FAILED') ? 'S2 FAILED' : 'S2 DONE';
