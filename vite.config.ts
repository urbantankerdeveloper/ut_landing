import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants as zlibConstants, brotliCompressSync, gzipSync } from 'node:zlib'
import { visualizer } from 'rollup-plugin-visualizer'
import { defineConfig, type Plugin } from 'vite'

function backendPort() {
  if (process.env.PORT) return process.env.PORT
  for (const name of ['.env.local', '.env']) {
    try {
      const match = readFileSync(fileURLToPath(new URL(`./backend/${name}`, import.meta.url)), 'utf8').match(/^\s*PORT\s*=\s*"?(\d+)"?\s*$/m)
      if (match) return match[1]
    } catch {
      // Optional file.
    }
  }
  return '8080'
}

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
      const source = template
        .replace('const SHELL_URLS = []', () => `const SHELL_URLS = ${JSON.stringify(shellUrls)}`)
        .replace("const BUILD_ID = 'development'", () => `const BUILD_ID = '${buildId}'`)
      writeFileSync(resolve(outDir, 'service-worker.js'), source)
    },
  }
}

function precompressedAssets(): Plugin {
  let outDir = ''
  return {
    name: 'urban-tanker-precompressed-assets',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const visit = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          const path = resolve(directory, entry.name)
          if (entry.isDirectory()) {
            visit(path)
          } else if (/\.(?:js|css|svg|html|json|txt|xml|webmanifest)$/.test(entry.name)) {
            const source = readFileSync(path)
            writeFileSync(`${path}.br`, brotliCompressSync(source, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }))
            writeFileSync(`${path}.gz`, gzipSync(source, { level: 9 }))
          }
        }
      }
      visit(outDir)
    },
  }
}

export default defineConfig(({ mode }) => {
  const apiTarget = `http://localhost:${backendPort()}`
  return {
    plugins: [
      react(),
      serviceWorkerShell(),
      precompressedAssets(),
      mode === 'analyze'
        ? visualizer({ filename: 'stats/bundle.html', template: 'treemap', gzipSize: true, brotliSize: true }) as Plugin
        : false,
    ],
    build: {
      rolldownOptions: {
        output: {
          manualChunks(moduleId) {
            if (/node_modules\/(?:react|react-dom)\//.test(moduleId)) return 'react'
            if (moduleId.includes('/node_modules/react-router/')) return 'router'
            if (moduleId.includes('/node_modules/@tanstack/react-query/')) return 'query'
            if (
              moduleId.includes('/node_modules/socket.io-client/')
              || moduleId.includes('/node_modules/socket.io-parser/')
              || moduleId.includes('/node_modules/engine.io-client/')
            ) return 'realtime'
            return undefined
          },
          minify: { compress: { dropConsole: true, dropDebugger: true } },
        },
      },
    },
    server: { proxy: { '/api': apiTarget } },
  }
})
