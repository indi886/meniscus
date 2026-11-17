import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';

// Dev 5323 / preview 4323: not used by any sibling project in C:\Users\indik.
export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    port: 5323,
    strictPort: true,
    host: '127.0.0.1',
    // Never reload a running headless capture because a screenshot, a raw asset or a doc changed.
    watch: { ignored: ['**/shots/**', '**/assets-src/**', '**/scripts/**', '**/*.md'] },
  },
  preview: { port: 4323, strictPort: true, host: '127.0.0.1' },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        services: resolve(__dirname, 'services.html'),
      },
      output: {
        manualChunks: { three: ['three'], motion: ['gsap', 'lenis'] },
      },
    },
  },
});
