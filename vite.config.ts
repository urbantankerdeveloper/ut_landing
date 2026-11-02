import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(() => {
  // The API port comes from backend/.env.local (or .env) so the dev proxy always reaches the running backend.
  const backendEnv = loadEnv('development', fileURLToPath(new URL('./backend', import.meta.url)), '')
  const apiTarget = `http://localhost:${backendEnv.PORT || '8080'}`
  return {
    plugins: [react()],
    server: { proxy: { '/api': apiTarget } },
  }
})
