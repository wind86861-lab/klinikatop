import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      output: {
        // Telegram Web App tez ochilishi uchun — og'ir kutubxonalar alohida chunk
        /*
         * `manualChunks` KERAK EMAS.
         *
         * Ilgari bu yerda `react-router-dom` alohida bo'lakka
         * ajratilardi. Endi marshrutlagich o'zimizniki (`lib/router`)
         * va bir necha kilobayt — ajratish faqat yana bitta so'rov
         * qo'shardi.
         *
         * `framer-motion` esa `LazyMotion` orqali o'zi ajraladi.
         */
      },
    },
  },
});
