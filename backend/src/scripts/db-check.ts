import { supabase } from '../supabase.js'
import { config } from '../config.js'
import { checkDatabaseConnection } from '../database.js'
import { logger } from '../lib/logger.js'

try {
  if (await checkDatabaseConnection()) {
    logger.success('database.connected', { via: 'postgres' })
    process.exit(0)
  }
  const { error } = await supabase.from('profiles').select('id').limit(1)

  if (error) {
    logger.error('database.check_failed', { error: error.message })
    process.exit(1)
  }

  logger.success('database.connected', { via: 'supabase-api' })
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const target = config.SUPABASE_DB_URL ? 'SUPABASE_DB_URL' : new URL(config.SUPABASE_URL).origin
  logger.error('database.connection_failed', { target, error: message })
  logger.info('database.hint', { hint: config.SUPABASE_DB_URL ? 'Copy a fresh PostgreSQL connection string from Supabase Connect > Transaction pooler.' : 'Check the Supabase project URL and DNS/network access.' })
  process.exit(1)
}
