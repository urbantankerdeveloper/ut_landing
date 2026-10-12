import { supabase } from '../supabase.js'
import { config } from '../config.js'
import { checkDatabaseConnection } from '../database.js'

try {
  if (await checkDatabaseConnection()) {
    console.log('Database connected successfully via Supabase PostgreSQL.')
    process.exit(0)
  }
  const { error } = await supabase.from('profiles').select('id').limit(1)

  if (error) {
    console.error(`Database connection/schema check failed: ${error.message}`)
    process.exit(1)
  }

  console.log('Database connected successfully.')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  const target = config.SUPABASE_DB_URL ? 'SUPABASE_DB_URL' : new URL(config.SUPABASE_URL).origin
  console.error(`Database connection failed for ${target}: ${message}`)
  console.error(config.SUPABASE_DB_URL ? 'Copy a fresh PostgreSQL connection string from Supabase Connect > Transaction pooler.' : 'Check the Supabase project URL and DNS/network access.')
  process.exit(1)
}