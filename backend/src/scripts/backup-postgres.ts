import { mkdir, readdir, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { config as loadEnv } from 'dotenv'

loadEnv({ path: resolve(process.cwd(), '.env.local') })
loadEnv({ path: resolve(process.cwd(), '.env') })

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) throw new Error('SUPABASE_DB_URL is required to create a backup')

const backupDirectory = resolve(process.env.BACKUP_DIR ?? './backups/postgres')
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? 90)
if (!Number.isInteger(retentionDays) || retentionDays <= 0) throw new Error('BACKUP_RETENTION_DAYS must be a positive integer')

await mkdir(backupDirectory, { recursive: true })
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const outputPath = join(backupDirectory, `urban-tanker-${timestamp}.dump`)

await new Promise<void>((resolvePromise, reject) => {
  const child = spawn('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--file', outputPath, connectionString], {
    stdio: ['ignore', 'inherit', 'pipe'],
    windowsHide: true,
  })
  let errorOutput = ''
  child.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString() })
  child.on('error', (error) => reject(new Error(`Could not start pg_dump: ${error.message}`)))
  child.on('close', (code) => {
    if (code === 0) resolvePromise()
    else reject(new Error(`pg_dump failed with exit code ${code}: ${errorOutput.trim()}`))
  })
})

const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
const files = await readdir(backupDirectory, { withFileTypes: true })
let removed = 0
for (const file of files) {
  if (!file.isFile() || !/^urban-tanker-.*\.dump$/.test(file.name) || file.name === basename(outputPath)) continue
  const filePath = join(backupDirectory, file.name)
  const modifiedAt = await stat(filePath)
  if (modifiedAt.mtimeMs < cutoff) {
    await rm(filePath)
    removed += 1
  }
}

console.log(JSON.stringify({ event: 'database.backup.created', outputPath, removedExpiredBackups: removed }))
