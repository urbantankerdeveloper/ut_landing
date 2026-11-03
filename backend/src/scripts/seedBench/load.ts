// Loads generated seed rows into the database named by SEED_DATABASE_URL.
//
// Only the pool built here writes to the database. This module does not import config.ts, database.ts or
// supabase.ts, because those load backend/.env.local.
//
// Rows go in as chunked multi-row VALUES lists of at most CHUNK_ROWS rows. Each table is written in one transaction.
// Errors are reported without row values, so no phone number, email or password reaches the console.

import pg from 'pg'
import { RESET_TABLES, SEED_TABLE_ORDER, TABLE_COLUMNS, type ColumnSpec, type Row, type SeedTable, type SeedTables } from './generate.js'

const CHUNK_ROWS = 1000

// Rows that may already exist (catalog and config rows from the migrations, or auth users kept across a reset) are
// updated in place instead of failing.
const CONFLICT: Partial<Record<SeedTable, { target: string; update: readonly string[] }>> = {
  'auth.users': {
    target: 'id',
    update: ['email', 'encrypted_password', 'phone', 'raw_user_meta_data', 'raw_app_meta_data', 'aud', 'role', 'updated_at'],
  },
  service_catalog: { target: 'code', update: ['name', 'description', 'base_price_paise', 'is_active', 'config'] },
  coupons: { target: 'code', update: ['title', 'discount_type', 'discount_value', 'valid_until', 'is_active'] },
  configs: { target: 'key', update: ['value', 'updated_at'] },
}

export function createSeedPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({ connectionString, max: 2 })
  pool.on('error', (error: Error & { code?: string }) => {
    console.error(`database connection error${error.code ? ` (${error.code})` : ''}`)
  })
  return pool
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

// 'auth.users' becomes "auth"."users". Bare names live in public.
function qualify(table: string): string {
  const [schema, name] = table.includes('.') ? table.split('.') : ['public', table]
  return `${quoteIdent(schema ?? 'public')}.${quoteIdent(name ?? table)}`
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown error'
  const details = error as Error & { code?: string; table?: string; constraint?: string }
  return [details.code, details.table, details.constraint, details.message].filter(Boolean).join(' | ')
}

// True when public.profiles already holds rows. Seeding over real rows is refused unless SEED_RESET is set.
export async function appDataExists(pool: pg.Pool): Promise<boolean> {
  const { rows } = await pool.query<{ present: boolean }>('select exists (select 1 from public.profiles) as present')
  return rows[0]?.present === true
}

// Truncates the RESET_TABLES that exist. No CASCADE, so an unexpected dependent table fails the reset instead of
// being wiped silently. The auth schema is never touched.
export async function truncateAppTables(pool: pg.Pool): Promise<string[]> {
  const { rows } = await pool.query<{ tablename: string }>(
    'select tablename from pg_tables where schemaname = $1 and tablename = any($2::text[])',
    ['public', [...RESET_TABLES]],
  )
  const existing = rows.map((row) => row.tablename).sort()
  if (existing.length === 0) return []
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`truncate table ${existing.map((name) => qualify(name)).join(', ')}`)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw new Error(`truncate failed: ${describeError(error)}`)
  } finally {
    client.release()
  }
  return existing
}

// One VALUES tuple per row, with each placeholder cast to its column type. jsonb values are serialized here.
function buildInsert(table: string, columns: readonly ColumnSpec[], rows: Row[], conflict: { target: string; update: readonly string[] } | undefined) {
  const params: unknown[] = []
  const tuples = rows.map((row) => {
    const placeholders = columns.map(([name, type]) => {
      const raw = row[name]
      const value = raw === undefined || raw === null ? null : type === 'jsonb' ? JSON.stringify(raw) : raw
      params.push(value)
      return `$${params.length}::${type}`
    })
    return `(${placeholders.join(', ')})`
  })
  const columnList = columns.map(([name]) => quoteIdent(name)).join(', ')
  const onConflict = conflict
    ? ` on conflict (${quoteIdent(conflict.target)}) do update set ${conflict.update.map((name) => `${quoteIdent(name)} = excluded.${quoteIdent(name)}`).join(', ')}`
    : ''
  return { text: `insert into ${qualify(table)} (${columnList}) values ${tuples.join(', ')}${onConflict}`, params }
}

async function insertTable(pool: pg.Pool, table: SeedTable, rows: Row[]): Promise<number> {
  const columns = TABLE_COLUMNS[table]
  const conflict = CONFLICT[table]
  const client = await pool.connect()
  try {
    await client.query('begin')
    for (let start = 0; start < rows.length; start += CHUNK_ROWS) {
      const chunk = rows.slice(start, start + CHUNK_ROWS)
      const statement = buildInsert(table, columns, chunk, conflict)
      await client.query(statement.text, statement.params)
    }
    await client.query('commit')
    return rows.length
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw new Error(`${table}: ${describeError(error)}`)
  } finally {
    client.release()
  }
}

// Membership plans have no unique key, so a plan whose name already exists is skipped instead of duplicated.
async function plansToInsert(pool: pg.Pool, rows: Row[]): Promise<Row[]> {
  const { rows: existing } = await pool.query<{ name: string }>('select name from public.membership_plans')
  const names = new Set(existing.map((row) => row.name))
  return rows.filter((row) => !names.has(String(row.name)))
}

// Loads every table in SEED_TABLE_ORDER. Returns the row count written per table.
export async function loadSeedTables(pool: pg.Pool, tables: SeedTables): Promise<Array<{ table: string; rows: number }>> {
  const written: Array<{ table: string; rows: number }> = []
  for (const table of SEED_TABLE_ORDER) {
    const rows = table === 'membership_plans' ? await plansToInsert(pool, tables[table]) : tables[table]
    if (rows.length === 0) {
      written.push({ table, rows: 0 })
      continue
    }
    const count = await insertTable(pool, table, rows)
    written.push({ table, rows: count })
  }
  return written
}
