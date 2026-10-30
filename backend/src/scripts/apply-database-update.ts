import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { databasePool } from '../database.js'

if (!databasePool) throw new Error('SUPABASE_DB_URL is required to apply the database update.')

const sql = await readFile(join(process.cwd(), 'supabase', 'database-update.sql'), 'utf8')
try {
  await databasePool.query(sql)
  console.log('Database update completed successfully.')
} finally {
  await databasePool.end()
}
