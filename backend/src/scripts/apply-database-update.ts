import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { databasePool } from '../database.js'

if (!databasePool) throw new Error('SUPABASE_DB_URL is required to apply the database update.')

// Usage: npm run db:update -- [migration file name]. Defaults to 002_security_hardening.sql.
const migrationFile = process.argv[2] ?? '002_security_hardening.sql'
if (!/^[\w.-]+\.sql$/.test(migrationFile)) throw new Error('Migration file name must be a plain .sql file name in backend/supabase.')

const sql = await readFile(join(process.cwd(), 'supabase', migrationFile), 'utf8')
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
