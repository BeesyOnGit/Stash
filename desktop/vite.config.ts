import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Two pages: the app, and the mini vinyl player (its own always-on-top window).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        mini: resolve(__dirname, 'mini.html'),
      },
    },
  },
});
