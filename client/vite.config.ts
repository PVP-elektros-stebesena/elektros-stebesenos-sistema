import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/meteo': {
        target: 'https://api.meteo.lt',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/meteo/, ''),
      },
    },
  },
})
