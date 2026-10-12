import { Pool } from 'pg'
import { config } from './config.js'

export const databasePool = config.SUPABASE_DB_URL
  ? new Pool({
      connectionString: config.SUPABASE_DB_URL,
      max: config.DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: { rejectUnauthorized: false },
    })
  : null

export async function checkDatabaseConnection() {
  if (!databasePool) return false
  await databasePool.query('select 1')
  return true
}