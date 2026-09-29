/*
 * @language  JavaScript (Vite config)
 * @updated   2026-09-30
 * @changed   Dev-server proxy for /hume → api.hume.ai (WebSocket), mirroring the nginx relay voice calls use.
 */
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url'
import path from 'path'

// These two lines are the modern ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  // Use path.resolve instead of process.cwd() for better reliability
  const env = loadEnv(mode, path.resolve(__dirname), '');

  // Toggle based on your .env variable
  const target = env.VITE_BACKEND_TARGET === 'docker' 
    ? 'http://backend:5000' 
    : 'http://127.0.0.1:5000';

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts:[
        "testfront.bitterlylab.com",
        "localhost",
        "127.0.0.1"
      ],
      proxy: {
        '/api': {
          target: target,
          changeOrigin: true,
        },
        // Same Hume EVI relay nginx provides in the deployed container, so voice
        // calls (which always connect via /hume/) also work on the dev server.
        '/hume': {
          target: 'https://api.hume.ai',
          changeOrigin: true,
          ws: true,
          rewrite: (p) => p.replace(/^\/hume/, ''),
        },
      },
    },
  }
})