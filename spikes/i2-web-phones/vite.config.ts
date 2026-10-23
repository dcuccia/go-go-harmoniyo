import { defineConfig } from 'vite';

// Imports code straight from the sibling spikes (S4 renderer/judge/session/audio, S1 HGP clock
// sync). Relative base so the build can be served from the S1 host at /game/.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  resolve: { dedupe: ['three'] },
  server: { fs: { allow: ['..'] } },
});
