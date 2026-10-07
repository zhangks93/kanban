import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:3001', '/auth': 'http://localhost:3001' },
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
