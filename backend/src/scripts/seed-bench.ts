// Seeds the local benchmark database with synthetic data. Run with: npm run seed:bench
//
// Env:
//   SEED_DATABASE_URL   required. The database to write to. Only this URL is used.
//   SEED_SCALE          small | medium (default medium)
//   SEED_RANDOM         integer seed (default 42)
//   SEED_PASSWORD       password for every bench account (default bench-pass-123). Local benchmark only.
//   SEED_RESET          'true' truncates the application tables first (local host only)
//   SEED_ALLOW_REMOTE   'true' permits a non-local host. Never combined with SEED_RESET.
//
// Guards, in order: (a) non-local host needs SEED_ALLOW_REMOTE, (b) existing profiles need SEED_RESET,
// (c) SEED_RESET needs a local host. (c) runs before connecting because it needs no database.
//
// Does not import config.ts, database.ts or supabase.ts. Those load backend/.env.local, which holds a production URL.
//
// Prints row counts and export lines only. Emails, phone numbers and passwords are never printed.

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MANIFEST_ENV_KEYS, SCALES, generateSeedData, type ScaleName } from './seedBench/generate.js'
import { appDataExists, createSeedPool, loadSeedTables, truncateAppTables } from './seedBench/load.js'

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

class RefusedError extends Error {}

function refuse(message: string): never {
  throw new RefusedError(message)
}

async function main(): Promise<void> {
  const env = process.env
  const databaseUrl = env.SEED_DATABASE_URL?.trim()
  if (!databaseUrl) refuse('SEED_DATABASE_URL is required. Point it at the local PostgreSQL database.')

  let host: string
  try {
    host = new URL(databaseUrl).hostname
  } catch {
    refuse('SEED_DATABASE_URL is not a valid URL.')
  }
  const isLocal = LOCAL_HOSTS.has(host)

  const scaleName = (env.SEED_SCALE ?? 'medium').trim()
  if (scaleName !== 'small' && scaleName !== 'medium') refuse('SEED_SCALE must be small or medium.')
  const seedText = (env.SEED_RANDOM ?? '42').trim()
  if (!/^\d+$/.test(seedText) || Number(seedText) > 0xffffffff) refuse('SEED_RANDOM must be an integer from 0 to 4294967295.')
  const seed = Number(seedText)
  const password = env.SEED_PASSWORD && env.SEED_PASSWORD.length > 0 ? env.SEED_PASSWORD : 'bench-pass-123'
  const reset = env.SEED_RESET === 'true'
  const allowRemote = env.SEED_ALLOW_REMOTE === 'true'

  // Guard (a)
  if (!isLocal && !allowRemote) {
    refuse('Refusing to seed a non-local host. Only localhost, 127.0.0.1 and ::1 are allowed unless SEED_ALLOW_REMOTE=true.')
  }
  // Guard (c), evaluated before connecting
  if (reset && !isLocal) refuse('SEED_RESET=true is refused on a non-local host, even with SEED_ALLOW_REMOTE=true.')

  const pool = createSeedPool(databaseUrl)
  try {
    // Guard (b)
    if (!reset && (await appDataExists(pool))) {
      refuse('public.profiles already has rows. Re-run with SEED_RESET=true (local host only) to replace the application data.')
    }

    const data = generateSeedData({ seed, scale: SCALES[scaleName as ScaleName], now: new Date(), password })
    console.log(`Generated ${scaleName} seed ${seed}.`)

    if (reset) {
      const truncated = await truncateAppTables(pool)
      console.log(`Truncated ${truncated.length} application tables.`)
    }

    const written = await loadSeedTables(pool, data.tables)
    console.log('Rows written per table:')
    for (const { table, rows } of written) console.log(`  ${table}: ${rows}`)

    const here = dirname(fileURLToPath(import.meta.url))
    const seedDir = resolve(here, '..', '..', 'scripts', 'bench', '.seed')
    const manifestPath = resolve(seedDir, 'manifest.json')
    await mkdir(seedDir, { recursive: true })
    await writeFile(manifestPath, `${JSON.stringify(data.manifest, null, 2)}\n`, { mode: 0o600 })

    // Export lines read the values from the manifest, so no secret is printed here.
    const posixPath = manifestPath.replace(/\\/g, '/')
    console.log(`Manifest written: ${manifestPath}`)
    console.log('Export these before running npm run bench:')
    for (const key of MANIFEST_ENV_KEYS) {
      console.log(`export ${key}="$(node -p "require('${posixPath}').${key}")"`)
    }
  } finally {
    await pool.end()
  }
}

main().catch((error: unknown) => {
  if (error instanceof RefusedError) {
    console.error(error.message)
  } else {
    console.error(`Seed failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
  process.exitCode = 1
})
