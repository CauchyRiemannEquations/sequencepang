import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('./client/', import.meta.url));

export default defineConfig({
  root: clientRoot,
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000'
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
