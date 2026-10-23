import { defineConfig } from 'vite';

// Relative base so the static build works from any sub-path (e.g. GitHub Pages project sites).
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
