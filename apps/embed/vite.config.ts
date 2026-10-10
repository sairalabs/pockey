import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Served from embed.pockey.xyz in production, http://localhost:5174 locally
// (the API's EMBED_ORIGIN default). The API URL is injected at build time.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
