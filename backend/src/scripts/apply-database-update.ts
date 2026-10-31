import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { databasePool } from '../database.js'

if (!databasePool) throw new Error('SUPABASE_DB_URL is required to apply the database update.')

const schema = await readFile(join(process.cwd(), 'supabase', '001_initial.sql'), 'utf8')
const begin = '-- BEGIN incremental update'
const end = '-- END incremental update'
const start = schema.indexOf(begin)
const finish = schema.lastIndexOf(end)
if (start === -1 || finish === -1 || finish < start) throw new Error('Incremental update block not found in supabase/001_initial.sql')
const sql = schema.slice(start, finish + end.length)
try {
  await databasePool.query(sql)
  console.log('Database update completed successfully.')
} finally {
  await databasePool.end()
}
