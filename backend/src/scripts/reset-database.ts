import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { databasePool } from '../database.js'

if (!databasePool) throw new Error('SUPABASE_DB_URL is required to reset the database.')
if (process.env.CONFIRM_DATABASE_RESET !== 'URBAN_TANKER_RESET') {
  throw new Error('Database reset refused. Set CONFIRM_DATABASE_RESET=URBAN_TANKER_RESET explicitly.')
}

const migrationPath = join(process.cwd(), 'supabase', '001_initial.sql')
const sql = await readFile(migrationPath, 'utf8')

try {
  await databasePool.query(sql)
  console.log('Database reset and canonical install completed successfully.')
} finally {
  await databasePool.end()
}
