// frontend/vite.config.js

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // This is required to make the server accessible outside the container
    host: '0.0.0.0', 
    port: 5173,
    // Use the dev server's built-in proxy to talk to the backend
    proxy: {
      '/api': {
        // 'backend' is the service name from your docker-compose file
        target: 'http://backend:5000', 
        changeOrigin: true,
      },
    },
  },
})