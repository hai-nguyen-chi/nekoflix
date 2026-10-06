import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, './src') },
  },
  server: {
    port: 5173,
    // KHÔNG dùng proxy sang gateway.
    //
    // Proxy sẽ giấu mất vấn đề CORS và cookie cho tới lúc deploy. Gọi thẳng
    // localhost:4000 kèm credentials buộc ta phải cấu hình CORS đúng ngay
    // từ đầu — giống hệt môi trường thật.
  },
});
