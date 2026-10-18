import { defineConfig } from 'vite';
export default defineConfig({
  base: '/',
  build: { outDir: 'dist', assetsDir: 'assets', chunkSizeWarningLimit: 1200, target: 'es2022' },
  server: { fs: { allow: ['..'] } },
});
