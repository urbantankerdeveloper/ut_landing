// Downloads PostgreSQL and PostgREST Windows builds into scripts/bench/local-stack/.bin (git-ignored).
// Usage (from backend/): node scripts/bench/local-stack/fetch-binaries.mjs
// Windows only. On Linux or macOS install postgresql-17 and postgrest from your package manager and point
// PATH at them; start.mjs looks for postgres.exe and postgrest.exe by name, so adjust the names there if needed.
import { execFileSync } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'

if (process.platform !== 'win32') {
  console.error('This script fetches Windows builds. See the README for Linux and macOS.')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const binDir = resolve(here, '.bin')
const sources = [
  { name: 'PostgreSQL 17.6', url: 'https://get.enterprisedb.com/postgresql/postgresql-17.6-1-windows-x64-binaries.zip', folder: 'pg' },
  { name: 'PostgREST 16.5', url: 'https://github.com/PostgREST/postgrest/releases/download/v16.5/postgrest-v16.5-windows-x86-64.zip', folder: 'postgrest' },
]

await fs.mkdir(binDir, { recursive: true })
for (const source of sources) {
  const target = resolve(binDir, source.folder)
  if (existsSync(target)) {
    console.log(`${source.name}: already present in ${source.folder}`)
    continue
  }
  const archive = resolve(binDir, `${source.folder}.zip`)
  console.log(`Downloading ${source.name}`)
  const response = await fetch(source.url, { redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`${source.name}: HTTP ${response.status}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${target}' -Force`], { stdio: 'inherit' })
  await fs.rm(archive)
  console.log(`${source.name}: extracted`)
}
