// Fills profiles.email from auth.users.email (lowercased) for rows where profiles.email is null.
//
// Usage, from backend/ with SUPABASE_DB_URL set (environment or .env):
//   npx tsx src/scripts/backfill-profile-emails.ts --dry-run   count the rows that would change, write nothing
//   npx tsx src/scripts/backfill-profile-emails.ts             backfill in batches of 500
//
// Run after supabase/003_auth_hot_path.sql. Safe to re-run: only rows with a null profiles.email are touched,
// and the update re-checks that. Auth users without an email are skipped and counted.
// Prints counts only, never emails or ids.

import { databasePool } from '../database.js'

const batchSize = 500
const pauseBetweenBatchesMs = 200

if (!databasePool) throw new Error('SUPABASE_DB_URL is required to backfill profile emails.')
const pool = databasePool
const dryRun = process.argv.includes('--dry-run')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

try {
  const counts = await pool.query<{ pending: string; without_auth_email: string }>(`
    select
      count(*) filter (where u.email is not null)::text as pending,
      count(*) filter (where u.email is null)::text as without_auth_email
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.email is null
  `)
  const pending = Number(counts.rows[0]?.pending ?? 0)
  const withoutAuthEmail = Number(counts.rows[0]?.without_auth_email ?? 0)

  if (dryRun) {
    console.log(`Dry run: ${pending} profile emails would be filled. ${withoutAuthEmail} profiles have no auth email and would be skipped.`)
  } else {
    let updated = 0
    let batches = 0
    for (;;) {
      if (batches > 0) await sleep(pauseBetweenBatchesMs)
      const result = await pool.query(`
        with batch as (
          select p.id, lower(u.email) as email
          from public.profiles p
          join auth.users u on u.id = p.id
          where p.email is null and u.email is not null
          order by p.id
          limit $1
        )
        update public.profiles p
        set email = batch.email
        from batch
        where p.id = batch.id and p.email is null
      `, [batchSize])
      if (!result.rowCount) break
      updated += result.rowCount
      batches += 1
    }
    console.log(`Backfill complete: ${updated} profile emails filled in ${batches} batches. ${withoutAuthEmail} profiles have no auth email and were skipped.`)
  }
} catch (error) {
  console.error(`Backfill failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
