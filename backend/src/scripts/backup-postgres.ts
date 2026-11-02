import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { config as loadEnv } from 'dotenv'
import { backupDestinationRefusal, plaintextBackupRefusal } from '../lib/databaseGuards.js'

loadEnv({ path: resolve(process.cwd(), '.env.local') })
loadEnv({ path: resolve(process.cwd(), '.env') })

// The connection string comes from the environment only. It is never passed on the command line, where other users can read it.
const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) throw new Error('SUPABASE_DB_URL is required to create a backup')

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
if (!process.env.BACKUP_DIR) throw new Error('BACKUP_DIR is required. Point it at a directory outside the repository.')
const backupDirectory = resolve(process.env.BACKUP_DIR)
const destinationRefusal = backupDestinationRefusal(backupDirectory, repositoryRoot)
if (destinationRefusal) throw new Error(destinationRefusal)

const ageRecipient = process.env.BACKUP_AGE_RECIPIENT?.trim() || undefined
const plaintextRefusal = plaintextBackupRefusal({ nodeEnv: process.env.NODE_ENV, ageRecipient, allowPlaintext: process.env.ALLOW_PLAINTEXT_BACKUP === 'true' })
if (plaintextRefusal) throw new Error(plaintextRefusal)

const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 90)
if (!Number.isInteger(retentionDays) || retentionDays <= 0) throw new Error('BACKUP_RETENTION_DAYS must be a positive integer')

await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const outputPath = join(backupDirectory, `urban-tanker-${timestamp}.dump${ageRecipient ? '.age' : ''}`)

// Only the public schema is dumped. The Supabase-managed auth schema (password hashes and sessions) and storage metadata are not included.
// Restoring needs a project that already has auth.users, because public tables reference it.
const dumpArguments = ['--format=custom', '--no-owner', '--no-privileges', '--schema=public']

function waitForExit(child: ChildProcess, name: string) {
  let errorOutput = ''
  child.stderr?.on('data', (chunk: Buffer) => { errorOutput = `${errorOutput}${chunk.toString()}`.slice(-2_000) })
  return new Promise<void>((resolvePromise, reject) => {
    child.on('error', (error) => reject(new Error(`Could not start ${name}: ${error.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${name} failed with exit code ${code}: ${errorOutput.trim()}`))
    })
  })
}

// pg_dump reads the connection string from PGDATABASE, which libpq accepts as a URI.
const dump = spawn('pg_dump', dumpArguments, {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
  env: { ...process.env, PGDATABASE: connectionString },
})
const encryptor = ageRecipient
  ? spawn('age', ['--encrypt', '--recipient', ageRecipient, '--output', outputPath], { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true })
  : null

try {
  if (encryptor) {
    await Promise.all([pipeline(dump.stdout, encryptor.stdin!), waitForExit(dump, 'pg_dump'), waitForExit(encryptor, 'age')])
  } else {
    await Promise.all([pipeline(dump.stdout, createWriteStream(outputPath, { mode: 0o600 })), waitForExit(dump, 'pg_dump')])
  }
} catch (error) {
  dump.kill()
  encryptor?.kill()
  await rm(outputPath, { force: true })
  throw error
}

const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
const files = await readdir(backupDirectory, { withFileTypes: true })
let removed = 0
for (const file of files) {
  if (!file.isFile() || !/^urban-tanker-.*\.dump(\.age)?$/.test(file.name) || join(backupDirectory, file.name) === outputPath) continue
  const filePath = join(backupDirectory, file.name)
  const modifiedAt = await stat(filePath)
  if (modifiedAt.mtimeMs < cutoff) {
    await rm(filePath)
    removed += 1
  }
}

console.log(JSON.stringify({
  event: 'database.backup.created',
  outputPath,
  encrypted: Boolean(ageRecipient),
  schemasIncluded: ['public'],
  schemasExcluded: ['auth', 'storage', 'other Supabase-managed schemas'],
  removedExpiredBackups: removed,
}))
