import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { databasePool } from '../database.js'

if (!databasePool) throw new Error('SUPABASE_DB_URL is required to apply the database update.')

const sql = await readFile(join(process.cwd(), 'supabase', '002_security_hardening.sql'), 'utf8')
try {
  const client = await databasePool.connect()
  try {
    // The update is long-running DDL, so it runs without the pool's statement timeout.
    await client.query('set statement_timeout = 0')
    await client.query(sql)
  } finally {
    client.release()
  }
  console.log('Database update completed successfully.')
} finally {
  await databasePool.end()
}
