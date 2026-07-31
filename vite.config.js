import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 開発中は /api を Vercel の関数へ回す（vercel dev を 3000 で動かす想定）
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3000' } },
  build: { outDir: 'dist' },
});
