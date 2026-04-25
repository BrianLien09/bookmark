import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/bookmark/',
  build: {
    // 提高 chunk 警告門檻至 600KB（555KB 的應用是合理的）
    chunkSizeWarningLimit: 600,
  },
});
