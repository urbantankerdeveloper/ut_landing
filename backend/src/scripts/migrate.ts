import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { databasePool } from '../database.js'

if (!databasePool) throw new Error('SUPABASE_DB_URL is required to apply migrations.')

const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '../../supabase')
const migrationFiles = (await readdir(migrationDirectory)).filter((file) => /^\d+_.*\.sql$/.test(file)).sort()

await databasePool.query('create table if not exists public._ut_schema_migrations (name text primary key, applied_at timestamptz not null default now())')

async function baselineIfPresent(name: string, sql: string) {
  const result = await databasePool!.query<{ present: boolean }>(sql)
  if (result.rows[0]?.present) {
    await databasePool!.query('insert into public._ut_schema_migrations(name) values($1) on conflict (name) do nothing', [name])
    console.log(`Baselined ${name} (schema objects already exist).`)
  }
}

await baselineIfPresent('001_initial.sql', "select to_regclass('public.profiles') is not null and to_regclass('public.bookings') is not null and exists(select 1 from pg_type where typname = 'user_role') as present")
await baselineIfPresent('002_operations.sql', "select to_regclass('public.vendor_location_updates') is not null and to_regclass('public.documents') is not null as present")
await baselineIfPresent('004_payouts.sql', "select to_regclass('public.vendor_payouts') is not null as present")
await baselineIfPresent('005_booking_lifecycle.sql', "select to_regprocedure('public.transition_booking(uuid,uuid,public.booking_status,uuid,uuid,uuid)') is not null as present")

for (const file of migrationFiles) {
  const applied = await databasePool.query('select 1 from public._ut_schema_migrations where name = $1', [file])
  if (applied.rowCount) {
    console.log(`Skipped ${file} (already applied).`)
    continue
  }
  const client = await databasePool.connect()
  try {
    await client.query('begin')
    await client.query(await readFile(join(migrationDirectory, file), 'utf8'))
    await client.query('insert into public._ut_schema_migrations(name) values($1)', [file])
    await client.query('commit')
    console.log(`Applied ${file}.`)
  } catch (error) {
    await client.query('rollback')
    throw new Error(`Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    client.release()
  }
}

await databasePool.end()
console.log('Database migrations completed successfully.')