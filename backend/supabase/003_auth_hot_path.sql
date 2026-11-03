-- Urban Tanker auth hot path: account email on profiles and an indexed username lookup for login.
-- Idempotent: safe to re-run. Runs as one transaction, like 002.
-- Order: run after 001_initial.sql and 002_security_hardening.sql. Apply with:
--   npm run db:update -- 003_auth_hot_path.sql
-- Then fill profiles.email for existing accounts with: npx tsx src/scripts/backfill-profile-emails.ts
--   Until that finishes, login falls back to auth.users for rows where profiles.email is null.
--
-- PREFLIGHT: none required. Adds one nullable column and one function. No existing rows are rewritten.
--   The lookup relies on the unique index profiles_username_lower_idx from 001. Confirm it exists (expect one row):
--   select indexname from pg_indexes where schemaname = 'public' and indexname = 'profiles_username_lower_idx';

begin;

-- ===== 1. Account email on profiles =====
-- Lowercased copy of auth.users.email, written by the API on every signup, account creation and email change.
-- Null for rows created before this migration until the backfill script runs.
alter table public.profiles add column if not exists email text;

-- ===== 2. Username lookup for login =====
-- Equality on lower(username), so the existing partial unique index on lower(username) is used.
-- The explicit "is not null" matches that index's predicate. At most one row is returned.
-- Only the service role may call it. The API never passes a pattern here.
create or replace function public.find_profile_by_username(p_username text)
returns table(id uuid, username text, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.username, p.email
  from public.profiles p
  where p.username is not null
    and lower(p.username) = lower(p_username)
  limit 1
$$;

revoke execute on function public.find_profile_by_username(text) from public, anon, authenticated;
grant execute on function public.find_profile_by_username(text) to service_role;

commit;
