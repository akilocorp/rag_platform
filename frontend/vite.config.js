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
    : 'http://localhost:5000';

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: target,
          changeOrigin: true,
        },
      },
    },
  }
})