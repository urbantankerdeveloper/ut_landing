-- Urban Tanker security and integrity hardening for existing databases.
-- Idempotent: safe to re-run. Runs as one transaction.
-- Order: on a fresh or reset database run 001_initial.sql first, then this file.
--
-- PREFLIGHT: run every PREFLIGHT query below before applying this file. Each must return zero rows,
-- or the stated expectation. Resolve any hits first. A unique-index violation aborts the whole transaction.
--
-- NOT VALID constraints are enforced for new and updated rows only. Existing rows are checked later
-- with the VALIDATE statements at the end of this file (commented out). Run those after cleanup.

-- PREFLIGHT 1 (C-03, H-01, M-25, M-26): none required. Backend is the only consumer.
--   Confirm every .from( and .rpc( in backend/src uses the service client from src/supabase.ts.
-- PREFLIGHT 2 (H-04): expect only these values.
--   select verification, count(*) from public.documents group by 1;
--   Informational: approved or rejected rows with no reviewer stay unvalidated until backfilled.
--   select count(*) from public.documents where verification in ('approved', 'rejected') and reviewed_by is null;
-- PREFLIGHT 3 (H-10): must return zero rows.
--   select vendor_id, period_start, period_end, count(*) from public.vendor_payouts
--   where period_start is not null and period_end is not null
--   group by vendor_id, period_start, period_end having count(*) > 1;
-- PREFLIGHT 4 (H-11): expect only the allowed values.
--   select status, count(*) from public.customer_memberships group by 1;
--   select status, count(*) from public.subscriptions group by 1;
-- PREFLIGHT 5 (wallet status check): expect only 'pending', 'completed', 'failed'.
--   select status, count(*) from public.wallet_transactions group by 1;
-- PREFLIGHT 6 (H-14 backfill): must return zero rows, or the +91 backfill violates UNIQUE(phone_e164).
--   select a.id, a.phone_e164 from public.profiles a
--   join public.profiles b on b.phone_e164 = '+91' || a.phone_e164
--   where a.phone_e164 ~ '^[6-9][0-9]{9}$';
-- PREFLIGHT 7 (H-14, informational): rows that stay non-E.164 after the backfill (vendors, drivers and
--   partner_applications phones are not normalized here).
--   select id, phone_e164 from public.profiles where phone_e164 is not null and phone_e164 !~ '^\+91[6-9][0-9]{9}$';
-- PREFLIGHT 8 (H-14): none needed on first apply. phone_verified_at is new, so it is null for every row,
--   and UNIQUE(profiles.phone_e164) from 001 already prevents duplicate phones.
-- PREFLIGHT 9 (M-10, informational): storage objects whose MIME type falls outside the new allowlist.
--   Bucket limits do not rewrite existing objects.
--   select bucket_id, metadata->>'mimetype' as mime, count(*) from storage.objects group by 1, 2;
-- PREFLIGHT 10 (indexes): the CREATE INDEX statements below run inside a transaction and lock writes while
--   they build. On large tables, run them in a maintenance window, or build with CREATE INDEX CONCURRENTLY
--   outside this transaction.

begin;

-- ===== 1. Client roles: no direct reads or writes of bookings, no client notification updates (H-01, M-26) =====

drop policy if exists "customer own bookings" on public.bookings;
drop policy if exists "customers can create own bookings" on public.bookings;
drop policy if exists "customers can read own bookings" on public.bookings;
drop policy if exists "customers can update own bookings" on public.bookings;
revoke insert, update, delete, select on public.bookings from anon, authenticated;

drop policy if exists "users can mark own notifications read" on public.notifications;
revoke update on public.notifications from authenticated, anon;

-- Defense in depth: clients never write to public tables. Every write goes through service_role.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

-- ===== 2. Owner FOR ALL policies: remove. Backend (service_role) is the only writer (M-25) =====
-- Read-only owner policies are not needed because the backend is the only consumer.

do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and cmd = 'ALL'
      and tablename in (
        'vehicles', 'drivers', 'customer_contracts', 'customer_memberships', 'subscriptions',
        'saved_addresses', 'notification_preferences', 'push_subscriptions', 'offline_mutations',
        'vendor_service_availability'
      )
  loop
    execute format('drop policy if exists %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  end loop;
end $$;

-- ===== 3. Documents: verification states and reviewer accountability (H-04) =====

alter table public.documents
  add column if not exists reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'documents_verification_check' and conrelid = 'public.documents'::regclass) then
    alter table public.documents
      add constraint documents_verification_check
      check (verification in ('pending', 'submitted', 'approved', 'rejected')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documents_review_requires_reviewer_check' and conrelid = 'public.documents'::regclass) then
    alter table public.documents
      add constraint documents_review_requires_reviewer_check
      check (verification not in ('approved', 'rejected') or reviewed_by is not null) not valid;
  end if;
end $$;

-- ===== 4. Vendor payouts: one payout per vendor per period, and atomic settlement (H-10) =====

alter table public.bookings
  add column if not exists settled_payout_id uuid references public.vendor_payouts(id);

-- PREFLIGHT 3 above must return zero rows before this index is created.
create unique index if not exists vendor_payouts_vendor_period_unique_idx
  on public.vendor_payouts (vendor_id, period_start, period_end)
  where period_start is not null and period_end is not null;

-- Settles a batch of payouts in one transaction. Each element:
--   {"vendor_id": uuid, "period_start": "YYYY-MM-DD", "period_end": "YYYY-MM-DD",
--    "amount_paise": integer, "booking_ids": [uuid, ...]}
-- amount is stored in rupees (amount_paise / 100), matching the admin settle route.
-- Raises if any booking is not 'delivered', belongs to another vendor, or is already settled.
create or replace function public.record_vendor_payouts(p_payouts jsonb)
returns setof public.vendor_payouts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_element jsonb;
  v_vendor_id uuid;
  v_period_start date;
  v_period_end date;
  v_booking_ids uuid[];
  v_matched integer;
  v_row public.vendor_payouts;
begin
  if p_payouts is null or jsonb_typeof(p_payouts) <> 'array' or jsonb_array_length(p_payouts) = 0 then
    raise exception 'PAYOUTS_REQUIRED';
  end if;

  -- Lock every listed booking up front, in id order, so concurrent settlement runs serialize.
  perform 1
  from public.bookings b
  where b.id in (
    select distinct (x.booking_id)::uuid
    from jsonb_array_elements(p_payouts) as e(item)
    cross join lateral jsonb_array_elements_text(coalesce(e.item->'booking_ids', '[]'::jsonb)) as x(booking_id)
  )
  order by b.id
  for update;

  for v_element in
    select e.item from jsonb_array_elements(p_payouts) as e(item)
  loop
    v_vendor_id := (v_element->>'vendor_id')::uuid;
    v_period_start := (v_element->>'period_start')::date;
    v_period_end := (v_element->>'period_end')::date;
    v_booking_ids := array(
      select distinct (x.booking_id)::uuid
      from jsonb_array_elements_text(coalesce(v_element->'booking_ids', '[]'::jsonb)) as x(booking_id)
    );

    if v_vendor_id is null or v_period_start is null or v_period_end is null
      or cardinality(v_booking_ids) = 0
      or (v_element->>'amount_paise') is null or (v_element->>'amount_paise')::numeric < 0 then
      raise exception 'PAYOUT_INVALID';
    end if;

    select count(*) into v_matched
    from public.bookings b
    where b.id = any(v_booking_ids)
      and b.status = 'delivered'
      and b.vendor_id = v_vendor_id
      and b.settled_payout_id is null;

    if v_matched <> cardinality(v_booking_ids) then
      raise exception 'PAYOUT_BOOKING_INVALID';
    end if;

    insert into public.vendor_payouts (vendor_id, amount, period_start, period_end)
    values (v_vendor_id, round((v_element->>'amount_paise')::numeric / 100, 2), v_period_start, v_period_end)
    returning * into v_row;

    update public.bookings
    set settled_payout_id = v_row.id
    where id = any(v_booking_ids);

    return next v_row;
  end loop;

  return;
end;
$$;

revoke all on function public.record_vendor_payouts(jsonb) from public, anon, authenticated;
grant execute on function public.record_vendor_payouts(jsonb) to service_role;

-- ===== 5. Status checks (H-11) =====

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'customer_memberships_status_check' and conrelid = 'public.customer_memberships'::regclass) then
    alter table public.customer_memberships
      add constraint customer_memberships_status_check
      check (status in ('requested', 'under_review', 'active', 'paused', 'cancelled')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_status_check' and conrelid = 'public.subscriptions'::regclass) then
    alter table public.subscriptions
      add constraint subscriptions_status_check
      check (status in ('requested', 'active', 'paused', 'cancelled')) not valid;
  end if;
end $$;

-- ===== 6. OTP attempt counters (H-12) =====

alter table public.bookings
  add column if not exists delivery_otp_attempts integer not null default 0
  check (delivery_otp_attempts between 0 and 100);

-- Atomic guest OTP attempt. Returns the stored hash only while the challenge is open, unverified,
-- unexpired, and under 5 attempts. An empty result means invalid, expired, or exhausted.
-- The caller compares the hash and must not reveal which condition failed.
create or replace function public.consume_guest_otp_attempt(p_challenge_id uuid, p_phone text)
returns table(otp_hash text)
language sql
set search_path = public
as $$
  update public.guest_otp_challenges
  set attempts = attempts + 1
  where id = p_challenge_id
    and phone_e164 = p_phone
    and verified_at is null
    and attempts < 5
    and expires_at > now()
  returning guest_otp_challenges.otp_hash;
$$;

revoke all on function public.consume_guest_otp_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_guest_otp_attempt(uuid, text) to service_role;

-- ===== 7. Phone identity (H-14) =====

alter table public.profiles
  add column if not exists phone_verified_at timestamptz;

-- PREFLIGHT 8 above applies. Only verified phones are unique here. UNIQUE(phone_e164) from 001 already applies to all rows.
create unique index if not exists profiles_phone_verified_unique_idx
  on public.profiles (phone_e164)
  where phone_verified_at is not null;

-- Backfill legacy 10-digit Indian mobiles to E.164. PREFLIGHT 6 must return zero rows first.
update public.profiles
set phone_e164 = '+91' || phone_e164
where phone_e164 ~ '^[6-9][0-9]{9}$';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_phone_e164_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles
      add constraint profiles_phone_e164_check
      check (phone_e164 is null or phone_e164 ~ '^\+91[6-9][0-9]{9}$') not valid;
  end if;
end $$;

-- ===== 8. Coupon redemptions (H-08) =====

create table if not exists public.coupon_redemptions (
  coupon_id uuid not null references public.coupons(id) on delete cascade,
  customer_id uuid not null references public.profiles(id) on delete cascade,
  redeemed_at timestamptz not null default now(),
  primary key (coupon_id, customer_id)
);
create index if not exists coupon_redemptions_customer_idx on public.coupon_redemptions(customer_id);
alter table public.coupon_redemptions enable row level security;
revoke all on public.coupon_redemptions from anon, authenticated;
grant all on public.coupon_redemptions to service_role;

-- ===== 9. Wallet transactions: lookups by provider reference, and status values (L-wallet) =====

create index if not exists wallet_transactions_provider_reference_idx
  on public.wallet_transactions (provider_reference);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wallet_transactions_status_check' and conrelid = 'public.wallet_transactions'::regclass) then
    alter table public.wallet_transactions
      add constraint wallet_transactions_status_check
      check (status in ('pending', 'completed', 'failed')) not valid;
  end if;
end $$;

-- ===== 10. Storage bucket limits (M-10) =====
-- The documents bucket also allows the Word MIME types that routes/uploads.ts accepts.
-- Omitting them would make the bucket reject uploads the API still allows.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('urban-tanker-documents', 'urban-tanker-documents', false, 10485760,
    array['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
          'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  ('customer-selfies', 'customer-selfies', false, 3145728, array['image/jpeg'])
on conflict (id) do update
set file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ===== 11. Performance indexes =====
-- Each column was confirmed in 001_initial.sql. None of these indexes already existed.

create index if not exists vendors_owner_profile_id_idx on public.vendors (owner_profile_id);
create index if not exists bookings_status_created_idx on public.bookings (status, created_at desc);
create index if not exists bookings_accepted_scheduled_for_idx on public.bookings (scheduled_for) where status = 'accepted';
create index if not exists booking_events_booking_created_idx on public.booking_events (booking_id, created_at);
create index if not exists notifications_event_type_created_idx on public.notifications (event_type, created_at desc);
create index if not exists documents_expires_on_idx on public.documents (expires_on);
create index if not exists invoices_customer_issued_idx on public.invoices (customer_id, issued_at desc);
create index if not exists complaints_vendor_created_idx on public.complaints (vendor_id, created_at desc);

-- ===== 12. Function hardening: search_path and execute privileges (DB-26, C-03) =====

alter function public.audit_booking_status() set search_path = public;

-- Only service_role may execute functions in public. Covers functions added by this file.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke all on routine %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on routine %s to service_role', fn.signature);
  end loop;
end $$;

-- New functions created by the migration role are not executable by public, anon or authenticated.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ===== 13. VALIDATE after cleanup (run separately, once preflight data is clean) =====
-- alter table public.documents validate constraint documents_verification_check;
-- alter table public.documents validate constraint documents_review_requires_reviewer_check;
-- alter table public.customer_memberships validate constraint customer_memberships_status_check;
-- alter table public.subscriptions validate constraint subscriptions_status_check;
-- alter table public.wallet_transactions validate constraint wallet_transactions_status_check;
-- alter table public.profiles validate constraint profiles_phone_e164_check;

-- ===== 14. Refund tracking (refund route records partial refunds) =====
alter table public.payments add column if not exists refunded_paise integer not null default 0 check (refunded_paise >= 0);

notify pgrst, 'reload schema';

commit;
