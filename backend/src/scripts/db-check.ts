import { supabase } from '../supabase.js'
import { config } from '../config.js'

try {
  const { error } = await supabase.from('profiles').select('id').limit(1)

  if (error) {
    console.error(`Database connection/schema check failed: ${error.message}`)
    process.exit(1)
  }

  console.log('Database connected successfully.')
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Database connection failed for ${new URL(config.SUPABASE_URL).origin}: ${message}`)
  console.error('Check the Supabase project URL and DNS/network access.')
  process.exit(1)
}