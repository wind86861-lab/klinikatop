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
        manualChunks: {
          /*
           * `framer-motion` ataylab bu yerda YO'Q.
           *
           * U `LazyMotion` orqali birinchi bo'yoqdan keyin yuklanadi
           * va alohida bo'lakka o'zi ajraladi. Bu yerga qo'yilsa
           * majburan asosiy yo'lga qaytardi.
           */
          router: ['react-router-dom'],
        },
      },
    },
  },
});
