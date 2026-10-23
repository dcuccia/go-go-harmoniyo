import { defineConfig } from 'vite';

// Relative base so the static build works from any sub-path (e.g. GitHub Pages project sites).
// fs.allow: the shared pitch-class palette (spikes/shared + docs/design) lives outside this folder.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  server: { fs: { allow: ['.', '../shared', '../../docs/design'] } },
});
