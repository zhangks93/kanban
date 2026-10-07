import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import '../api/src/lib/env';
const appUrl = new URL(process.env.APP_BASE_URL!);
const apiTarget = `http://127.0.0.1:${process.env.API_PORT}`;
export default defineConfig({
  envDir: '../..',
  plugins: [react(), tailwind()],
  server: {
    port: Number(appUrl.port || (appUrl.protocol === 'https:' ? 443 : 80)),
    strictPort: true,
    proxy: { '/api': apiTarget, '/auth': apiTarget },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules') && (id.includes('@tiptap') || id.includes('prosemirror')))
            return 'editor';
          if (id.includes('node_modules') && id.includes('@sentry')) return 'monitoring';
        },
      },
    },
  },
});
