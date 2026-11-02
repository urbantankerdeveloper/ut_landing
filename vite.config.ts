import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, type Plugin } from 'vite'

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

// Writes dist/service-worker.js from src/pwa/service-worker.js. The precache list is index.html plus the JS, CSS and preloaded fonts it references,
// so the service worker caches what the first paint needs and nothing else. The build id is a hash of index.html, so every deploy renames the caches.
function serviceWorkerShell(): Plugin {
  let outDir = ''
  return {
    name: 'urban-tanker-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const html = readFileSync(resolve(outDir, 'index.html'), 'utf8')
      const shellUrls = ['/', ...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css|woff2))"/g)].map((match) => match[1]))]
      const buildId = createHash('sha256').update(html).digest('hex').slice(0, 10)
      const template = readFileSync(fileURLToPath(new URL('./src/pwa/service-worker.js', import.meta.url)), 'utf8')
      const source = template.replace("const SHELL_URLS = []", () => `const SHELL_URLS = ${JSON.stringify(shellUrls)}`).replace("const BUILD_ID = 'development'", () => `const BUILD_ID = '${buildId}'`)
      writeFileSync(resolve(outDir, 'service-worker.js'), source)
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The API port comes from backend/.env.local (or .env) so the dev proxy always reaches the running backend.
  const apiTarget = `http://localhost:${backendPort()}`
  return {
    plugins: [
      react(),
      serviceWorkerShell(),
      // `npm run analyze` writes stats/bundle.html with the size of every module in the bundle.
      mode === 'analyze' && (visualizer({ filename: 'stats/bundle.html', template: 'treemap', gzipSize: true, brotliSize: true }) as Plugin),
    ],
    build: {
      // Production builds drop console.* and debugger statements. Dev keeps them.
      rolldownOptions: { output: { minify: { compress: { dropConsole: true, dropDebugger: true } } } },
    },
    server: { proxy: { '/api': apiTarget } },
  }
})
