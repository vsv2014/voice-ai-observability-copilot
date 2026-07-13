import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    // Proxy API calls to the backend so the embedded app is same-origin in dev.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
