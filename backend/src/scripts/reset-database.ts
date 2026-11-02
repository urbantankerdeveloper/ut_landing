import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { databasePool } from '../database.js'
import { databaseResetRefusal } from '../lib/databaseGuards.js'

if (!databasePool) throw new Error('SUPABASE_DB_URL is required to reset the database.')
const refusal = databaseResetRefusal(process.env)
if (refusal) throw new Error(`Database reset refused. ${refusal}`)

const migrationPath = join(process.cwd(), 'supabase', '001_initial.sql')
const sql = await readFile(migrationPath, 'utf8')

try {
  const client = await databasePool.connect()
  try {
    // The canonical install is long-running DDL, so it runs without the pool's statement timeout.
    await client.query('set statement_timeout = 0')
    await client.query(sql)
  } finally {
    client.release()
  }
  console.log('Database reset and canonical install completed successfully.')
} finally {
  await databasePool.end()
}
