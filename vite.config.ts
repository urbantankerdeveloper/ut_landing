import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

// Read PORT without loadEnv: loadEnv copies a NODE_ENV from backend/.env* into the process, which makes `vite build` a development build.
function backendPort() {
  if (process.env.PORT) return process.env.PORT
  for (const name of ['.env.local', '.env']) {
    try {
      const match = readFileSync(fileURLToPath(new URL(`./backend/${name}`, import.meta.url)), 'utf8').match(/^\s*PORT\s*=\s*"?(\d+)"?\s*$/m)
      if (match) return match[1]
    } catch { /* optional file */ }
  }
  return '8080'
}

// https://vite.dev/config/
export default defineConfig(() => {
  // The API port comes from backend/.env.local (or .env) so the dev proxy always reaches the running backend.
  const apiTarget = `http://localhost:${backendPort()}`
  return {
    plugins: [react()],
    server: { proxy: { '/api': apiTarget } },
  }
})
