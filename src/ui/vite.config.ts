import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: path.resolve(__dirname, '../../dist/ui'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200  // three.js 体积大，桌面应用本地加载无需分包
  },
  server: { port: 5173, strictPort: true }
})
