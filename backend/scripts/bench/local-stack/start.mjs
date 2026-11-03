// Starts the local benchmark stack on Windows: PostgreSQL 17 (port 55432), PostgREST (3001) and the local gateway (54321).
// Usage (from backend/): node scripts/bench/local-stack/start.mjs
// The first run initialises the cluster and applies backend/supabase/001-003 with the Supabase shim.
// Writes .stack/env.json with the URLs and the service-role key that the backend and the seed script need. Never commit .stack/.
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, openSync } from 'node:fs'
import fs from 'node:fs/promises'
import net from 'node:net'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SignJWT } from 'jose'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const backendDir = resolve(here, '../../..')
const binDir = resolve(here, '.bin')
const stackDir = resolve(here, '.stack')
const pgPort = Number(process.env.BENCH_PG_PORT ?? 55432)
const restPort = 3001
const gatewayPort = Number(process.env.GATEWAY_PORT ?? 54321)
const dbName = 'urban_bench'
const jwtSecret = process.env.BENCH_JWT_SECRET ?? 'bench-local-jwt-secret-0123456789abcdef'

async function findExecutable(name) {
  const queue = [binDir]
  while (queue.length > 0) {
    const current = queue.shift()
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) queue.push(full)
      else if (entry.name.toLowerCase() === name) return full
    }
  }
  throw new Error(`${name} not found under ${binDir}. Run: node scripts/bench/local-stack/fetch-binaries.mjs`)
}

function portOpen(port) {
  return new Promise((resolvePort) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => { socket.destroy(); resolvePort(true) })
    socket.once('error', () => resolvePort(false))
  })
}

async function waitForPort(port, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (!(await portOpen(port))) {
    if (Date.now() > deadline) throw new Error(`port ${port} did not open; see .stack/*.log`)
    await new Promise((done) => setTimeout(done, 500))
  }
}

// Detached so the services survive this script. Output goes to .stack/<name>.log.
function startService(name, command, args, env = {}) {
  const log = openSync(resolve(stackDir, `${name}.log`), 'a')
  const child = spawn(command, args, { detached: true, stdio: ['ignore', log, log], windowsHide: true, env: { ...process.env, ...env } })
  child.unref()
  return child.pid
}

// Connects with retries, because the port can open before PostgreSQL accepts connections.
async function connectWithRetry(client, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      await client.connect()
      return client
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((done) => setTimeout(done, 500))
    }
  }
}

await fs.mkdir(stackDir, { recursive: true })
const pidFile = resolve(stackDir, 'pids.json')
const pids = existsSync(pidFile) ? JSON.parse(await fs.readFile(pidFile, 'utf8')) : {}
const dataDir = resolve(stackDir, 'pgdata')

if (!existsSync(join(dataDir, 'PG_VERSION'))) {
  console.log('Initialising PostgreSQL cluster (first run)')
  execFileSync(await findExecutable('initdb.exe'), ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--no-instructions'], { stdio: 'ignore' })
}

const pgBinary = await findExecutable('postgres.exe')
if (!(await portOpen(pgPort))) {
  pids.postgres = startService('postgres', pgBinary, ['-D', dataDir, '-p', String(pgPort), '-h', '127.0.0.1', '-c', 'max_connections=200', '-c', 'shared_buffers=256MB', '-c', 'work_mem=16MB'])
  await fs.writeFile(pidFile, JSON.stringify(pids, null, 2))
  await waitForPort(pgPort)
}

const admin = new pg.Client({ connectionString: `postgres://postgres@127.0.0.1:${pgPort}/postgres` })
await connectWithRetry(admin)
if ((await admin.query('select 1 from pg_database where datname = $1', [dbName])).rowCount === 0) {
  await admin.query(`create database ${dbName}`)
}
await admin.end()

const db = new pg.Client({ connectionString: `postgres://postgres@127.0.0.1:${pgPort}/${dbName}` })
await connectWithRetry(db)
const ready = (await db.query("select to_regclass('public.profiles') is not null as ready")).rows[0].ready
if (!ready) {
  console.log('Applying shim and migrations 001, 002, 003')
  await db.query(await fs.readFile(resolve(here, 'shim.sql'), 'utf8'))
  for (const file of ['001_initial.sql', '002_security_hardening.sql', '003_auth_hot_path.sql']) {
    await db.query(await fs.readFile(resolve(backendDir, 'supabase', file), 'utf8'))
  }
  await db.query('grant usage on schema public, auth to service_role')
  await db.query('grant all on all tables in schema public to service_role')
  await db.query('grant all on all sequences in schema public to service_role')
  await db.query('alter default privileges in schema public grant all on tables to service_role')
  await db.query('alter default privileges in schema public grant all on sequences to service_role')
}
await db.end()

const serviceKey = await new SignJWT({ role: 'service_role', iss: 'urban-tanker-bench' })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('30d')
  .sign(new TextEncoder().encode(jwtSecret))

if (!(await portOpen(restPort))) {
  // PostgREST loads libpq.dll from the PostgreSQL bin folder.
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
  pids.postgrest = startService('postgrest', await findExecutable('postgrest.exe'), [], {
    [pathKey]: `${dirname(pgBinary)};${process.env[pathKey] ?? ''}`,
    PGRST_DB_URI: `postgres://authenticator:authenticator@127.0.0.1:${pgPort}/${dbName}`,
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: jwtSecret,
    PGRST_SERVER_PORT: String(restPort),
    PGRST_DB_POOL: '30',
  })
  await fs.writeFile(pidFile, JSON.stringify(pids, null, 2))
  await waitForPort(restPort)
}

if (!(await portOpen(gatewayPort))) {
  pids.gateway = startService('gateway', process.execPath, [resolve(here, 'gateway.mjs')], {
    GATEWAY_PORT: String(gatewayPort),
    POSTGREST_URL: `http://127.0.0.1:${restPort}`,
    BENCH_DATABASE_URL: `postgres://postgres@127.0.0.1:${pgPort}/${dbName}`,
  })
  await fs.writeFile(pidFile, JSON.stringify(pids, null, 2))
  await waitForPort(gatewayPort)
}

await fs.writeFile(pidFile, JSON.stringify(pids, null, 2))
const databaseUrl = `postgres://postgres@127.0.0.1:${pgPort}/${dbName}`
const env = {
  SUPABASE_URL: `http://127.0.0.1:${gatewayPort}`,
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
  SUPABASE_DB_URL: databaseUrl,
  SEED_DATABASE_URL: databaseUrl,
}
await fs.writeFile(resolve(stackDir, 'env.json'), JSON.stringify(env, null, 2))
console.log(JSON.stringify({ event: 'local_stack.ready', supabaseUrl: env.SUPABASE_URL, databasePort: pgPort, restPort, envFile: '.stack/env.json' }))
