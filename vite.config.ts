import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    port: 1436,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**', '**/.test-data/**', '**/output/**', '**/.playwright-cli/**'],
    },
  },
  clearScreen: false,
});
