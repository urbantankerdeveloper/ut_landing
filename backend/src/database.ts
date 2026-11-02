import { Pool } from 'pg'
import { config } from './config.js'

export const databasePool = config.SUPABASE_DB_URL
  ? new Pool({
      connectionString: config.SUPABASE_DB_URL,
      max: config.DB_POOL_MAX,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 15_000,
      ssl: config.DB_SSL_CA ? { ca: config.DB_SSL_CA, rejectUnauthorized: true } : { rejectUnauthorized: false },
    })
  : null

// An idle client that loses its connection emits 'error'. Without a listener the process would crash.
databasePool?.on('error', (error) => {
  console.error(JSON.stringify({ event: 'database.pool_error', error: error.message }))
})

export async function checkDatabaseConnection() {
  if (!databasePool) return false
  await databasePool.query('select 1')
  return true
}