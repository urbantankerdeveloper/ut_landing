-- Urban Tanker canonical database install.
-- This script is destructive: it resets the public application schema.
-- Supabase auth.users is managed separately and is intentionally preserved.
-- This schema includes the multi-service booking and invoice-generation updates.
-- Existing databases must not run this reset script; upgrade them with reviewed, environment-specific migrations.

begin;

drop schema if exists public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to service_role;

-- ===== Consolidated from 001_initial.sql =====
create extension if not exists pgcrypto;

create type public.user_role as enum ('customer','vendor','dispatcher','admin');
create type public.booking_status as enum ('pending_vendor','vendor_assigned','accepted','en_route','arrived','delivered','cancelled');

create table if not exists public.user_mpin_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  pin_digest text not null,
  updated_at timestamptz not null default now()
);
alter table public.user_mpin_credentials enable row level security;
revoke all on public.user_mpin_credentials from public, anon, authenticated;
grant all on public.user_mpin_credentials to service_role;

create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text not null, phone_e164 text unique, role public.user_role not null default 'customer', created_at timestamptz not null default now());
create table if not exists public.vendors (id uuid primary key default gen_random_uuid(), owner_profile_id uuid references public.profiles(id) on delete set null, business_name text not null, phone_e164 text not null, service_zone text not null, latitude numeric(9,6), longitude numeric(9,6), is_online boolean not null default false, verification text not null default 'pending', created_at timestamptz not null default now(), constraint vendors_coordinates_pair_check check ((latitude is null) = (longitude is null) and (latitude is null or latitude between -90 and 90) and (longitude is null or longitude between -180 and 180)));
create table if not exists public.vehicles (id uuid primary key default gen_random_uuid(), vendor_id uuid not null references public.vendors(id) on delete cascade, registration_number text not null unique, capacity_litres integer, supported_services text[] not null default '{}', is_active boolean not null default true, metadata jsonb not null default '{}');
create table if not exists public.drivers (id uuid primary key default gen_random_uuid(), vendor_id uuid not null references public.vendors(id) on delete cascade, name text not null, mobile_e164 text not null, licence_number text not null, latitude numeric(9,6), longitude numeric(9,6), is_active boolean not null default false, verification text not null default 'pending', metadata jsonb not null default '{}', constraint drivers_coordinates_pair_check check ((latitude is null) = (longitude is null) and (latitude is null or latitude between -90 and 90) and (longitude is null or longitude between -180 and 180)));
create table if not exists public.service_catalog (id uuid primary key default gen_random_uuid(), code text unique not null, name text not null, description text, base_price_paise integer not null default 0, is_active boolean not null default true, config jsonb not null default '{}');
create table if not exists public.bookings (id uuid primary key default gen_random_uuid(), reference text unique not null, customer_id uuid references public.profiles(id) on delete set null, customer_email text, idempotency_key uuid, vendor_id uuid references public.vendors(id), vehicle_id uuid references public.vehicles(id), service_code text not null references public.service_catalog(code), capacity_litres integer, scheduled_for timestamptz, address_text text not null, latitude numeric(9,6), longitude numeric(9,6), access_notes text, cancellation_reason text, service_details jsonb not null default '[]'::jsonb, quoted_amount_paise integer not null default 0, status public.booking_status not null default 'pending_vendor', delivery_otp_hash text, delivery_otp_expires_at timestamptz, delivery_otp_sms_sent boolean, tracking_token_hash text unique, tracking_token_v2_hash text unique, tracking_token_expires_at timestamptz, tracking_confirmation_sent_at timestamptz, tracking_confirmation_email_sent_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index if not exists bookings_customer_idempotency_key_idx on public.bookings(customer_id, idempotency_key) where idempotency_key is not null;
alter table public.bookings add column if not exists cancellation_reason text;
alter table public.bookings add column if not exists customer_email text;
alter table public.bookings add column if not exists service_details jsonb not null default '[]'::jsonb;
alter table public.bookings add column if not exists tracking_token_hash text unique;
alter table public.bookings add column if not exists tracking_token_v2_hash text unique;
alter table public.bookings add column if not exists tracking_token_expires_at timestamptz;
alter table public.bookings add column if not exists tracking_confirmation_sent_at timestamptz;
alter table public.bookings add column if not exists tracking_confirmation_email_sent_at timestamptz;
create index if not exists bookings_customer_created_idx on public.bookings(customer_id, created_at desc);
create index if not exists bookings_vendor_created_idx on public.bookings(vendor_id, created_at desc);
create index if not exists bookings_tracking_token_hash_idx on public.bookings(tracking_token_hash);
create table if not exists public.booking_events (id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade, actor_id uuid references public.profiles(id) on delete set null, from_status public.booking_status, to_status public.booking_status not null, note text, created_at timestamptz not null default now());
create table if not exists public.payments (id uuid primary key default gen_random_uuid(), booking_id uuid unique not null references public.bookings(id), provider text not null, provider_order_id text unique, provider_payment_id text unique, amount_paise integer not null default 0, currency char(3) not null default 'INR', status text not null default 'pending', raw_webhook jsonb, created_at timestamptz not null default now());
create table if not exists public.invoices (id uuid primary key default gen_random_uuid(), number text unique not null, customer_id uuid references public.profiles(id) on delete set null, booking_id uuid references public.bookings(id), service text not null, location text not null, amount numeric not null default 0, status text not null default 'Paid', issued_at timestamptz not null default now());
create table if not exists public.saved_addresses (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, label text not null, address text not null, city text not null, pincode text not null, latitude numeric(9,6), longitude numeric(9,6), is_default boolean not null default false, created_at timestamptz not null default now());
alter table public.saved_addresses add column if not exists is_default boolean not null default false;
create unique index if not exists saved_addresses_one_default_idx on public.saved_addresses(user_id) where is_default = true;
create table if not exists public.subscriptions (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id) on delete cascade, plan_id text not null, status text not null, amount numeric not null default 0, next_delivery timestamptz, created_at timestamptz not null default now());
create table if not exists public.coupons (id uuid primary key default gen_random_uuid(), code text unique not null, title text not null, discount_type text not null, discount_value numeric not null default 0, valid_until timestamptz, is_active boolean not null default false, created_at timestamptz not null default now());
create table if not exists public.complaints (id uuid primary key default gen_random_uuid(), customer_id uuid references public.profiles(id) on delete set null, vendor_id uuid references public.vendors(id), booking_id uuid references public.bookings(id), subject text not null, message text not null, status text not null default 'open', created_at timestamptz not null default now());
create table if not exists public.notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid references public.profiles(id) on delete cascade, event_type text not null, title text not null, payload jsonb not null default '{}', read_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.dispatcher_alerts (id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade, alert_type text not null, status text not null default 'open' check (status in ('open','resolved','dismissed')), title text not null, detail text not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), resolved_at timestamptz, resolved_by uuid references public.profiles(id) on delete set null, unique(booking_id, alert_type));
create table if not exists public.device_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, token text not null unique, platform text not null check (platform in ('android','ios')), app_version text, is_active boolean not null default true, last_seen_at timestamptz not null default now(), created_at timestamptz not null default now());
create index if not exists device_tokens_user_active_idx on public.device_tokens(user_id, is_active);
create table if not exists public.audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id) on delete set null, action text not null, entity_type text not null, entity_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now());

alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.saved_addresses enable row level security;
alter table public.invoices enable row level security;

create policy "profiles self read" on public.profiles for select using (auth.uid() = id);
-- H-01: no customer policy on bookings. The select policy exposed delivery_otp_hash and
-- tracking_token_hash, and insert/update let customers write any status. Customers reach
-- bookings only through the backend (service_role). See the revokes near line 430.
create policy "customer own addresses" on public.saved_addresses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "customer own invoices" on public.invoices for select using (auth.uid() = customer_id);


-- ===== Consolidated from 002_operations.sql =====

create table if not exists public.vendor_location_updates (id bigint generated always as identity primary key, booking_id uuid not null references public.bookings(id) on delete cascade, vendor_id uuid not null references public.vendors(id) on delete cascade, latitude numeric(9,6) not null, longitude numeric(9,6) not null, accuracy_metres numeric, recorded_at timestamptz not null default now());
create index if not exists vendor_location_updates_booking_recorded_idx on public.vendor_location_updates(booking_id, recorded_at desc);
create table if not exists public.ratings (id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade, customer_id uuid references public.profiles(id) on delete set null, rating integer not null check (rating between 1 and 5), review text, created_at timestamptz not null default now(), unique(booking_id, customer_id));
create table if not exists public.wallet_transactions (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id) on delete cascade, type text not null check (type in ('credit','debit')), amount numeric not null check (amount > 0), status text not null default 'pending', provider_reference text, created_at timestamptz not null default now());
create table if not exists public.driver_attendance (id uuid primary key default gen_random_uuid(), vendor_id uuid not null references public.vendors(id) on delete cascade, driver_id uuid not null references public.drivers(id) on delete cascade, attendance_date date not null, status text not null check (status in ('present','absent','on_leave')), created_at timestamptz not null default now(), unique(driver_id, attendance_date));
create table if not exists public.documents (id uuid primary key default gen_random_uuid(), owner_type text not null, owner_id uuid not null, document_type text not null, object_key text not null, expires_on date, verification text not null default 'pending', created_at timestamptz not null default now());
create table if not exists public.configs (key text primary key, value jsonb not null default '{}', updated_at timestamptz not null default now());
create index if not exists vendor_location_booking_recorded_idx on public.vendor_location_updates(booking_id, recorded_at desc);
create index if not exists notifications_recipient_created_idx on public.notifications(recipient_id, created_at desc);
create index if not exists dispatcher_alerts_status_updated_idx on public.dispatcher_alerts(status, updated_at desc);



-- ===== Consolidated from 003_production_hardening.sql =====

-- Production hardening: timestamps, indexes, audit records, and private uploads.
create or replace function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

alter table public.vehicles add column if not exists verification text not null default 'pending';

do $$ declare table_name text; begin foreach table_name in array array['bookings','payments','vendors','drivers','subscriptions','complaints','enquiries'] loop if to_regclass(format('public.%I', table_name)) is not null then execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', table_name); end if; end loop; end $$;

do $$ declare table_name text; begin foreach table_name in array array['bookings','payments','vendors','drivers','subscriptions','complaints','enquiries'] loop if to_regclass(format('public.%I', table_name)) is not null then execute format('drop trigger if exists %I_updated_at on public.%I', table_name, table_name); execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name); end if; end loop; end $$;

create index if not exists bookings_vendor_status_idx on public.bookings(vendor_id, status, created_at desc);
create index if not exists payments_status_created_idx on public.payments(status, created_at desc);
create index if not exists drivers_vendor_status_idx on public.drivers(vendor_id, verification, is_active);
create index if not exists vehicles_vendor_status_idx on public.vehicles(vendor_id, verification, is_active);
create index if not exists notifications_recipient_read_idx on public.notifications(recipient_id, read_at, created_at desc);
create index if not exists audit_logs_actor_created_idx on public.audit_logs(actor_id, created_at desc);
create index if not exists coupons_active_until_idx on public.coupons(is_active, valid_until);

insert into storage.buckets (id, name, public) values ('urban-tanker-documents', 'urban-tanker-documents', false) on conflict (id) do nothing;
drop policy if exists "authenticated users upload documents" on storage.objects;
create policy "authenticated users upload documents" on storage.objects for insert to authenticated with check (bucket_id = 'urban-tanker-documents');
drop policy if exists "authenticated users read their documents" on storage.objects;
create policy "authenticated users read their documents" on storage.objects for select to authenticated using (bucket_id = 'urban-tanker-documents' and owner_id = auth.uid()::text);

create or replace function public.audit_booking_status() returns trigger language plpgsql security definer set search_path = public as $$ begin if old.status is distinct from new.status then insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata) values (auth.uid(), 'booking.status_changed', 'booking', new.id, jsonb_build_object('from', old.status, 'to', new.status)); end if; return new; end $$;
drop trigger if exists bookings_audit_status on public.bookings;
create trigger bookings_audit_status after update of status on public.bookings for each row execute function public.audit_booking_status();



-- ===== Consolidated from 004_customer_contracts.sql =====

create table if not exists public.customer_contracts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  property_type text not null,
  service_plan jsonb not null default '{}',
  address text not null,
  estimate numeric not null default 0,
  status text not null default 'requested',
  created_at timestamptz not null default now()
);

create index if not exists customer_contracts_customer_idx on public.customer_contracts(customer_id, created_at desc);
alter table public.customer_contracts enable row level security;
create policy "customer own contracts" on public.customer_contracts for all using (auth.uid() = customer_id) with check (auth.uid() = customer_id);


-- ===== Consolidated from 004_payouts.sql =====

create table if not exists public.vendor_payouts (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  amount numeric not null check (amount >= 0),
  status text not null default 'pending' check (status in ('pending', 'processing', 'paid', 'failed')),
  period_start date,
  period_end date,
  provider_reference text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists vendor_payouts_vendor_created_idx on public.vendor_payouts(vendor_id, created_at desc);


-- ===== Consolidated from 005_booking_lifecycle.sql =====

create or replace function public.transition_booking(
  p_booking_id uuid,
  p_actor_id uuid,
  p_next_status public.booking_status,
  p_vendor_id uuid default null,
  p_vehicle_id uuid default null,
  p_driver_id uuid default null,
  p_cancellation_reason text default null
) returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  current_booking public.bookings;
  next_booking public.bookings;
begin
  if p_next_status = 'cancelled' and (p_cancellation_reason is null or length(btrim(p_cancellation_reason)) < 2 or length(btrim(p_cancellation_reason)) > 500) then
    raise exception 'CANCELLATION_REASON_REQUIRED';
  end if;

  select * into current_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  if p_next_status = 'cancelled'
     and p_actor_id = current_booking.customer_id
     and current_booking.status not in ('pending_vendor', 'vendor_assigned') then
    raise exception 'CUSTOMER_CANCELLATION_WINDOW_CLOSED';
  end if;

  if p_vendor_id is not null and current_booking.vendor_id is not null and current_booking.vendor_id <> p_vendor_id then
    raise exception 'BOOKING_VENDOR_MISMATCH';
  end if;

  if p_vendor_id is not null and not exists (
    select 1 from public.vendors
    where id = p_vendor_id and verification = 'approved'
  ) then
    raise exception 'VENDOR_NOT_APPROVED';
  end if;

  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles
    where id = p_vehicle_id and vendor_id = coalesce(p_vendor_id, current_booking.vendor_id)
      and is_active and verification = 'approved'
  ) then
    raise exception 'VEHICLE_NOT_APPROVED';
  end if;

  if p_driver_id is not null and not exists (
    select 1 from public.drivers
    where id = p_driver_id and vendor_id = coalesce(p_vendor_id, current_booking.vendor_id)
      and is_active and verification = 'approved'
  ) then
    raise exception 'DRIVER_NOT_APPROVED';
  end if;

  if not (
    (current_booking.status = 'pending_vendor' and p_next_status in ('vendor_assigned', 'accepted', 'cancelled')) or
    (current_booking.status = 'vendor_assigned' and p_next_status in ('accepted', 'cancelled')) or
    (current_booking.status = 'accepted' and p_next_status in ('en_route', 'cancelled')) or
    (current_booking.status = 'en_route' and p_next_status = 'arrived') or
    (current_booking.status = 'arrived' and p_next_status = 'delivered')
  ) then
    raise exception 'INVALID_BOOKING_TRANSITION';
  end if;

  update public.bookings
  set status = p_next_status,
      cancellation_reason = case when p_next_status = 'cancelled' then btrim(p_cancellation_reason) else cancellation_reason end,
      vendor_id = coalesce(p_vendor_id, vendor_id),
      vehicle_id = coalesce(p_vehicle_id, vehicle_id),
      driver_id = coalesce(p_driver_id, driver_id),
      updated_at = now()
  where id = p_booking_id
  returning * into next_booking;

  insert into public.booking_events (booking_id, actor_id, from_status, to_status)
  values (p_booking_id, p_actor_id, current_booking.status, p_next_status);

  return next_booking;
end;
$$;

revoke all on function public.transition_booking(uuid, uuid, public.booking_status, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.transition_booking(uuid, uuid, public.booking_status, uuid, uuid, uuid, text) to service_role;


-- ===== Consolidated from 005_memberships.sql =====

create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  amount numeric not null default 0,
  billing_period text not null default 'monthly',
  benefits jsonb not null default '[]',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.customer_memberships (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  plan_id uuid not null references public.membership_plans(id),
  status text not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id)
);
alter table public.membership_plans enable row level security;
alter table public.customer_memberships enable row level security;
create policy "active plans are readable" on public.membership_plans for select using (is_active = true);
create policy "customer own membership" on public.customer_memberships for all using (auth.uid() = customer_id) with check (auth.uid() = customer_id);
insert into public.membership_plans (name, description, amount, billing_period, benefits)
select 'Care', 'Priority support and member pricing.', 499, 'monthly', '["Priority support", "Member pricing"]'::jsonb where not exists (select 1 from public.membership_plans where name = 'Care');
insert into public.membership_plans (name, description, amount, billing_period, benefits)
select 'Care Plus', 'Includes one scheduled service credit.', 899, 'monthly', '["Priority support", "Member pricing", "One service credit"]'::jsonb where not exists (select 1 from public.membership_plans where name = 'Care Plus');
insert into public.membership_plans (name, description, amount, billing_period, benefits)
select 'Property', 'For recurring residential or commercial needs.', 1499, 'monthly', '["Priority support", "Member pricing", "Recurring service planning"]'::jsonb where not exists (select 1 from public.membership_plans where name = 'Property');


-- ===== Consolidated from 006_push_subscriptions.sql =====

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(customer_id, endpoint)
);
create index if not exists push_subscriptions_customer_idx on public.push_subscriptions(customer_id);
alter table public.push_subscriptions enable row level security;
create policy "customer own push subscriptions" on public.push_subscriptions for all using (auth.uid() = customer_id) with check (auth.uid() = customer_id);



-- ===== Consolidated from 007_vendor_services.sql =====

create table if not exists public.vendor_service_availability (
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  service_code text not null references public.service_catalog(code) on delete cascade,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (vendor_id, service_code)
);
alter table public.vendor_service_availability enable row level security;
create policy "vendor owns service availability" on public.vendor_service_availability for all using (auth.uid() in (select owner_profile_id from public.vendors where id = vendor_id)) with check (auth.uid() in (select owner_profile_id from public.vendors where id = vendor_id));


-- ===== Consolidated from 008_enquiries.sql =====

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id) on delete set null,
  subject text not null,
  message text not null,
  status text not null default 'new',
  response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists enquiries_status_created_idx on public.enquiries(status, created_at desc);


-- ===== Consolidated from 009_notification_preferences.sql =====

create table if not exists public.notification_preferences (
  customer_id uuid primary key references public.profiles(id) on delete cascade,
  booking_updates boolean not null default true,
  payment_updates boolean not null default true,
  marketing_updates boolean not null default false,
  push_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
create policy "customer own notification preferences" on public.notification_preferences for all using (auth.uid() = customer_id) with check (auth.uid() = customer_id);



-- ===== Consolidated from 010_offline_mutations.sql =====

create table if not exists public.offline_mutations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  mutation_type text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}',
  client_version integer not null default 1,
  server_version integer not null default 0,
  conflict_status text not null default 'queued' check (conflict_status in ('queued','processing','conflict','applied','discarded')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists offline_mutations_actor_status_idx on public.offline_mutations(actor_id, conflict_status, created_at desc);
alter table public.offline_mutations enable row level security;
create policy "actor owns offline mutations" on public.offline_mutations for all using (auth.uid() = actor_id) with check (auth.uid() = actor_id);



-- ===== Consolidated from 011_profile_usernames.sql =====

alter table public.profiles add column if not exists username text;
create unique index if not exists profiles_username_lower_idx on public.profiles(lower(username)) where username is not null;

-- Registration channel (null = created before this was captured) and the user's saved theme.
alter table public.profiles
  add column if not exists signup_platform text,
  add column if not exists theme_mode text not null default 'system';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_signup_platform_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_signup_platform_check check (signup_platform is null or signup_platform in ('web', 'mobile'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_theme_mode_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles add constraint profiles_theme_mode_check check (theme_mode in ('light', 'dark', 'system'));
  end if;
end $$;

-- Rebuild public profiles for Supabase accounts retained across a schema reset.
with account_profiles as (
  select
    id,
    coalesce(
      nullif(btrim(raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(raw_user_meta_data->>'name'), ''),
      nullif(split_part(email, '@', 1), ''),
      id::text
    ) as full_name,
    nullif(btrim(raw_user_meta_data->>'phone'), '') as phone_e164,
    nullif(btrim(raw_user_meta_data->>'username'), '') as username,
    -- Roles come only from app_metadata (service-side only). user_metadata is client-writable and must never grant a role.
    raw_app_meta_data->>'role' as account_role
  from auth.users
), unique_accounts as (
  select
    *,
    count(phone_e164) over (partition by phone_e164) as phone_count,
    count(username) over (partition by lower(username)) as username_count
  from account_profiles
)
insert into public.profiles (id, full_name, phone_e164, role, username)
select
  id,
  full_name,
  null::text, -- unverified phones are not carried over; users verify again
  case
    when account_role in ('customer', 'vendor', 'dispatcher', 'admin')
      then account_role::public.user_role
    else 'customer'::public.user_role
  end,
  case when username_count = 1 then username end
from unique_accounts
on conflict (id) do nothing;



-- ===== Consolidated from 012_live_access_policies.sql =====

-- Live access policy hardening for customer, vendor, admin, and realtime data paths.

grant usage on schema public to authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema public grant all privileges on functions to service_role;

grant select on public.service_catalog to anon, authenticated;
grant select on public.vendors to authenticated;

alter table public.service_catalog enable row level security;
alter table public.bookings enable row level security;
alter table public.notifications enable row level security;
alter table public.vendors enable row level security;
alter table public.vehicles enable row level security;
alter table public.drivers enable row level security;
alter table public.vendor_service_availability enable row level security;

drop policy if exists "active services are readable" on public.service_catalog;
create policy "active services are readable"
on public.service_catalog
for select
to anon, authenticated
using (is_active = true);

-- H-01: customers cannot read, insert or update bookings directly. create_customer_booking and
-- transition_booking (service_role only) are the write paths. Hash columns never reach clients.
revoke insert, update, delete, select on public.bookings from anon, authenticated;

drop policy if exists "users can mark own notifications read" on public.notifications;
-- M-26: clients must not update notifications. Mark-as-read goes through the backend.
revoke update on public.notifications from authenticated, anon;

drop policy if exists "users can read own notifications" on public.notifications;
create policy "users can read own notifications"
on public.notifications
for select
to authenticated
using (auth.uid() = recipient_id);

drop policy if exists "vendors can read own vendor profile" on public.vendors;
create policy "vendors can read own vendor profile"
on public.vendors
for select
to authenticated
using (owner_profile_id = auth.uid());

drop policy if exists "vendors can manage own vehicles" on public.vehicles;
create policy "vendors can manage own vehicles"
on public.vehicles
for all
to authenticated
using (
  exists (
    select 1
    from public.vendors
    where vendors.id = vehicles.vendor_id
      and vendors.owner_profile_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.vendors
    where vendors.id = vehicles.vendor_id
      and vendors.owner_profile_id = auth.uid()
  )
);

drop policy if exists "vendors can manage own drivers" on public.drivers;
create policy "vendors can manage own drivers"
on public.drivers
for all
to authenticated
using (
  exists (
    select 1
    from public.vendors
    where vendors.id = drivers.vendor_id
      and vendors.owner_profile_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.vendors
    where vendors.id = drivers.vendor_id
      and vendors.owner_profile_id = auth.uid()
  )
);

drop policy if exists "vendors can manage own service availability" on public.vendor_service_availability;
create policy "vendors can manage own service availability"
on public.vendor_service_availability
for all
to authenticated
using (
  exists (
    select 1
    from public.vendors
    where vendors.id = vendor_service_availability.vendor_id
      and vendors.owner_profile_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.vendors
    where vendors.id = vendor_service_availability.vendor_id
      and vendors.owner_profile_id = auth.uid()
  )
);



-- ===== Consolidated from 013_storage_access_hardening.sql =====

-- Restrict document objects to the authenticated user's own top-level folder.

drop policy if exists "authenticated users upload documents" on storage.objects;
create policy "authenticated users upload documents"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'urban-tanker-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authenticated users read their documents" on storage.objects;
create policy "authenticated users read their documents"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'urban-tanker-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authenticated users update their documents" on storage.objects;
create policy "authenticated users update their documents"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'urban-tanker-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'urban-tanker-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "authenticated users delete their documents" on storage.objects;
create policy "authenticated users delete their documents"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'urban-tanker-documents'
  and (storage.foldername(name))[1] = auth.uid()::text
);



-- ===== Consolidated from 014_booking_driver_assignment.sql =====

alter table public.bookings
  add column if not exists driver_id uuid references public.drivers(id) on delete set null;

create index if not exists bookings_driver_id_idx on public.bookings(driver_id);



-- ===== Consolidated from 015_analytics_events.sql =====

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (length(event_name) between 2 and 80),
  session_id text not null check (length(session_id) between 8 and 120),
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_at_idx
  on public.analytics_events(created_at desc);

create index if not exists analytics_events_name_created_at_idx
  on public.analytics_events(event_name, created_at desc);

alter table public.analytics_events enable row level security;



-- ===== Consolidated from 016_standard_service_catalog.sql =====

insert into public.service_catalog (code, name, description, base_price_paise, is_active, config)
values
  ('water_tanker', 'Water tanker', 'Potable and utility water delivery', 185000, true, '{"capacityOptions":["500 litres","1000 litres","2000 litres","5000 litres"],"waterTypeOptions":["Drinking water","Utility water"],"tankerCountOptions":["1","2","3","4","5"]}'),
  ('sewage_tanker', 'Sewage tanker', 'Sewage and wastewater transport', 185000, true, '{"capacityOptions":["3000 litres","5000 litres","10000 litres"],"detailOptions":["Septic tank cleaning","Sewage pit emptying","Wastewater collection"],"tankerCountOptions":["1","2","3","4","5"]}'),
  ('tank_cleaning', 'Tank cleaning', 'Residential and commercial tank cleaning', 185000, true, '{"capacityOptions":["1000 litres","2000 litres","5000 litres","10000 litres"],"detailOptions":["Overhead tank cleaning","Underground tank cleaning","Both overhead and underground tanks"]}'),
  ('borewell_service', 'Borewell service', 'Borewell inspection and service support', 185000, true, '{"capacityOptions":["Single borewell","Multiple borewells"],"detailOptions":["Low water output","Pump issue","Borewell inspection","New borewell consultation"]}')
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true,
    config = excluded.config || coalesce(public.service_catalog.config, '{}'::jsonb);



-- ===== Consolidated from 017_guest_booking_phone.sql =====

alter table public.bookings
  add column if not exists customer_phone_e164 text;

create table if not exists public.guest_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  phone_e164 text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  verified_at timestamptz,
  template_key text,
  delivery_channel text check (delivery_channel in ('pending', 'whatsapp', 'sms')),
  created_at timestamptz not null default now()
);
alter table public.guest_otp_challenges add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.guest_otp_challenges add column if not exists template_key text;
alter table public.guest_otp_challenges add column if not exists delivery_channel text;
alter table public.guest_otp_challenges add column if not exists consumed_at timestamptz;
alter table public.guest_otp_challenges drop constraint if exists guest_otp_challenges_delivery_channel_check;
alter table public.guest_otp_challenges
  add constraint guest_otp_challenges_delivery_channel_check
  check (delivery_channel is null or delivery_channel in ('pending', 'whatsapp', 'sms'));

create index if not exists guest_otp_challenges_phone_created_idx
  on public.guest_otp_challenges(phone_e164, created_at desc);
create index if not exists guest_otp_challenges_phone_template_created_idx
  on public.guest_otp_challenges(phone_e164, template_key, created_at desc)
  where verified_at is null;
create index if not exists guest_otp_challenges_user_phone_template_created_idx
  on public.guest_otp_challenges(user_id, phone_e164, template_key, created_at desc)
  where verified_at is null;

drop function if exists public.claim_guest_otp_challenge(text, text, text, timestamptz, integer);
create or replace function public.claim_guest_otp_challenge(
  p_phone_e164 text,
  p_template_key text,
  p_otp_hash text,
  p_expires_at timestamptz,
  p_resend_after_seconds integer,
  p_user_id uuid default null
)
returns table (
  challenge_id uuid,
  delivery_channel text,
  created_at timestamptz,
  expires_at timestamptz,
  is_new boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing_challenge public.guest_otp_challenges%rowtype;
begin
  if p_resend_after_seconds < 0 then
    raise exception 'resend cooldown cannot be negative';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_phone_e164), hashtext(p_template_key));

  select *
    into existing_challenge
    from public.guest_otp_challenges as challenge
   where challenge.phone_e164 = p_phone_e164
     and challenge.template_key = p_template_key
     and challenge.user_id is not distinct from p_user_id
     and challenge.verified_at is null
     and challenge.created_at >= now() - make_interval(secs => p_resend_after_seconds)
   order by challenge.created_at desc
   limit 1;

  if found then
    return query
      select existing_challenge.id, existing_challenge.delivery_channel,
             existing_challenge.created_at, existing_challenge.expires_at, false;
    return;
  end if;

  insert into public.guest_otp_challenges (
    user_id, phone_e164, template_key, otp_hash, expires_at, delivery_channel
  )
  values (
    p_user_id, p_phone_e164, p_template_key, p_otp_hash, p_expires_at, 'pending'
  )
  returning * into existing_challenge;

  return query
    select existing_challenge.id, existing_challenge.delivery_channel,
           existing_challenge.created_at, existing_challenge.expires_at, true;
end;
$$;
revoke all on function public.claim_guest_otp_challenge(text, text, text, timestamptz, integer, uuid) from public;
grant execute on function public.claim_guest_otp_challenge(text, text, text, timestamptz, integer, uuid) to service_role;

-- BEGIN incremental update: sms templates (idempotent, run with npm run db:update)
create table if not exists public.sms_templates (
  template_key text primary key,
  body text not null,
  variables text[] not null default '{}',
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.sms_templates add column if not exists msg91_template_id text;
alter table public.sms_templates enable row level security;

-- Email templates are separate from SMS/WhatsApp because email uses a subject and longer-form content.
create table if not exists public.email_templates (
  template_key text primary key,
  subject text not null,
  body text not null,
  variables text[] not null default '{}',
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.email_templates enable row level security;
revoke all on public.email_templates from public, anon, authenticated;
grant all on public.email_templates to service_role;


INSERT INTO public.sms_templates (template_key, body, variables)
VALUES
(
  'user_registration_otp',
  'Welcome to Urban Tanker!

Use {{otp}} to verify your mobile number and complete your registration.

This code is valid for 10 minutes. For your security, please do not share it with anyone.

Thank you for joining Urban Tanker!',
  '{otp}'
),
(
  'booking_verification_otp',
  'Urban Tanker Booking Verification

Your booking verification code is {{otp}}.

This code is valid for 10 minutes. Please do not share it with anyone.',
  '{otp}'
),
(
  'guest_booking_confirmation',
  'Urban Tanker | Booking Confirmed

Your booking {{reference}} has been successfully confirmed.

You can view your booking details and track its progress here:

{{trackingUrl}}

Thank you for choosing Urban Tanker. We appreciate your trust in us!',
  '{reference,trackingUrl}'
),
(
  'booking_status_update',
  'Urban Tanker | Booking Update

Your booking {{reference}} has a new status: {{status}}.

{{detail}}

Track your booking and view the latest updates:

{{trackingUrl}}

Thank you for choosing Urban Tanker!',
  '{reference,status,detail,trackingUrl}'
),
(
  'vendor_acceptance',
  'Urban Tanker | Booking Accepted

Good news! Your booking {{reference}} has been accepted.

Vehicle: {{vehicle}}
Driver: {{driver}}

You can follow your delivery progress using the link below:

{{trackingUrl}}

Thank you for choosing Urban Tanker!',
  '{reference,vehicle,driver,trackingUrl}'
),
(
  'delivery_confirmation',
  'Urban Tanker | Delivery Completed

Your booking {{reference}} has been successfully delivered.

Thank you for choosing Urban Tanker. We appreciate your business and look forward to serving you again!',
  '{reference}'
),
(
  'delivery_otp',
  'Urban Tanker | Delivery Verification

Your delivery verification code for booking {{reference}} is {{otp}}.

This code is valid for 15 minutes. Share it only with your authorized delivery driver to confirm receipt of your order.',
  '{reference,otp}'
)
ON CONFLICT (template_key)
DO UPDATE SET
  body = EXCLUDED.body,
  variables = EXCLUDED.variables;


-- Consolidated from 002_vendor_acceptance_tracking_template.sql.
alter table public.bookings
  add column if not exists tracking_confirmation_sent_at timestamptz,
  add column if not exists tracking_confirmation_email_sent_at timestamptz,
  add column if not exists tracking_token_v2_hash text unique;

update public.sms_templates
set
  body = case
    when position('{{trackingUrl}}' in body) > 0 then body
    else rtrim(body) || ' Follow live tracking: {{trackingUrl}}'
  end,
  variables = case
    when 'trackingUrl' = any(variables) then variables
    else array_append(variables, 'trackingUrl')
  end,
  updated_at = now()
where template_key = 'vendor_acceptance'
  and (
    position('{{trackingUrl}}' in body) = 0
    or not ('trackingUrl' = any(variables))
  );

update public.sms_templates
set
  body = case
    when position('{{trackingUrl}}' in body) > 0 then body
    else rtrim(body) || ' Track your order: {{trackingUrl}}'
  end,
  variables = case
    when 'trackingUrl' = any(variables) then variables
    else array_append(variables, 'trackingUrl')
  end,
  updated_at = now()
where template_key = 'guest_booking_confirmation'
  and (
    position('{{trackingUrl}}' in body) = 0
    or not ('trackingUrl' = any(variables))
  );

-- BEGIN incremental update: booking customer type (idempotent, run with npm run db:update)
alter table public.bookings
  add column if not exists customer_type text not null default 'registered';

alter table public.bookings drop constraint if exists bookings_customer_type_check;
alter table public.bookings
  add constraint bookings_customer_type_check
  check (customer_type in ('registered', 'guest'));

-- Guest accounts are created with a username starting "guest_" (see auth guest/verify-otp).
update public.bookings b
set customer_type = 'guest'
from public.profiles p
where p.id = b.customer_id
  and p.username like 'guest\_%'
  and b.customer_type <> 'guest';

create or replace function public.set_booking_customer_type()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.customer_type := case
    when exists (select 1 from public.profiles p where p.id = new.customer_id and p.username like 'guest\_%') then 'guest'
    else 'registered'
  end;
  return new;
end;
$$;

drop trigger if exists bookings_set_customer_type on public.bookings;
create trigger bookings_set_customer_type before insert on public.bookings
  for each row execute function public.set_booking_customer_type();

create index if not exists bookings_customer_type_created_idx on public.bookings(customer_type, created_at desc);
-- END incremental update

-- BEGIN incremental update: customer selfie (idempotent, run with npm run db:update)
alter table public.profiles
  add column if not exists selfie_path text,
  add column if not exists selfie_required boolean not null default false,
  add column if not exists selfie_captured_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('customer-selfies', 'customer-selfies', false, 3145728, array['image/jpeg'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- END incremental update



-- ===== Consolidated from 018_seed_customer_coupons.sql =====

insert into public.coupons (
  code,
  title,
  discount_type,
  discount_value,
  valid_until,
  is_active
)
values
  ('WELCOME10', '10% off your first tanker booking', 'percentage', 10, now() + interval '90 days', true),
  ('WATER150', 'INR 150 off water tanker delivery', 'flat', 150, now() + interval '60 days', true),
  ('CLEAN200', 'INR 200 off tank cleaning', 'flat', 200, now() + interval '60 days', true),
  ('URBAN15', '15% off your next service', 'percentage', 15, now() + interval '45 days', true)
on conflict (code) do nothing;



-- ===== Consolidated from 019_cash_on_delivery.sql =====

alter table public.bookings
  add column if not exists payment_method text not null default 'wallet';

alter table public.bookings
  drop constraint if exists bookings_payment_method_check;

alter table public.bookings
  add constraint bookings_payment_method_check
  check (payment_method in ('wallet', 'gateway', 'cod'));

create or replace function public.create_customer_booking(p_booking jsonb, p_notifications jsonb, p_payment jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_created boolean;
begin
  insert into public.bookings (reference, customer_id, idempotency_key, vendor_id, service_code,
    capacity_litres, scheduled_for, address_text, latitude, longitude, access_notes,
    service_details, quoted_amount_paise, payment_method)
  values (p_booking->>'reference', (p_booking->>'customer_id')::uuid,
    nullif(p_booking->>'idempotency_key', '')::uuid, nullif(p_booking->>'vendor_id', '')::uuid,
    p_booking->>'service_code', nullif(p_booking->>'capacity_litres', '')::integer,
    nullif(p_booking->>'scheduled_for', '')::timestamptz, p_booking->>'address_text',
    nullif(p_booking->>'latitude', '')::numeric, nullif(p_booking->>'longitude', '')::numeric,
    p_booking->>'access_notes', coalesce(p_booking->'service_details', '[]'::jsonb),
    coalesce(nullif(p_booking->>'quoted_amount_paise', '')::integer, 0),
    coalesce(p_booking->>'payment_method', 'wallet'))
  on conflict (customer_id, idempotency_key) where idempotency_key is not null do nothing
  returning * into v_booking;
  v_created := found;

  if not v_created then
    select * into v_booking
    from public.bookings
    where customer_id = (p_booking->>'customer_id')::uuid
      and idempotency_key = (p_booking->>'idempotency_key')::uuid;
  else
    if p_payment is not null then
      insert into public.payments (booking_id, provider, amount_paise, currency, status)
      values (v_booking.id, p_payment->>'provider', (p_payment->>'amount_paise')::integer,
        coalesce(p_payment->>'currency', 'INR'), coalesce(p_payment->>'status', 'pending'));
    end if;

    insert into public.notifications (recipient_id, event_type, title, payload)
    select n.recipient_id, n.event_type, n.title,
      coalesce(n.payload, '{}'::jsonb) || jsonb_build_object('bookingId', v_booking.id, 'reference', v_booking.reference)
    from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb))
      as n(recipient_id uuid, event_type text, title text, payload jsonb);
  end if;

  return jsonb_build_object('booking', to_jsonb(v_booking), 'created', v_created);
end;
$$;
revoke all on function public.create_customer_booking(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_customer_booking(jsonb, jsonb, jsonb) to service_role;


create table if not exists public.partner_applications (
  id uuid primary key default gen_random_uuid(),
  reference text unique not null,
  business_name text not null,
  partner_type text not null,
  phone_e164 text not null,
  whatsapp_e164 text,
  email text not null,
  service_zone text not null,
  business_address text not null,
  service_codes text[] not null default '{}',
  vehicle_count integer not null check (vehicle_count between 1 and 250),
  primary_registration text not null,
  vehicle_capacity text not null,
  years_in_operation integer check (years_in_operation between 0 and 75),
  availability text not null,
  notes text,
  document_names text[] not null default '{}',
  status text not null default 'submitted' check (status in ('submitted', 'under_review', 'approved', 'rejected')),
  review_note text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_applications_status_created_idx on public.partner_applications(status, created_at desc);
grant all privileges on public.partner_applications to service_role;
drop trigger if exists partner_applications_updated_at on public.partner_applications;
create trigger partner_applications_updated_at before update on public.partner_applications for each row execute function public.set_updated_at();

-- ===== Consolidated from 002_security_hardening.sql =====

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

-- On existing databases, check for duplicate vendor-period payouts before applying this index.
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
alter table public.bookings
  add column if not exists delivery_otp_sms_sent boolean;

-- Atomic guest OTP attempt. Returns the stored hash only while the challenge is open, unverified,
-- unexpired, and under 5 attempts. An empty result means invalid, expired, or exhausted.
-- The caller compares the hash and must not reveal which condition failed.
drop function if exists public.consume_guest_otp_attempt(uuid, text);
create or replace function public.consume_guest_otp_attempt(p_challenge_id uuid, p_phone text)
returns table(otp_hash text)
language sql
set search_path = public
as $$
  update public.guest_otp_challenges
  set attempts = attempts + 1
  where id = p_challenge_id
    and phone_e164 = p_phone
    and user_id is null
    and verified_at is null
    and attempts < 5
    and expires_at > now()
  returning guest_otp_challenges.otp_hash;
$$;

drop function if exists public.consume_user_phone_otp_attempt(uuid, text, uuid);
create or replace function public.consume_user_phone_otp_attempt(p_challenge_id uuid, p_phone text, p_user_id uuid)
returns table(otp_hash text)
language sql
set search_path = public
as $$
  update public.guest_otp_challenges
  set attempts = attempts + 1
  where id = p_challenge_id
    and phone_e164 = p_phone
    and user_id = p_user_id
    and verified_at is null
    and attempts < 5
    and expires_at > now()
  returning guest_otp_challenges.otp_hash;
$$;

revoke all on function public.consume_guest_otp_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.consume_guest_otp_attempt(uuid, text) to service_role;
revoke all on function public.consume_user_phone_otp_attempt(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.consume_user_phone_otp_attempt(uuid, text, uuid) to service_role;

create table if not exists public.user_phone_verification_lockouts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_phone_verification_lockouts enable row level security;
revoke all on public.user_phone_verification_lockouts from public, anon, authenticated;
grant all on public.user_phone_verification_lockouts to service_role;

create or replace function public.begin_user_phone_verification_attempt(
  p_phone text,
  p_user_id uuid
)
returns table(challenge_id uuid, otp_hash text, outcome text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_failed_attempts integer;
  v_locked_until timestamptz;
  v_challenge public.guest_otp_challenges%rowtype;
begin
  insert into public.user_phone_verification_lockouts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select lockout.failed_attempts, lockout.locked_until
    into v_failed_attempts, v_locked_until
    from public.user_phone_verification_lockouts as lockout
    where lockout.user_id = p_user_id
    for update;

  if v_locked_until > now() then
    return query select null::uuid, null::text, 'locked'::text,
      greatest(1, ceil(extract(epoch from (v_locked_until - now())))::integer);
    return;
  end if;

  if v_locked_until is not null then
    update public.user_phone_verification_lockouts as lockout
      set failed_attempts = 0, locked_until = null, updated_at = now()
      where lockout.user_id = p_user_id;
    v_failed_attempts := 0;
  end if;

  select challenge.*
    into v_challenge
    from public.guest_otp_challenges as challenge
    where challenge.user_id = p_user_id
      and challenge.phone_e164 = p_phone
      and challenge.template_key = 'user_registration_otp'
      and challenge.verified_at is null
      and challenge.expires_at > now()
    order by challenge.created_at desc
    limit 1
    for update;

  if not found then
    return query select null::uuid, null::text, 'invalid'::text, null::integer;
    return;
  end if;

  if v_challenge.attempts >= 5 then
    update public.user_phone_verification_lockouts as lockout
      set failed_attempts = 5, locked_until = now() + interval '10 minutes', updated_at = now()
      where lockout.user_id = p_user_id
      returning lockout.failed_attempts, lockout.locked_until
        into v_failed_attempts, v_locked_until;
    return query select null::uuid, null::text, 'locked'::text, 600;
    return;
  end if;

  update public.guest_otp_challenges as challenge
    set attempts = challenge.attempts + 1
    where challenge.id = v_challenge.id;

  return query select v_challenge.id, v_challenge.otp_hash, 'check'::text, null::integer;
end;
$$;

create or replace function public.finish_user_phone_verification_attempt(
  p_challenge_id uuid,
  p_user_id uuid,
  p_is_correct boolean
)
returns table(outcome text, locked_until timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_failed_attempts integer;
  v_locked_until timestamptz;
  v_challenge_id uuid;
begin
  insert into public.user_phone_verification_lockouts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select lockout.failed_attempts, lockout.locked_until
    into v_failed_attempts, v_locked_until
    from public.user_phone_verification_lockouts as lockout
   where lockout.user_id = p_user_id
   for update;

  if v_locked_until > now() then
    return query select 'locked'::text, v_locked_until;
    return;
  end if;

  select challenge.id
    into v_challenge_id
    from public.guest_otp_challenges as challenge
   where challenge.id = p_challenge_id
     and challenge.user_id = p_user_id
     and challenge.verified_at is null
     and challenge.expires_at > now()
   for update;
  if not found then
    return query select 'invalid'::text, null::timestamptz;
    return;
  end if;

  if p_is_correct then
    update public.guest_otp_challenges as challenge
       set verified_at = now()
     where challenge.id = p_challenge_id
       and challenge.user_id = p_user_id
       and challenge.verified_at is null
       and challenge.expires_at > now();
    if not found then
      return query select 'invalid'::text, null::timestamptz;
      return;
    end if;
    update public.user_phone_verification_lockouts as lockout
       set failed_attempts = 0, locked_until = null, updated_at = now()
     where lockout.user_id = p_user_id;
    return query select 'valid'::text, null::timestamptz;
    return;
  end if;

  update public.user_phone_verification_lockouts as lockout
    set failed_attempts = lockout.failed_attempts + 1,
        locked_until = case when lockout.failed_attempts + 1 >= 5 then now() + interval '10 minutes' else null end,
        updated_at = now()
    where lockout.user_id = p_user_id
    returning lockout.failed_attempts, lockout.locked_until
      into v_failed_attempts, v_locked_until;

  if v_locked_until is not null then
    return query select 'locked'::text, v_locked_until;
    return;
  end if;

  return query select 'incorrect'::text, null::timestamptz;
end;
$$;

revoke all on function public.begin_user_phone_verification_attempt(text, uuid) from public, anon, authenticated;
grant execute on function public.begin_user_phone_verification_attempt(text, uuid) to service_role;
revoke all on function public.finish_user_phone_verification_attempt(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.finish_user_phone_verification_attempt(uuid, uuid, boolean) to service_role;

-- ===== 7. Phone identity (H-14) =====

alter table public.profiles
  add column if not exists phone_verified boolean not null default false;

alter table public.profiles
  add column if not exists phone_verified_at timestamptz;

update public.profiles
set phone_verified = true
where phone_verified_at is not null;

-- Only verified phones are indexed here; UNIQUE(phone_e164) also applies to all rows.
create unique index if not exists profiles_phone_verified_unique_idx
  on public.profiles (phone_e164)
  where phone_verified_at is not null;

-- Backfill legacy 10-digit Indian mobiles to E.164 after checking for collisions on existing databases.
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

-- ===== 15. Account deletion: detach user-linked business records instead of blocking the delete =====
-- Bookings, invoices and ratings are kept when a user is deleted; the customer link is set to NULL.
-- Notifications are personal and are removed with the user.
alter table public.bookings alter column customer_id drop not null;
alter table public.invoices alter column customer_id drop not null;
alter table public.ratings alter column customer_id drop not null;

alter table public.bookings drop constraint if exists bookings_customer_id_fkey;
alter table public.bookings add constraint bookings_customer_id_fkey foreign key (customer_id) references public.profiles(id) on delete set null;
alter table public.invoices drop constraint if exists invoices_customer_id_fkey;
alter table public.invoices add constraint invoices_customer_id_fkey foreign key (customer_id) references public.profiles(id) on delete set null;

-- ===== 16. Structured Razorpay payment details (additive; raw_webhook stays as the full-fidelity copy) =====
-- Null means "not reported by Razorpay yet" (for example fee/tax before settlement), not zero.
alter table public.payments add column if not exists method text;
alter table public.payments add column if not exists bank text;
alter table public.payments add column if not exists wallet text;
alter table public.payments add column if not exists vpa text;
alter table public.payments add column if not exists card_network text;
alter table public.payments add column if not exists card_last4 text;
alter table public.payments add column if not exists card_type text;
alter table public.payments add column if not exists card_issuer text;
alter table public.payments add column if not exists international boolean;
alter table public.payments add column if not exists fee_paise integer check (fee_paise is null or fee_paise >= 0);
alter table public.payments add column if not exists tax_paise integer check (tax_paise is null or tax_paise >= 0);
alter table public.payments add column if not exists payer_email text;
alter table public.payments add column if not exists payer_contact text;
alter table public.payments add column if not exists captured_at timestamptz;
alter table public.payments add column if not exists error_code text;
alter table public.payments add column if not exists error_description text;
alter table public.payments add column if not exists error_source text;
alter table public.payments add column if not exists error_step text;
alter table public.payments add column if not exists error_reason text;
-- Audit trail for background reconciliation and flags that need admin attention (see services/paymentReconciliation.ts).
alter table public.payments add column if not exists reconciled_at timestamptz;
alter table public.payments add column if not exists reconciliation_note text;
create index if not exists payments_status_captured_idx on public.payments (status, captured_at desc);
create index if not exists payments_unreconciled_pending_idx on public.payments (created_at) where status = 'pending' and reconciled_at is null;
create index if not exists payments_reconciliation_note_idx on public.payments (reconciliation_note) where reconciliation_note is not null;
-- COD bookings switched to online mid-journey. The notification claim makes vendor and driver alerts fire once.
alter table public.bookings add column if not exists payment_switched_to_online_at timestamptz;
alter table public.bookings add column if not exists cod_online_notified_at timestamptz;
create index if not exists bookings_switched_online_idx on public.bookings (payment_switched_to_online_at) where payment_method = 'gateway';
-- An online-payment booking exists only after Razorpay confirms payment. Until then the request waits here.
create table if not exists public.booking_checkouts (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id) on delete cascade, idempotency_key uuid, booking_request jsonb not null, quoted_amount_paise integer not null check (quoted_amount_paise > 0), coupon_id uuid references public.coupons(id) on delete set null, status text not null default 'awaiting_payment' check (status in ('awaiting_payment','order_created','failed','cod','booked')), provider_order_id text unique, booking_id uuid unique references public.bookings(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index if not exists booking_checkouts_customer_idempotency_idx on public.booking_checkouts (customer_id, idempotency_key) where idempotency_key is not null;
create index if not exists booking_checkouts_status_created_idx on public.booking_checkouts (status, created_at);
alter table public.booking_checkouts enable row level security;
insert into public.sms_templates (template_key, body, variables) values
  ('cod_switched_to_online', 'Urban Tanker: Booking {{reference}} is paid online. Do NOT collect any cash from the customer.', '{reference}'),
  ('cod_reverted_to_cash', 'Urban Tanker: Booking {{reference}} is back to cash on delivery. Collect the payment from the customer.', '{reference}')
on conflict (template_key) do nothing;
insert into public.email_templates (template_key, subject, body, variables) values
  (
    'guest_booking_confirmation',
    'Your booking {{reference}} is confirmed',
    E'Hello,\n\nYour Urban Tanker booking {{reference}} is confirmed. We have received your request and will keep you informed as the service partner is assigned, accepts the booking, and completes the delivery.\n\nYou can view your booking, check its scheduled details, and follow its progress here:\n{{trackingUrl}}\n\nPlease keep your contact number available for service updates. If any booking details need attention, contact Urban Tanker support and include your booking reference.',
    '{reference,trackingUrl}'
  ),
  (
    'booking_status_update',
    'Booking {{reference}}: {{status}}',
    E'Hello,\n\nThere is an update to your Urban Tanker booking {{reference}}.\n\n{{status}}\n{{detail}}\n\nTrack your booking: {{trackingUrl}}',
    '{reference,status,detail,trackingUrl}'
  ),
  (
    'vendor_acceptance',
    'Your Urban Tanker delivery team is assigned',
    E'Hello,\n\nA delivery team has been assigned to booking {{reference}}.\n\nVehicle: {{vehicle}}\nDriver: {{driver}}\n\nPlease keep your phone available and ensure the delivery location is accessible. Follow your delivery and review the booking details here:\n{{trackingUrl}}\n\n{{customerMapDetail}}\n\nContact Urban Tanker support if you need help with this booking.',
    '{reference,vehicle,driver,trackingUrl,customerMapDetail}'
  ),
  (
    'delivery_confirmation',
    'Your booking {{reference}} is complete',
    E'Hello,\n\nYour Urban Tanker delivery for booking {{reference}} has been marked complete.\n\nPlease check that your delivery is complete and contact our support team if anything needs attention. Thank you for choosing Urban Tanker; we appreciate your business.',
    '{reference}'
  )
on conflict (template_key) do nothing;
insert into public.email_templates (template_key, subject, body, variables) values
  ('user_registration_otp', 'Confirm your Urban Tanker registration', E'Hello,\n\nWelcome to Urban Tanker. Enter verification code {{otp}} to confirm your email address and complete your registration.\n\nThis code expires in 10 minutes. For your security, never share it with anyone. If you did not request this code, you can ignore this email.', '{otp}'),
  ('booking_pending_vendor', 'We received booking {{reference}}', E'Hello,\n\nWe have received booking {{reference}} and are finding a service partner for your request.\n\n{{detail}}\n\nThere is no action needed right now. We will email you again as soon as the booking moves to its next stage. You can check the latest information here:\n{{trackingUrl}}', '{reference,detail,trackingUrl}'),
  ('booking_vendor_assigned', 'A service partner has been assigned to booking {{reference}}', E'Hello,\n\nA service partner has been assigned to your Urban Tanker booking {{reference}}.\n\n{{detail}}\n\nPlease keep your phone available in case the service partner needs to reach you. View the booking and its latest details here:\n{{trackingUrl}}', '{reference,detail,trackingUrl}'),
  ('booking_accepted', 'Booking {{reference}} has been accepted', E'Hello,\n\nYour service partner has accepted booking {{reference}}.\n\n{{detail}}\n\nPlease make sure the delivery location is accessible at the scheduled time. You can review your booking here:\n{{trackingUrl}}', '{reference,detail,trackingUrl}'),
  ('booking_en_route', 'Your delivery is on the way - booking {{reference}}', E'Hello,\n\nThe tanker for booking {{reference}} is on its way to your delivery location.\n\n{{detail}}\n\nPlease ensure someone is available to receive the delivery. Follow the latest progress here:\n{{trackingUrl}}', '{reference,detail,trackingUrl}'),
  ('booking_arrived', 'Your tanker has arrived - booking {{reference}}', E'Hello,\n\nThe tanker for booking {{reference}} has arrived at the delivery location.\n\n{{detail}}\n\nPlease coordinate with the driver to complete your delivery. View the booking details here:\n{{trackingUrl}}', '{reference,detail,trackingUrl}'),
  ('booking_cancelled', 'Booking {{reference}} has been cancelled', E'Hello,\n\nBooking {{reference}} has been cancelled.\n\n{{detail}}\n\nIf you did not request this cancellation or need help with the booking, please contact Urban Tanker support. You can review the booking here:\n{{trackingUrl}}', '{reference,detail,trackingUrl}'),
  ('booking_payment_online', 'Payment received for booking {{reference}}', E'Hello,\n\nWe have received the online payment for booking {{reference}}.\n\n{{detail}}\n\nNo cash payment is due to the driver for this booking. View your booking and payment details here:\n{{trackingUrl}}', '{reference,detail,trackingUrl}'),
  ('booking_payment_cod', 'Payment method updated for booking {{reference}}', E'Hello,\n\nThe payment method for booking {{reference}} has been updated to cash on delivery.\n\n{{detail}}\n\nPlease pay the amount shown in your booking when the delivery is completed. Review the latest details here:\n{{trackingUrl}}', '{reference,detail,trackingUrl}'),
  ('booking_rescheduled', 'Booking {{reference}} has been rescheduled', E'Hello,\n\nThe schedule for booking {{reference}} has been changed.\n\n{{detail}}\n\nPlease check your booking for the latest delivery date and time, and contact support if the new schedule does not work for you:\n{{trackingUrl}}', '{reference,detail,trackingUrl}'),
  ('booking_delivered', 'Delivery completed for booking {{reference}}', E'Hello,\n\nThe delivery for booking {{reference}} has been marked complete.\n\n{{detail}}\n\nPlease check that your delivery is complete and contact Urban Tanker support if you need assistance. Thank you for choosing Urban Tanker.\n{{trackingUrl}}', '{reference,detail,trackingUrl}'),
  ('vendor_application_approved', 'Your Urban Tanker partner application is approved', E'Hello {{businessName}},\n\nWe are pleased to let you know that your Urban Tanker partner application (reference {{reference}}) has been approved.\n\nOur team will share the next steps for onboarding and account setup. Please keep this reference for your records. We look forward to working with you.', '{businessName,reference}'),
  ('vendor_application_rejected', 'Update on your Urban Tanker partner application', E'Hello {{businessName}},\n\nWe have completed our review of your Urban Tanker partner application (reference {{reference}}). We are unable to approve the application at this time.\n\nReview details: {{reviewNote}}\n\nIf you would like clarification or believe additional information may help, please contact our partnerships team and include your application reference.', '{businessName,reference,reviewNote}'),
  ('vendor_account_approved', 'Your Urban Tanker vendor account is approved', E'Hello {{name}},\n\nYour Urban Tanker vendor account has been approved. You can now sign in and continue with vendor onboarding:\n{{loginUrl}}\n\nPlease keep your account credentials secure. Contact support if you need assistance.', '{name,loginUrl}'),
  ('vendor_account_rejected', 'Update on your Urban Tanker vendor account', E'Hello {{name}},\n\nWe have reviewed your Urban Tanker vendor account and are unable to approve it at this time.\n\nPlease contact Urban Tanker support if you need clarification or believe further information should be considered.', '{name}'),
  ('vendor_profile_approved', 'Your Urban Tanker vendor profile is approved', E'Hello {{businessName}},\n\nYour Urban Tanker vendor profile has been approved. You can now sign in to manage your business profile and continue onboarding:\n{{loginUrl}}\n\nPlease keep your contact and service details up to date. Contact support if you need assistance.', '{businessName,loginUrl}'),
  ('vendor_profile_rejected', 'Update on your Urban Tanker vendor profile', E'Hello {{businessName}},\n\nWe have reviewed your Urban Tanker vendor profile and are unable to approve it at this time.\n\nPlease contact Urban Tanker support if you need clarification or would like to provide additional information.', '{businessName}')
on conflict (template_key) do nothing;
alter table public.ratings drop constraint if exists ratings_customer_id_fkey;
alter table public.ratings add constraint ratings_customer_id_fkey foreign key (customer_id) references public.profiles(id) on delete set null;
alter table public.complaints drop constraint if exists complaints_customer_id_fkey;
alter table public.complaints add constraint complaints_customer_id_fkey foreign key (customer_id) references public.profiles(id) on delete set null;
alter table public.notifications drop constraint if exists notifications_recipient_id_fkey;
alter table public.notifications add constraint notifications_recipient_id_fkey foreign key (recipient_id) references public.profiles(id) on delete cascade;
alter table public.audit_logs drop constraint if exists audit_logs_actor_id_fkey;
alter table public.audit_logs add constraint audit_logs_actor_id_fkey foreign key (actor_id) references public.profiles(id) on delete set null;
alter table public.booking_events drop constraint if exists booking_events_actor_id_fkey;
alter table public.booking_events add constraint booking_events_actor_id_fkey foreign key (actor_id) references public.profiles(id) on delete set null;
alter table public.dispatcher_alerts drop constraint if exists dispatcher_alerts_resolved_by_fkey;
alter table public.dispatcher_alerts add constraint dispatcher_alerts_resolved_by_fkey foreign key (resolved_by) references public.profiles(id) on delete set null;
alter table public.vendors drop constraint if exists vendors_owner_profile_id_fkey;
alter table public.vendors add constraint vendors_owner_profile_id_fkey foreign key (owner_profile_id) references public.profiles(id) on delete set null;

-- Enforce RLS on every application table. Tables without an explicit policy remain deny-by-default.
insert into public.configs (key, value)
values
  ('maintenance_mode', 'false'::jsonb),
  ('cash_on_delivery_enabled', 'true'::jsonb),
  ('guest_booking_enabled', 'true'::jsonb),
  ('live_tracking_enabled', 'true'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

-- ===== Email one-time codes (sign-in, sign-up confirmation, linking an email to a phone account) =====

create table if not exists public.email_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null check (purpose in ('sign_in', 'signup', 'link', 'booking')),
  user_id uuid,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0 check (attempts between 0 and 100),
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists email_otp_challenges_email_created_idx
  on public.email_otp_challenges(email, created_at desc);

-- Atomic email OTP attempt. Returns the stored hash, purpose, and user only while the challenge is
-- open, unverified, unexpired, under 5 attempts, and matches the email and an allowed purpose.
-- An empty result means invalid, expired, or exhausted. The caller must not reveal which condition failed.
create or replace function public.consume_email_otp_attempt(
  p_challenge_id uuid,
  p_email text,
  p_purposes text[]
)
returns table(otp_hash text, purpose text, user_id uuid)
language sql
set search_path = public
as $$
  update public.email_otp_challenges
  set attempts = attempts + 1
  where id = p_challenge_id
    and email = p_email
    and purpose = any(p_purposes)
    and verified_at is null
    and attempts < 5
    and expires_at > now()
  returning email_otp_challenges.otp_hash, email_otp_challenges.purpose, email_otp_challenges.user_id;
$$;

-- Looks up an auth user by email without listing every user. Service role only.
create or replace function public.auth_user_by_email(p_email text)
returns table(id uuid, email_confirmed boolean)
language sql
security definer
set search_path = public, auth
as $$
  select u.id, (u.email_confirmed_at is not null) as email_confirmed
  from auth.users u
  where lower(u.email) = lower(p_email)
  limit 1;
$$;

do $$
declare
  table_name text;
begin
  for table_name in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

-- C-03: only service_role may execute functions in public. Covers every function in this
-- script, including trigger functions, so no function is reachable through PostgREST /rpc by anon or authenticated.
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

-- ===== Admin sign-up approval (additive) =====
-- Admin accounts created from the public sign-up stay 'pending' until an existing admin approves them.
alter table public.profiles add column if not exists approval_status text not null default 'approved';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_approval_status_check' and conrelid = 'public.profiles'::regclass) then
    alter table public.profiles
      add constraint profiles_approval_status_check
      check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

-- ===== Multi-service tasks and invoice generation =====
alter table public.bookings
  add column if not exists order_group_id uuid,
  add column if not exists order_group_reference text,
  add column if not exists order_group_size integer;

create index if not exists bookings_order_group_idx
  on public.bookings(order_group_id, created_at)
  where order_group_id is not null;

create or replace function public.create_customer_bookings(
  p_bookings jsonb,
  p_notifications jsonb,
  p_payment jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
  v_booking public.bookings;
  v_existing public.bookings;
  v_rows jsonb := '[]'::jsonb;
  v_created boolean := false;
  v_task_count integer;
  v_task_index integer := 0;
  v_customer_id uuid;
  v_idempotency_key uuid;
begin
  if jsonb_typeof(p_bookings) <> 'array' then
    raise exception 'p_bookings must be a JSON array';
  end if;

  v_task_count := jsonb_array_length(p_bookings);
  if v_task_count < 2 or v_task_count > 20 then
    raise exception 'multi-service orders must contain between 2 and 20 tasks';
  end if;

  for v_task in select value from jsonb_array_elements(p_bookings)
  loop
    v_task_index := v_task_index + 1;
    v_customer_id := (v_task->>'customer_id')::uuid;
    v_idempotency_key := case
      when v_task_index = 1 then nullif(v_task->>'idempotency_key', '')::uuid
      else null
    end;

    insert into public.bookings (
      reference, customer_id, idempotency_key, vendor_id, service_code,
      capacity_litres, scheduled_for, address_text, latitude, longitude,
      access_notes, service_details, quoted_amount_paise, payment_method,
      customer_phone_e164, order_group_id, order_group_reference, order_group_size
    )
    values (
      v_task->>'reference', v_customer_id, v_idempotency_key,
      nullif(v_task->>'vendor_id', '')::uuid, v_task->>'service_code',
      nullif(v_task->>'capacity_litres', '')::integer,
      nullif(v_task->>'scheduled_for', '')::timestamptz,
      v_task->>'address_text', nullif(v_task->>'latitude', '')::numeric,
      nullif(v_task->>'longitude', '')::numeric, v_task->>'access_notes',
      coalesce(v_task->'service_details', '[]'::jsonb),
      coalesce(nullif(v_task->>'quoted_amount_paise', '')::integer, 0),
      coalesce(v_task->>'payment_method', 'wallet'),
      nullif(v_task->>'customer_phone_e164', ''),
      (v_task->>'order_group_id')::uuid, v_task->>'order_group_reference',
      v_task_count
    )
    on conflict (customer_id, idempotency_key)
      where idempotency_key is not null do nothing
    returning * into v_booking;

    if not found then
      select * into v_existing
      from public.bookings
      where customer_id = v_customer_id
        and idempotency_key = v_idempotency_key;

      if not found then
        raise exception 'idempotent booking could not be loaded';
      end if;

      if v_existing.order_group_id is not null then
        select coalesce(jsonb_agg(to_jsonb(grouped) order by grouped.created_at, grouped.reference), '[]'::jsonb)
          into v_rows
        from public.bookings as grouped
        where grouped.order_group_id = v_existing.order_group_id
          and grouped.customer_id = v_customer_id;
      else
        v_rows := jsonb_build_array(to_jsonb(v_existing));
      end if;

      return jsonb_build_object('bookings', v_rows, 'created', false);
    end if;

    v_created := true;
    v_rows := v_rows || jsonb_build_array(to_jsonb(v_booking));
  end loop;

  if p_payment is not null then
    insert into public.payments (booking_id, provider, amount_paise, currency, status)
    values (
      (v_rows->0->>'id')::uuid, p_payment->>'provider',
      (p_payment->>'amount_paise')::integer,
      coalesce(p_payment->>'currency', 'INR'),
      coalesce(p_payment->>'status', 'pending')
    );
  end if;

  for v_task in select value from jsonb_array_elements(v_rows)
  loop
    insert into public.notifications (recipient_id, event_type, title, payload)
    select n.recipient_id, n.event_type, n.title,
      coalesce(n.payload, '{}'::jsonb) || jsonb_build_object(
        'bookingId', v_task->>'id',
        'reference', v_task->>'reference',
        'orderGroupId', v_task->>'order_group_id',
        'orderGroupReference', v_task->>'order_group_reference',
        'taskCount', nullif(v_task->>'order_group_size', '')::integer
      )
    from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb))
      as n(recipient_id uuid, event_type text, title text, payload jsonb);
  end loop;

  return jsonb_build_object('bookings', v_rows, 'created', v_created);
end;
$$;

revoke all on function public.create_customer_bookings(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_customer_bookings(jsonb, jsonb, jsonb)
  to service_role;

create or replace function public.cancel_customer_unpaid_order(
  p_booking_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_created_at timestamptz;
  v_booking_ids uuid[];
begin
  select order_group_id, created_at
    into v_group_id, v_created_at
  from public.bookings
  where id = p_booking_id and customer_id = p_customer_id
  for update;

  if not found then
    return jsonb_build_object('deleted', false, 'reason', 'not_found');
  end if;

  perform id
  from public.bookings
  where customer_id = p_customer_id
    and (id = p_booking_id or (v_group_id is not null and order_group_id = v_group_id))
  order by id
  for update;

  select array_agg(id)
    into v_booking_ids
  from public.bookings
  where customer_id = p_customer_id
    and (id = p_booking_id or (v_group_id is not null and order_group_id = v_group_id));

  if exists (
    select 1 from public.bookings
    where id = any(v_booking_ids)
      and (payment_method <> 'gateway' or status not in ('pending_vendor', 'vendor_assigned'))
  ) then
    return jsonb_build_object('deleted', false, 'reason', 'status');
  end if;

  if exists (
    select 1 from public.payments
    where booking_id = any(v_booking_ids) and status = 'paid'
  ) then
    return jsonb_build_object('deleted', false, 'reason', 'paid');
  end if;

  delete from public.payments
  where booking_id = any(v_booking_ids) and status <> 'paid';

  delete from public.bookings where id = any(v_booking_ids);

  return jsonb_build_object('deleted', true, 'created_at', v_created_at);
end;
$$;

revoke all on function public.cancel_customer_unpaid_order(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_customer_unpaid_order(uuid, uuid)
  to service_role;

alter table public.invoices
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists subtotal_paise integer not null default 0 check (subtotal_paise >= 0),
  add column if not exists tax_paise integer not null default 0 check (tax_paise >= 0),
  add column if not exists tax_rate numeric not null default 0 check (tax_rate >= 0),
  add column if not exists discount_paise integer not null default 0 check (discount_paise >= 0),
  add column if not exists total_paise integer not null default 0 check (total_paise >= 0),
  add column if not exists payment_method text,
  add column if not exists payment_status text not null default 'paid',
  add column if not exists paid_at timestamptz;

create unique index if not exists invoices_booking_id_unique_idx
  on public.invoices (booking_id);

notify pgrst, 'reload schema';

commit;

-- Additive migration for structured public service enquiries and an append-only status history.
begin;

alter table public.enquiries
  add column if not exists customer_name text,
  add column if not exists mobile_e164 text,
  add column if not exists email text,
  add column if not exists location text,
  add column if not exists service_category text,
  add column if not exists required_date date,
  add column if not exists service_details jsonb not null default '{}'::jsonb,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'enquiries_service_category_check'
      and conrelid = 'public.enquiries'::regclass
  ) then
    alter table public.enquiries
      add constraint enquiries_service_category_check
      check (service_category is null or service_category in ('empty_tanker', 'rmc', 'borewell'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'enquiries_mobile_e164_check'
      and conrelid = 'public.enquiries'::regclass
  ) then
    alter table public.enquiries
      add constraint enquiries_mobile_e164_check
      check (mobile_e164 is null or mobile_e164 ~ '^\+91[6-9][0-9]{9}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'enquiries_service_details_object_check'
      and conrelid = 'public.enquiries'::regclass
  ) then
    alter table public.enquiries
      add constraint enquiries_service_details_object_check
      check (jsonb_typeof(service_details) = 'object');
  end if;
end;
$$;

create index if not exists enquiries_category_status_created_idx
  on public.enquiries(service_category, status, created_at desc);

create table if not exists public.enquiry_history (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_type text not null check (actor_type in ('public', 'customer', 'admin', 'system')),
  action text not null check (action in ('submitted', 'updated')),
  old_status text,
  new_status text,
  response text,
  created_at timestamptz not null default now()
);

create index if not exists enquiry_history_enquiry_created_idx
  on public.enquiry_history(enquiry_id, created_at);

alter table public.enquiry_history enable row level security;
revoke all on public.enquiry_history from public, anon, authenticated;
grant select, insert on public.enquiry_history to service_role;

create or replace function public.record_enquiry_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.enquiry_history (
      enquiry_id, actor_id, actor_type, action, new_status, response
    ) values (
      new.id,
      new.customer_id,
      case when new.customer_id is null then 'public' else 'customer' end,
      'submitted',
      new.status,
      new.response
    );
  elsif old.status is distinct from new.status
     or old.response is distinct from new.response then
    insert into public.enquiry_history (
      enquiry_id, actor_id, actor_type, action, old_status, new_status, response
    ) values (
      new.id,
      new.updated_by,
      case when new.updated_by is null then 'system' else 'admin' end,
      'updated',
      old.status,
      new.status,
      new.response
    );
  end if;
  return new;
end;
$$;

revoke all on function public.record_enquiry_history() from public, anon, authenticated;

drop trigger if exists enquiries_history on public.enquiries;
create trigger enquiries_history
  after insert or update of status, response on public.enquiries
  for each row execute function public.record_enquiry_history();

commit;

-- Store each vehicle's onboarding details without rewriting existing application records.
begin;

alter table public.partner_applications
  add column if not exists vehicle_details jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (
    select phone_e164
    from public.partner_applications
    where status in ('submitted', 'under_review', 'additional_info_required', 'approved')
    group by phone_e164
    having count(*) > 1
  ) then
    raise exception 'Duplicate active partner applications exist; resolve them before applying the active-phone constraint.';
  end if;
end $$;

create unique index if not exists partner_applications_active_phone_uidx
  on public.partner_applications(phone_e164)
  where status in ('submitted', 'under_review', 'additional_info_required', 'approved');

alter table public.partner_applications
  drop constraint if exists partner_applications_status_check;

alter table public.partner_applications
  add constraint partner_applications_status_check
  check (status in ('submitted', 'under_review', 'additional_info_required', 'approved', 'rejected'));

create table if not exists public.partner_application_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_type text not null check (actor_type in ('public', 'admin', 'system')),
  action text not null check (action in ('submitted', 'reviewed')),
  old_status text,
  new_status text not null,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists partner_application_history_created_idx
  on public.partner_application_history(application_id, created_at);

alter table public.partner_application_history enable row level security;
revoke all on public.partner_application_history from public, anon, authenticated;
grant select, insert on public.partner_application_history to service_role;

create or replace function public.record_partner_application_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.partner_application_history (
      application_id, actor_type, action, new_status, review_note
    ) values (
      new.id, 'public', 'submitted', new.status, new.review_note
    );
  elsif old.status is distinct from new.status
     or old.review_note is distinct from new.review_note then
    insert into public.partner_application_history (
      application_id, actor_id, actor_type, action, old_status, new_status, review_note
    ) values (
      new.id,
      new.reviewed_by,
      case when new.reviewed_by is null then 'system' else 'admin' end,
      'reviewed',
      old.status,
      new.status,
      new.review_note
    );
  end if;
  return new;
end;
$$;

revoke all on function public.record_partner_application_history() from public, anon, authenticated;

drop trigger if exists partner_applications_history on public.partner_applications;
create trigger partner_applications_history
  after insert or update of status, review_note on public.partner_applications
  for each row execute function public.record_partner_application_history();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'partner_applications_vehicle_details_array_check'
      and conrelid = 'public.partner_applications'::regclass
  ) then
    alter table public.partner_applications
      add constraint partner_applications_vehicle_details_array_check
      check (jsonb_typeof(vehicle_details) = 'array');
  end if;
end $$;

commit;

begin;

alter table public.service_catalog
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

create table if not exists public.service_pricing_history (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service_catalog(id) on delete restrict,
  service_code text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('created', 'updated')),
  old_base_price_paise integer,
  new_base_price_paise integer not null check (new_base_price_paise >= 0),
  old_config jsonb,
  new_config jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists service_pricing_history_service_created_idx
  on public.service_pricing_history(service_id, created_at desc);

alter table public.service_pricing_history enable row level security;
revoke all on public.service_pricing_history from public, anon, authenticated;
grant select on public.service_pricing_history to service_role;

create or replace function public.record_service_pricing_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.service_pricing_history (
      service_id, service_code, changed_by, action,
      new_base_price_paise, new_config
    ) values (
      new.id, new.code, new.updated_by, 'created',
      new.base_price_paise, coalesce(new.config, '{}'::jsonb)
    );
  else
    insert into public.service_pricing_history (
      service_id, service_code, changed_by, action,
      old_base_price_paise, new_base_price_paise, old_config, new_config
    ) values (
      new.id, new.code, new.updated_by, 'updated',
      old.base_price_paise, new.base_price_paise,
      coalesce(old.config, '{}'::jsonb), coalesce(new.config, '{}'::jsonb)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.record_service_pricing_history() from public, anon, authenticated;

drop trigger if exists service_catalog_pricing_history_insert on public.service_catalog;
create trigger service_catalog_pricing_history_insert
  after insert on public.service_catalog
  for each row execute function public.record_service_pricing_history();

drop trigger if exists service_catalog_pricing_history_update on public.service_catalog;
create trigger service_catalog_pricing_history_update
  after update of base_price_paise, config on public.service_catalog
  for each row
  when (
    old.base_price_paise is distinct from new.base_price_paise
    or old.config is distinct from new.config
  )
  execute function public.record_service_pricing_history();

commit;


-- ===== Feature 2 multi-service orders (canonical fresh-install schema) =====
-- Feature 2: normalized parent orders, service items and vendor fulfilments.
-- Deploy the backend with the feature disabled, then apply before enabling; this migration is additive.
begin;
create table if not exists public.service_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique references public.service_catalog(code) on update cascade on delete restrict,
  name text not null,
  active boolean not null default true,
  min_quantity numeric(12, 3) not null default 1 check (min_quantity > 0),
  max_quantity numeric(12, 3) not null default 20 check (max_quantity >= min_quantity),
  quantity_unit text not null default 'service',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.service_types (code, name, active, min_quantity, max_quantity, quantity_unit)
select code, name, is_active,
  coalesce(nullif(config->>'min_quantity','')::numeric,1),
  coalesce(nullif(config->>'max_quantity','')::numeric,20),
  coalesce(nullif(config->>'quantity_unit', ''), nullif(config->>'unit',''), 'service')
from public.service_catalog
on conflict (code) do update set name = excluded.name, active = excluded.active;

create or replace function public.sync_catalog_service_type()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.service_types(code,name,active,min_quantity,max_quantity,quantity_unit,updated_at)
  values(new.code,new.name,new.is_active,
    coalesce(nullif(new.config->>'min_quantity','')::numeric,1),
    coalesce(nullif(new.config->>'max_quantity','')::numeric,20),
    coalesce(nullif(new.config->>'quantity_unit',''),nullif(new.config->>'unit',''),'service'),
    now())
  on conflict(code) do update set name=excluded.name,active=excluded.active,
    min_quantity=excluded.min_quantity,max_quantity=excluded.max_quantity,quantity_unit=excluded.quantity_unit,updated_at=now();
  return new;
end $$;
drop trigger if exists service_catalog_service_type_sync on public.service_catalog;
create trigger service_catalog_service_type_sync after insert or update of name,is_active,config on public.service_catalog
for each row execute function public.sync_catalog_service_type();

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  customer_id uuid references public.profiles(id) on delete set null,
  legacy_booking_id uuid unique references public.bookings(id) on delete set null,
  legacy_group_key text unique,
  idempotency_key uuid,
  payment_method text not null check (payment_method in ('wallet','gateway','cod')),
  status text not null default 'pending_vendor'
    check (status in ('pending_vendor','partially_accepted','accepted','in_progress','partially_completed','completed','cancelled')),
  total_paise integer not null check (total_paise >= 0),
  currency char(3) not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, idempotency_key)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  service_type_id uuid not null references public.service_types(id) on delete restrict,
  legacy_booking_id uuid references public.bookings(id) on delete set null,
  legacy_item_key text unique,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  quantity_unit text not null default 'service',
  location text not null,
  latitude numeric(9,6),
  longitude numeric(9,6),
  scheduled_for timestamptz,
  slot text,
  service_details jsonb not null default '{}'::jsonb,
  locked_price_paise integer not null check (locked_price_paise >= 0),
  delivery_charge_paise integer not null default 0 check (delivery_charge_paise >= 0),
  discount_paise integer not null default 0 check (discount_paise >= 0),
  status text not null default 'pending_vendor'
    check (status in ('pending_vendor','offered','accepted','en_route','arrived','delivered','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);
create index if not exists order_items_order_status_idx on public.order_items(order_id, status);
create index if not exists order_items_schedule_idx on public.order_items(scheduled_for) where status = 'pending_vendor';

create table if not exists public.order_fulfilments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  legacy_booking_id uuid references public.bookings(id) on delete set null,
  reference text not null unique,
  vendor_id uuid references public.vendors(id) on delete set null,
  status text not null default 'pending_vendor'
    check (status in ('pending_vendor','offered','accepted','en_route','arrived','delivered','cancelled')),
  delivery_otp_hash text,
  delivery_otp_expires_at timestamptz,
  delivery_otp_attempts integer not null default 0 check (delivery_otp_attempts between 0 and 5),
  delivery_otp_locked_at timestamptz,
  delivery_otp_sms_sent boolean,
  delivery_otp_requests integer not null default 0 check (delivery_otp_requests between 0 and 100),
  delivery_otp_last_requested_at timestamptz,
  latitude numeric(9,6),
  longitude numeric(9,6),
  delivered_at timestamptz,
  offer_expires_at timestamptz,
  commission_paise integer not null default 0 check (commission_paise >= 0),
  vendor_payout_paise integer not null default 0 check (vendor_payout_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_fulfilments_vendor_status_idx on public.order_fulfilments(vendor_id, status);
create index if not exists order_fulfilments_unassigned_idx on public.order_fulfilments(status, created_at) where vendor_id is null;

create table if not exists public.order_fulfilment_items (
  fulfilment_id uuid not null references public.order_fulfilments(id) on delete cascade,
  item_id uuid not null references public.order_items(id) on delete cascade,
  primary key (fulfilment_id, item_id),
  unique (item_id)
);

create table if not exists public.vendor_services (
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  service_type_id uuid not null references public.service_types(id) on delete cascade,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (vendor_id, service_type_id)
);
insert into public.vendor_services (vendor_id, service_type_id, active)
select availability.vendor_id, service_type.id, availability.is_enabled
from public.vendor_service_availability availability
join public.service_types service_type on service_type.code = availability.service_code
on conflict (vendor_id, service_type_id) do update set active = excluded.active;
insert into public.vendor_services (vendor_id, service_type_id, active)
select v.id, st.id, true
from public.vendors v cross join public.service_types st
where not exists (
  select 1 from public.vendor_service_availability a
  where a.vendor_id = v.id and a.service_code = st.code
)
on conflict (vendor_id, service_type_id) do nothing;

create or replace function public.sync_vendor_service_type_availability()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.vendor_services(vendor_id,service_type_id,active,updated_at)
  select new.vendor_id,st.id,new.is_enabled,now() from public.service_types st where st.code=new.service_code
  on conflict(vendor_id,service_type_id) do update set active=excluded.active,updated_at=now();
  return new;
end $$;
drop trigger if exists vendor_service_types_sync on public.vendor_service_availability;
create trigger vendor_service_types_sync after insert or update of is_enabled on public.vendor_service_availability
for each row execute function public.sync_vendor_service_type_availability();

create or replace function public.seed_vendor_service_types()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.vendor_services(vendor_id,service_type_id,active)
  select new.id,st.id,true from public.service_types st
  on conflict(vendor_id,service_type_id) do nothing;
  return new;
end $$;
drop trigger if exists vendors_seed_service_types on public.vendors;
create trigger vendors_seed_service_types after insert on public.vendors
for each row execute function public.seed_vendor_service_types();
create or replace function public.seed_service_type_vendor_capabilities()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.vendor_services(vendor_id,service_type_id,active)
  select v.id,new.id,true from public.vendors v
  on conflict(vendor_id,service_type_id) do nothing;
  return new;
end $$;
drop trigger if exists service_types_seed_vendor_capabilities on public.service_types;
create trigger service_types_seed_vendor_capabilities after insert on public.service_types
for each row execute function public.seed_service_type_vendor_capabilities();

create table if not exists public.order_offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  fulfilment_id uuid references public.order_fulfilments(id) on delete cascade,
  offer_scope_id uuid not null,
  item_ids uuid[] not null,
  is_bundle boolean not null default false,
  status text not null default 'offered' check (status in ('offered','accepted','expired','declined','taken','cancelled')),
  expires_at timestamptz not null,
  availability_snapshot jsonb not null default '{}'::jsonb,
  bundle_priority_at timestamptz,
  distance_km numeric(8,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, vendor_id, is_bundle, offer_scope_id)
);
create index if not exists order_offers_expiry_idx on public.order_offers(expires_at) where status = 'offered';
create index if not exists order_offers_vendor_idx on public.order_offers(vendor_id, status, created_at desc);

create table if not exists public.order_fulfilment_ratings (
  id uuid primary key default gen_random_uuid(),
  fulfilment_id uuid not null references public.order_fulfilments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.profiles(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  review text,
  created_at timestamptz not null default now(),
  unique (fulfilment_id, customer_id)
);

create table if not exists public.order_fulfilment_ledger (
  id uuid primary key default gen_random_uuid(),
  fulfilment_id uuid not null unique references public.order_fulfilments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete set null,
  gross_paise integer not null check (gross_paise >= 0),
  commission_paise integer not null check (commission_paise >= 0),
  payout_paise integer not null check (payout_paise >= 0),
  settled_payout_id uuid references public.vendor_payouts(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id uuid not null references public.order_items(id) on delete cascade,
  idempotency_key uuid not null,
  amount_paise integer not null check (amount_paise > 0),
  provider_refund_id text,
  status text not null default 'pending' check (status in ('pending','processed','failed')),
  created_at timestamptz not null default now(),
  unique (order_id, idempotency_key),
  unique (item_id)
);

create table if not exists public.order_admin_audit (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  fulfilment_id uuid references public.order_fulfilments(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.invoices add column if not exists order_id uuid references public.orders(id) on delete set null;
alter table public.invoices add column if not exists fulfilment_id uuid references public.order_fulfilments(id) on delete set null;
create unique index if not exists invoices_fulfilment_unique_idx on public.invoices(fulfilment_id) where fulfilment_id is not null;

-- Backfill one parent per legacy booking/group and preserve service details as individual lines.
do $$
declare
  booking_row record;
  parent_id uuid;
  parent_reference text;
  item_row record;
  item_id uuid;
  service_code_value text;
  item_index integer;
begin
  for booking_row in
    select b.*,
      coalesce(b.order_group_id, b.id) as normalized_id,
      coalesce(b.order_group_reference, b.reference) as normalized_reference,
      coalesce(b.order_group_id::text, b.id::text) as normalized_group_key
    from public.bookings b
    order by b.created_at, b.id
  loop
    parent_id := booking_row.normalized_id;
    parent_reference := booking_row.normalized_reference;
    insert into public.orders (
      id, reference, customer_id, legacy_booking_id, legacy_group_key,
      idempotency_key, payment_method, status, total_paise, created_at, updated_at
    ) values (
      parent_id, parent_reference, booking_row.customer_id, booking_row.id,
      booking_row.normalized_group_key, booking_row.idempotency_key,
      coalesce(booking_row.payment_method, 'cod'),
      case when booking_row.status = 'delivered' then 'completed'
           when booking_row.status = 'cancelled' then 'cancelled'
           when booking_row.status in ('accepted','en_route','arrived') then 'in_progress'
           else 'pending_vendor' end,
      case when booking_row.order_group_id is null then booking_row.quoted_amount_paise else 0 end,
      booking_row.created_at, booking_row.updated_at
    ) on conflict (id) do nothing;
    if booking_row.order_group_id is not null then
      update public.orders o set total_paise = (
        select coalesce(sum(b.quoted_amount_paise), 0)::integer from public.bookings b
        where b.order_group_id = booking_row.order_group_id
      ) where o.id = parent_id;
    end if;
    item_index := 0;
    if jsonb_typeof(booking_row.service_details) = 'array' and jsonb_array_length(booking_row.service_details) > 0 then
      for item_row in select value from jsonb_array_elements(booking_row.service_details)
      loop
        item_index := item_index + 1;
        service_code_value := coalesce(item_row.value->>'serviceId', booking_row.service_code);
        insert into public.service_types (code, name, active)
        select c.code, c.name, c.is_active from public.service_catalog c where c.code = service_code_value
        on conflict (code) do nothing;
        select st.id into item_id from public.service_types st where st.code = service_code_value;
        if item_id is not null and not exists (
          select 1 from public.order_items oi
          where oi.legacy_item_key = booking_row.id::text || ':' || item_index::text
        ) then
          insert into public.order_items (
            order_id, service_type_id, legacy_booking_id, legacy_item_key, quantity,
            quantity_unit, location, latitude, longitude, scheduled_for, slot,
            service_details, locked_price_paise, status, created_at, updated_at
          ) values (
            parent_id, item_id, booking_row.id, booking_row.id::text || ':' || item_index::text,
            1, 'service', coalesce(item_row.value->>'location', booking_row.address_text),
            coalesce((item_row.value->>'latitude')::numeric, booking_row.latitude),
            coalesce((item_row.value->>'longitude')::numeric, booking_row.longitude),
            booking_row.scheduled_for, item_row.value->>'preferredTime', item_row.value,
            coalesce(nullif(item_row.value->'invoice_line'->>'totalPaise','')::integer,
              case when item_index = 1 then booking_row.quoted_amount_paise else 0 end),
            case when booking_row.status = 'delivered' then 'delivered'
                 when booking_row.status = 'cancelled' then 'cancelled'
                 when booking_row.status in ('accepted','en_route','arrived') then booking_row.status::text
                 when booking_row.status = 'vendor_assigned' then 'accepted'
                 else 'pending_vendor' end,
            booking_row.created_at, booking_row.updated_at
          ) returning id into item_id;
          insert into public.order_fulfilments (id, order_id, legacy_booking_id, reference, vendor_id, status, delivered_at, created_at, updated_at)
          values (item_id, parent_id, booking_row.id, booking_row.reference || '-' || item_index, booking_row.vendor_id,
            case when booking_row.status = 'vendor_assigned' then 'accepted' else booking_row.status::text end,
            case when booking_row.status = 'delivered' then booking_row.updated_at else null end,
            booking_row.created_at, booking_row.updated_at)
          on conflict (id) do nothing;
          insert into public.order_fulfilment_items (fulfilment_id, item_id) values (item_id, item_id) on conflict do nothing;
        end if;
      end loop;
    else
      service_code_value := booking_row.service_code;
      select st.id into item_id from public.service_types st where st.code = service_code_value;
      if item_id is not null and not exists (select 1 from public.order_items oi where oi.legacy_item_key = booking_row.id::text || ':1') then
        insert into public.order_items (
          order_id, service_type_id, legacy_booking_id, legacy_item_key, location,
          latitude, longitude, scheduled_for, locked_price_paise, service_details, status,
          created_at, updated_at
        ) values (
          parent_id, item_id, booking_row.id, booking_row.id::text || ':1', booking_row.address_text,
          booking_row.latitude, booking_row.longitude, booking_row.scheduled_for,
          booking_row.quoted_amount_paise, coalesce(booking_row.service_details, '{}'::jsonb),
          case when booking_row.status = 'delivered' then 'delivered'
               when booking_row.status = 'cancelled' then 'cancelled'
               when booking_row.status in ('accepted','en_route','arrived') then booking_row.status::text
               when booking_row.status = 'vendor_assigned' then 'accepted'
               else 'pending_vendor' end,
          booking_row.created_at, booking_row.updated_at
        ) returning id into item_id;
        insert into public.order_fulfilments (id, order_id, legacy_booking_id, reference, vendor_id, status, delivered_at, created_at, updated_at)
        values (item_id, parent_id, booking_row.id, booking_row.reference, booking_row.vendor_id,
          case when booking_row.status = 'vendor_assigned' then 'accepted' else booking_row.status::text end,
          case when booking_row.status = 'delivered' then booking_row.updated_at else null end,
          booking_row.created_at, booking_row.updated_at)
        on conflict (id) do nothing;
        insert into public.order_fulfilment_items (fulfilment_id, item_id) values (item_id, item_id) on conflict do nothing;
      end if;
    end if;
  end loop;
end $$;

create or replace function public.refresh_multi_service_order_status(p_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
  v_open integer;
  v_done integer;
  v_accepted integer;
  v_next text;
begin
  select count(*), count(*) filter (where status not in ('delivered','cancelled')),
    count(*) filter (where status = 'delivered'), count(*) filter (where status in ('accepted','en_route','arrived'))
    into v_total, v_open, v_done, v_accepted from public.order_items where order_id = p_order_id;
  if v_total = 0 then v_next := 'pending_vendor';
  elsif v_open = 0 and v_done = 0 then v_next := 'cancelled';
  elsif v_open = 0 then v_next := 'completed';
  elsif v_done > 0 then v_next := 'partially_completed';
  elsif v_accepted = v_total then v_next := 'in_progress';
  elsif v_accepted > 0 then v_next := 'partially_accepted';
  else v_next := 'pending_vendor';
  end if;
  update public.orders set status = v_next, updated_at = now() where id = p_order_id;
  update public.bookings b set status = case
      when v_open = 0 and v_done = 0 then 'cancelled'::public.booking_status
      when v_open = 0 then 'delivered'::public.booking_status
      when exists (select 1 from public.order_items i where i.order_id=p_order_id and i.status='arrived') then 'arrived'::public.booking_status
      when exists (select 1 from public.order_items i where i.order_id=p_order_id and i.status='en_route') then 'en_route'::public.booking_status
      when v_accepted > 0 then 'accepted'::public.booking_status
      else 'pending_vendor'::public.booking_status end,
    updated_at=now()
    from public.orders o where o.id=p_order_id and b.id=o.legacy_booking_id;
  return v_next;
end $$;

create or replace function public.record_multi_service_delivery_invoices()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_fulfilment public.order_fulfilments%rowtype;
  v_order public.orders%rowtype;
  v_gross integer;
  v_payment_status text;
  v_service text;
  v_location text;
  v_all_delivered boolean;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;
  select f.* into v_fulfilment from public.order_fulfilment_items fi
    join public.order_fulfilments f on f.id=fi.fulfilment_id where fi.item_id=new.id;
  if not found then return new; end if;
  select o.* into v_order from public.orders o where o.id=v_fulfilment.order_id;
  select coalesce(sum(i.locked_price_paise+i.delivery_charge_paise-i.discount_paise),0)::integer,
    string_agg(st.name,', '), string_agg(distinct i.location,', ')
    into v_gross,v_service,v_location
    from public.order_fulfilment_items fi
    join public.order_items i on i.id=fi.item_id
    join public.service_types st on st.id=i.service_type_id
    where fi.fulfilment_id=v_fulfilment.id;
  select case when p.status='paid' then 'Paid' else 'Pending' end into v_payment_status
    from public.payments p where p.booking_id=v_order.legacy_booking_id;
  insert into public.invoices(number,customer_id,service,location,amount,status,order_id,fulfilment_id,
    subtotal_paise,total_paise,payment_method,payment_status)
  select 'INV-'||v_fulfilment.reference,v_order.customer_id,coalesce(v_service,'Service'),coalesce(v_location,''),
    v_gross/100.0,coalesce(v_payment_status,'Pending'),v_order.id,v_fulfilment.id,
    v_gross,v_gross,v_order.payment_method,lower(coalesce(v_payment_status,'Pending'))
  on conflict (fulfilment_id) where fulfilment_id is not null do update set
    amount=excluded.amount,status=excluded.status,total_paise=excluded.total_paise,payment_status=excluded.payment_status;
  select not exists(select 1 from public.order_items i where i.order_id=v_order.id and i.status<>'delivered')
    into v_all_delivered;
  if v_all_delivered then
    if v_order.payment_method='cod' then
      update public.payments set status='paid',captured_at=now(),updated_at=now()
        where booking_id=v_order.legacy_booking_id and provider='cash_on_delivery' and status='pending';
    end if;
    insert into public.invoices(number,customer_id,booking_id,service,location,amount,status,order_id,
      subtotal_paise,total_paise,payment_method,payment_status)
    select 'RCT-'||v_order.reference,v_order.customer_id,v_order.legacy_booking_id,
      coalesce(string_agg(st.name,', '),'Services'),coalesce(string_agg(distinct i.location,', '),''),
      v_order.total_paise/100.0,
      case when p.status='paid' or v_order.payment_method='cod' then 'Paid' else 'Pending' end,
      v_order.id,v_order.total_paise,v_order.total_paise,v_order.payment_method,
      case when p.status='paid' or v_order.payment_method='cod' then 'paid' else 'pending' end
    from public.order_items i join public.service_types st on st.id=i.service_type_id
    left join public.payments p on p.booking_id=v_order.legacy_booking_id
    where i.order_id=v_order.id
    group by p.status
    on conflict (booking_id) do update set
      amount=excluded.amount,status=excluded.status,total_paise=excluded.total_paise,payment_status=excluded.payment_status;
  end if;
  return new;
end $$;
drop trigger if exists order_item_delivery_invoice on public.order_items;
create trigger order_item_delivery_invoice after update of status on public.order_items
for each row execute function public.record_multi_service_delivery_invoices();

create or replace function public.sync_multi_service_invoice_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status and new.refunded_paise is not distinct from old.refunded_paise then return new; end if;
  update public.invoices i set
    status=case when new.status='refunded' or coalesce(new.refunded_paise,0)>=new.amount_paise then 'refunded'
      when coalesce(new.refunded_paise,0)>0 then 'partially_refunded'
      when new.status='paid' then 'Paid' else 'Pending' end,
    payment_status=case when new.status='refunded' or coalesce(new.refunded_paise,0)>=new.amount_paise then 'refunded'
      when coalesce(new.refunded_paise,0)>0 then 'partially_refunded'
      when new.status='paid' then 'paid' else 'pending' end,
    paid_at=case when new.status='paid' then coalesce(new.captured_at,now()) else paid_at end
  from public.orders o where o.legacy_booking_id=new.booking_id and i.order_id=o.id;
  return new;
end $$;
drop trigger if exists multi_service_payment_invoice_sync on public.payments;
create trigger multi_service_payment_invoice_sync after update of status,refunded_paise on public.payments
for each row execute function public.sync_multi_service_invoice_payment();

create or replace function public.create_multi_service_order(p_order jsonb, p_items jsonb, p_payment jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_booking_id uuid := gen_random_uuid();
  v_customer_id uuid := (p_order->>'customer_id')::uuid;
  v_reference text := p_order->>'reference';
  v_total integer := (p_order->>'total_paise')::integer;
  v_first jsonb;
  v_item jsonb;
  v_service record;
  v_item_id uuid;
  v_item_count integer := jsonb_array_length(p_items);
  v_existing public.orders%rowtype;
begin
  if v_item_count < 1 or v_item_count > 20 then raise exception 'INVALID_ITEM_COUNT'; end if;
  if p_order->>'idempotency_key' is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_customer_id::text || ':' || (p_order->>'idempotency_key'), 0));
    select * into v_existing from public.orders where customer_id = v_customer_id
      and idempotency_key = (p_order->>'idempotency_key')::uuid;
    if found then
      return jsonb_build_object('created', false, 'order', to_jsonb(v_existing), 'legacyBookingId', v_existing.legacy_booking_id);
    end if;
  end if;
  v_first := p_items->0;
  select * into v_service from public.service_types where code = v_first->>'service_code' and active;
  if not found then raise exception 'SERVICE_UNAVAILABLE'; end if;
  insert into public.bookings (
    id, reference, customer_id, idempotency_key, payment_method, service_code,
    service_details, address_text, latitude, longitude, scheduled_for, quoted_amount_paise, status,
    customer_phone_e164
  ) values (
    v_booking_id, v_reference, v_customer_id, nullif(p_order->>'idempotency_key','')::uuid,
    p_order->>'payment_method', v_first->>'service_code', p_order->'legacy_service_details',
    coalesce(v_first->>'location', p_order->>'location'),
    nullif(v_first->>'latitude','')::numeric, nullif(v_first->>'longitude','')::numeric,
    nullif(v_first->>'scheduled_for','')::timestamptz, v_total, 'pending_vendor',
    nullif(p_order->>'customer_phone_e164','')
  );
  insert into public.orders (id, reference, customer_id, legacy_booking_id, idempotency_key, payment_method, total_paise)
  values (v_order_id, v_reference, v_customer_id, v_booking_id,
    nullif(p_order->>'idempotency_key','')::uuid, p_order->>'payment_method', v_total);
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select * into v_service from public.service_types where code = v_item->>'service_code' and active;
    if not found then raise exception 'SERVICE_UNAVAILABLE'; end if;
    if (v_item->>'quantity')::numeric < v_service.min_quantity or (v_item->>'quantity')::numeric > v_service.max_quantity then
      raise exception 'INVALID_SERVICE_QUANTITY';
    end if;
    v_item_id := gen_random_uuid();
    insert into public.order_items (
      id, order_id, service_type_id, legacy_booking_id, quantity, quantity_unit, location, latitude, longitude,
      scheduled_for, slot, service_details, locked_price_paise, delivery_charge_paise, discount_paise
    ) values (
      v_item_id, v_order_id, v_service.id, v_booking_id, (v_item->>'quantity')::numeric,
      coalesce(nullif(v_item->>'quantity_unit',''), v_service.quantity_unit),
      v_item->>'location', nullif(v_item->>'latitude','')::numeric, nullif(v_item->>'longitude','')::numeric,
      nullif(v_item->>'scheduled_for','')::timestamptz, v_item->>'slot',
      coalesce(v_item->'service_details','{}'::jsonb), (v_item->>'locked_price_paise')::integer,
      coalesce((v_item->>'delivery_charge_paise')::integer,0), coalesce((v_item->>'discount_paise')::integer,0)
    );
    insert into public.order_fulfilments (id, order_id, legacy_booking_id, reference)
    values (v_item_id, v_order_id, v_booking_id, v_reference || '-' || substr(replace(v_item_id::text,'-',''),1,8));
    insert into public.order_fulfilment_items (fulfilment_id, item_id) values (v_item_id, v_item_id);
  end loop;
  if p_payment is not null then
    insert into public.payments (booking_id, provider, amount_paise, currency, status)
    values (v_booking_id, p_payment->>'provider', v_total, 'INR', coalesce(p_payment->>'status','pending'))
    on conflict (booking_id) do nothing;
  end if;
  return jsonb_build_object('created', true, 'order', (select to_jsonb(o) from public.orders o where o.id = v_order_id), 'legacyBookingId', v_booking_id);
end $$;

create or replace function public.accept_multi_service_offer(p_offer_id uuid, p_vendor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offer public.order_offers%rowtype;
  v_item_id uuid;
  v_count integer := 0;
  v_expected integer;
  v_state text;
begin
  select * into v_offer from public.order_offers where id = p_offer_id for update;
  if not found then return jsonb_build_object('accepted',false,'reason','not_found'); end if;
  if v_offer.vendor_id <> p_vendor_id then return jsonb_build_object('accepted',false,'reason','not_found'); end if;
  if v_offer.status = 'accepted' then return jsonb_build_object('accepted',true,'idempotent',true,'orderId',v_offer.order_id); end if;
  if v_offer.status <> 'offered' or v_offer.expires_at <= now() then
    update public.order_offers set status = 'expired', updated_at = now() where id = v_offer.id and status = 'offered';
    return jsonb_build_object('accepted',false,'reason','expired');
  end if;
  if not exists (select 1 from public.vendors v where v.id = p_vendor_id and v.is_online and v.verification = 'approved') then
    return jsonb_build_object('accepted',false,'reason','vendor_unavailable');
  end if;
  if v_offer.is_bundle then
    select count(*) into v_expected from public.order_items where order_id = v_offer.order_id and status not in ('delivered','cancelled');
    if v_expected <> cardinality(v_offer.item_ids) then return jsonb_build_object('accepted',false,'reason','items_taken'); end if;
  end if;
  for v_item_id in select unnest(v_offer.item_ids) order by 1
  loop
    perform 1 from public.order_items where id = v_item_id and order_id = v_offer.order_id and status in ('pending_vendor','offered') for update;
    if not found then return jsonb_build_object('accepted',false,'reason','items_taken'); end if;
    if not exists (
      select 1 from public.order_fulfilment_items fi
      join public.order_fulfilments f on f.id = fi.fulfilment_id
      join public.order_items i on i.id = fi.item_id
      join public.vendor_services vs on vs.service_type_id = i.service_type_id and vs.vendor_id = p_vendor_id and vs.active
      where fi.item_id = v_item_id and f.order_id = v_offer.order_id
    ) then return jsonb_build_object('accepted',false,'reason','service_not_supported'); end if;
    v_count := v_count + 1;
  end loop;
  update public.order_items set status = 'accepted', updated_at = now() where id = any(v_offer.item_ids);
  update public.order_fulfilments f set vendor_id = p_vendor_id, status = 'accepted', updated_at = now()
  from public.order_fulfilment_items fi where fi.fulfilment_id = f.id and fi.item_id = any(v_offer.item_ids);
  update public.order_offers set status = 'accepted', updated_at = now() where id = v_offer.id;
  update public.order_offers set status = 'taken', updated_at = now()
    where order_id = v_offer.order_id and id <> v_offer.id and status = 'offered' and item_ids && v_offer.item_ids;
  v_state := public.refresh_multi_service_order_status(v_offer.order_id);
  return jsonb_build_object('accepted',true,'idempotent',false,'orderId',v_offer.order_id,'itemsAccepted',v_count,'status',v_state);
end $$;

create or replace function public.transition_multi_service_fulfilment(
  p_fulfilment_id uuid, p_vendor_id uuid, p_next_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.order_fulfilments%rowtype;
  v_order_status text;
begin
  select * into v_f from public.order_fulfilments where id = p_fulfilment_id for update;
  if not found or v_f.vendor_id <> p_vendor_id then return jsonb_build_object('updated',false,'reason','not_found'); end if;
  if p_next_status = 'en_route' and v_f.status = 'accepted' then
    update public.order_fulfilments set status = 'en_route', updated_at = now() where id = v_f.id;
  elsif p_next_status = 'arrived' and v_f.status = 'en_route' then
    update public.order_fulfilments set status = 'arrived', updated_at = now() where id = v_f.id;
  else
    return jsonb_build_object('updated',false,'reason','invalid_transition');
  end if;
  update public.order_items i set status = p_next_status, updated_at = now()
    from public.order_fulfilment_items fi where fi.item_id = i.id and fi.fulfilment_id = v_f.id;
  v_order_status := public.refresh_multi_service_order_status(v_f.order_id);
  return jsonb_build_object('updated',true,'orderId',v_f.order_id,'status',v_order_status);
end $$;

create or replace function public.drop_multi_service_fulfilment(p_fulfilment_id uuid, p_vendor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.order_fulfilments%rowtype; v_status text;
begin
  select * into v_f from public.order_fulfilments where id = p_fulfilment_id for update;
  if not found or v_f.vendor_id <> p_vendor_id then return jsonb_build_object('dropped',false,'reason','not_found'); end if;
  if v_f.status <> 'accepted' then return jsonb_build_object('dropped',false,'reason','already_started'); end if;
  update public.order_fulfilments set vendor_id = null, status = 'pending_vendor', updated_at = now() where id = v_f.id;
  update public.order_items i set status = 'pending_vendor', updated_at = now()
    from public.order_fulfilment_items fi where fi.item_id = i.id and fi.fulfilment_id = v_f.id;
  update public.order_offers set status = 'cancelled', updated_at = now() where order_id = v_f.order_id and v_f.id = any(
    select unnest(item_ids) from public.order_offers where order_id = v_f.order_id
  ) and status = 'offered';
  v_status := public.refresh_multi_service_order_status(v_f.order_id);
  return jsonb_build_object('dropped',true,'orderId',v_f.order_id,'status',v_status);
end $$;

create or replace function public.claim_multi_service_delivery_attempt(p_fulfilment_id uuid, p_vendor_id uuid, p_candidate_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.order_fulfilments%rowtype; v_order_status text;
begin
  select * into v_f from public.order_fulfilments where id = p_fulfilment_id and vendor_id = p_vendor_id for update;
  if not found then return jsonb_build_object('verified',false,'reason','not_found'); end if;
  if v_f.status <> 'arrived' then return jsonb_build_object('verified',false,'reason','invalid_status'); end if;
  if v_f.delivery_otp_locked_at is not null or v_f.delivery_otp_attempts >= 5 then return jsonb_build_object('verified',false,'reason','locked'); end if;
  if v_f.delivery_otp_hash is null or v_f.delivery_otp_expires_at <= now() then return jsonb_build_object('verified',false,'reason','expired'); end if;
  if v_f.delivery_otp_hash <> p_candidate_hash then
    update public.order_fulfilments set delivery_otp_attempts = delivery_otp_attempts + 1,
      delivery_otp_locked_at = case when delivery_otp_attempts + 1 >= 5 then now() else null end,
      updated_at = now() where id = v_f.id;
    if v_f.delivery_otp_attempts + 1 >= 5 then
      insert into public.order_admin_audit(order_id,fulfilment_id,action,reason,metadata)
      values (v_f.order_id,v_f.id,'delivery_otp_locked','Five incorrect delivery OTP attempts',jsonb_build_object('attempts',5));
      insert into public.notifications(recipient_id,event_type,title,payload)
      select p.id,'multi_service.delivery_otp_locked','Delivery OTP locked',jsonb_build_object('orderId',v_f.order_id,'fulfilmentId',v_f.id)
      from public.profiles p where p.role = 'admin';
    end if;
    return jsonb_build_object('verified',false,'reason',case when v_f.delivery_otp_attempts + 1 >= 5 then 'locked' else 'invalid' end);
  end if;
  update public.order_fulfilments set status = 'delivered', delivered_at = now(), delivery_otp_hash = null,
    delivery_otp_expires_at = null, updated_at = now() where id = v_f.id;
  update public.order_items i set status = 'delivered', updated_at = now()
    from public.order_fulfilment_items fi where fi.item_id = i.id and fi.fulfilment_id = v_f.id;
  v_order_status := public.refresh_multi_service_order_status(v_f.order_id);
  return jsonb_build_object('verified',true,'orderId',v_f.order_id,'status',v_order_status);
end $$;

create or replace function public.issue_multi_service_delivery_otp(
  p_fulfilment_id uuid, p_customer_id uuid, p_hash text, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.order_fulfilments%rowtype;
begin
  select f.* into v_f from public.order_fulfilments f
    join public.orders o on o.id=f.order_id
    where f.id=p_fulfilment_id and o.customer_id=p_customer_id for update of f;
  if not found then return jsonb_build_object('issued',false,'reason','not_found'); end if;
  if v_f.status<>'arrived' then return jsonb_build_object('issued',false,'reason','invalid_status'); end if;
  if v_f.delivery_otp_last_requested_at>now()-interval '60 seconds' then
    return jsonb_build_object('issued',false,'reason','cooldown');
  end if;
  if v_f.delivery_otp_last_requested_at is null or v_f.delivery_otp_last_requested_at<now()-interval '1 day' then
    v_f.delivery_otp_requests:=0;
  end if;
  if v_f.delivery_otp_requests>=5 then return jsonb_build_object('issued',false,'reason','rate_limited'); end if;
  update public.order_fulfilments set delivery_otp_hash=p_hash,delivery_otp_expires_at=p_expires_at,
    delivery_otp_attempts=0,delivery_otp_locked_at=null,delivery_otp_sms_sent=null,
    delivery_otp_requests=v_f.delivery_otp_requests+1,delivery_otp_last_requested_at=now(),updated_at=now()
    where id=v_f.id;
  return jsonb_build_object('issued',true,'reference',v_f.reference);
end $$;

create or replace function public.complete_multi_service_fulfilment_admin(
  p_fulfilment_id uuid, p_actor_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.order_fulfilments%rowtype; v_status text;
begin
  select * into v_f from public.order_fulfilments where id = p_fulfilment_id for update;
  if not found then return jsonb_build_object('completed',false,'reason','not_found'); end if;
  if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'AUDIT_REASON_REQUIRED'; end if;
  if v_f.status not in ('accepted','en_route','arrived') then return jsonb_build_object('completed',false,'reason','invalid_status'); end if;
  update public.order_fulfilments set status = 'delivered', delivered_at = now(), delivery_otp_hash = null,
    delivery_otp_expires_at = null, updated_at = now() where id = v_f.id;
  update public.order_items i set status = 'delivered', updated_at = now()
    from public.order_fulfilment_items fi where fi.item_id = i.id and fi.fulfilment_id = v_f.id;
  insert into public.order_admin_audit(order_id,fulfilment_id,actor_id,action,reason)
  values (v_f.order_id,v_f.id,p_actor_id,'manual_completion',trim(p_reason));
  v_status := public.refresh_multi_service_order_status(v_f.order_id);
  return jsonb_build_object('completed',true,'orderId',v_f.order_id,'status',v_status);
end $$;

create or replace function public.reassign_multi_service_fulfilment_admin(
  p_fulfilment_id uuid, p_vendor_id uuid, p_actor_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.order_fulfilments%rowtype;
  v_item_id uuid;
  v_status text;
begin
  select * into v_f from public.order_fulfilments where id=p_fulfilment_id for update;
  if not found then return jsonb_build_object('reassigned',false,'reason','not_found'); end if;
  if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'AUDIT_REASON_REQUIRED'; end if;
  if v_f.status not in ('pending_vendor','offered','accepted') then
    return jsonb_build_object('reassigned',false,'reason','invalid_status');
  end if;
  if not exists (select 1 from public.vendors where id=p_vendor_id and is_online and verification='approved') then
    return jsonb_build_object('reassigned',false,'reason','vendor_unavailable');
  end if;
  for v_item_id in select item_id from public.order_fulfilment_items where fulfilment_id=v_f.id
  loop
    if not exists (
      select 1 from public.order_items i join public.vendor_services vs
        on vs.service_type_id=i.service_type_id and vs.vendor_id=p_vendor_id and vs.active
      where i.id=v_item_id
    ) then return jsonb_build_object('reassigned',false,'reason','service_not_supported'); end if;
  end loop;
  update public.order_fulfilments set vendor_id=p_vendor_id,status='accepted',updated_at=now() where id=v_f.id;
  update public.order_items i set status='accepted',updated_at=now()
    from public.order_fulfilment_items fi where fi.item_id=i.id and fi.fulfilment_id=v_f.id;
  update public.order_offers set status='cancelled',updated_at=now()
    where order_id=v_f.order_id and v_f.id=any(select unnest(item_ids)) and status='offered';
  insert into public.order_admin_audit(order_id,fulfilment_id,actor_id,action,reason,metadata)
  values(v_f.order_id,v_f.id,p_actor_id,'manual_reassignment',trim(p_reason),jsonb_build_object('vendorId',p_vendor_id));
  v_status := public.refresh_multi_service_order_status(v_f.order_id);
  return jsonb_build_object('reassigned',true,'orderId',v_f.order_id,'status',v_status);
end $$;

create or replace function public.cancel_multi_service_item(p_item_id uuid, p_customer_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_item public.order_items%rowtype; v_order_status text;
begin
  select i.* into v_item from public.order_items i join public.orders o on o.id = i.order_id
    where i.id = p_item_id and o.customer_id = p_customer_id for update of i;
  if not found then return jsonb_build_object('cancelled',false,'reason','not_found'); end if;
  if v_item.status not in ('pending_vendor','offered') then return jsonb_build_object('cancelled',false,'reason','already_accepted'); end if;
  update public.order_items set status = 'cancelled', updated_at = now() where id = v_item.id;
  update public.order_fulfilments f set status = 'cancelled', updated_at = now()
    from public.order_fulfilment_items fi where fi.fulfilment_id = f.id and fi.item_id = v_item.id;
  update public.order_offers set status = 'cancelled', updated_at = now() where v_item.id = any(item_ids) and status = 'offered';
  v_order_status := public.refresh_multi_service_order_status(v_item.order_id);
  return jsonb_build_object('cancelled',true,'orderId',v_item.order_id,'status',v_order_status);
end $$;

create or replace function public.edit_multi_service_item(p_item_id uuid, p_customer_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_item public.order_items%rowtype;
begin
  select i.* into v_item from public.order_items i join public.orders o on o.id = i.order_id
    where i.id = p_item_id and o.customer_id = p_customer_id for update of i;
  if not found then return jsonb_build_object('updated',false,'reason','not_found'); end if;
  if v_item.status not in ('pending_vendor','offered') then return jsonb_build_object('updated',false,'reason','already_accepted'); end if;
  update public.order_items set location = coalesce(p_changes->>'location',location),
    scheduled_for = coalesce(nullif(p_changes->>'scheduled_for','')::timestamptz,scheduled_for),
    slot = coalesce(p_changes->>'slot',slot),
    latitude = coalesce(nullif(p_changes->>'latitude','')::numeric,latitude),
    longitude = coalesce(nullif(p_changes->>'longitude','')::numeric,longitude),
    updated_at = now() where id = v_item.id;
  update public.order_offers set status = 'cancelled', updated_at = now() where v_item.id = any(item_ids) and status = 'offered';
  return jsonb_build_object('updated',true,'orderId',v_item.order_id);
end $$;

create or replace function public.cancel_multi_service_unpaid_order(p_order_id uuid, p_customer_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
begin
  select * into v_order from public.orders
    where id=p_order_id and customer_id=p_customer_id for update;
  if not found then return jsonb_build_object('cancelled',false,'reason','not_found'); end if;
  if v_order.payment_method<>'gateway' then return jsonb_build_object('cancelled',false,'reason','not_gateway'); end if;
  if v_order.status<>'pending_vendor' then return jsonb_build_object('cancelled',false,'reason','accepted'); end if;
  select * into v_payment from public.payments where booking_id=v_order.legacy_booking_id for update;
  if found and v_payment.status='paid' then return jsonb_build_object('cancelled',false,'reason','paid'); end if;
  delete from public.payments where booking_id=v_order.legacy_booking_id and status<>'paid';
  delete from public.orders where id=v_order.id;
  delete from public.bookings where id=v_order.legacy_booking_id;
  return jsonb_build_object('cancelled',true,'createdAt',v_order.created_at,'legacyBookingId',v_order.legacy_booking_id);
end $$;

create or replace function public.sweep_multi_service_order_offers(p_escalation_minutes integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_expired integer; v_alerts integer;
begin
  update public.order_offers set status = 'expired', updated_at = now()
    where status = 'offered' and expires_at <= now();
  get diagnostics v_expired = row_count;
  insert into public.notifications(recipient_id,event_type,title,payload)
  select p.id,'multi_service.unassigned_escalation','Unassigned service requires attention',
    jsonb_build_object('orderId',o.id,'itemId',i.id,'reference',o.reference)
  from public.order_items i join public.orders o on o.id = i.order_id
  cross join public.profiles p
  where p.role = 'admin' and i.status in ('pending_vendor','offered')
    and i.created_at <= now() - make_interval(mins => greatest(1,coalesce(p_escalation_minutes,30)))
    and not exists (
      select 1 from public.order_admin_audit a where a.order_id = o.id and a.action = 'unassigned_escalation'
        and a.metadata->>'itemId' = i.id::text and a.created_at > now() - interval '1 day'
    );
  get diagnostics v_alerts = row_count;
  insert into public.order_admin_audit(order_id,action,reason,metadata)
  select o.id,'unassigned_escalation','No eligible vendor accepted before the escalation threshold',
    jsonb_build_object('itemId',i.id)
  from public.order_items i join public.orders o on o.id = i.order_id
  where i.status in ('pending_vendor','offered')
    and i.created_at <= now() - make_interval(mins => greatest(1,coalesce(p_escalation_minutes,30)))
    and not exists (select 1 from public.order_admin_audit a where a.order_id=o.id and a.action='unassigned_escalation' and a.metadata->>'itemId'=i.id::text and a.created_at > now()-interval '1 day');
  return jsonb_build_object('expiredOffers',v_expired,'alerts',v_alerts);
end $$;

alter table public.service_types enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_fulfilments enable row level security;
alter table public.order_fulfilment_items enable row level security;
alter table public.vendor_services enable row level security;
alter table public.order_offers enable row level security;
alter table public.order_fulfilment_ratings enable row level security;
alter table public.order_fulfilment_ledger enable row level security;
alter table public.order_refunds enable row level security;
alter table public.order_admin_audit enable row level security;
drop policy if exists "active service types are readable" on public.service_types;
create policy "active service types are readable" on public.service_types for select using (active);
drop policy if exists "customers read own normalized orders" on public.orders;
create policy "customers read own normalized orders" on public.orders for select using (auth.uid() = customer_id);
drop policy if exists "customers read own normalized order items" on public.order_items;
create policy "customers read own normalized order items" on public.order_items for select using (exists(select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid()));
drop policy if exists "vendors read assigned fulfilments" on public.order_fulfilments;
create policy "vendors read assigned fulfilments" on public.order_fulfilments for select using (exists(select 1 from public.vendors v where v.id=vendor_id and v.owner_profile_id=auth.uid()));
drop policy if exists "customers read own normalized fulfilments" on public.order_fulfilments;
create policy "customers read own normalized fulfilments" on public.order_fulfilments for select using (exists(select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid()));
grant select on public.service_types to anon, authenticated;
grant select on public.orders, public.order_items, public.order_fulfilments to authenticated;
grant all on public.service_types, public.orders, public.order_items, public.order_fulfilments,
  public.order_fulfilment_items, public.vendor_services, public.order_offers,
  public.order_fulfilment_ratings, public.order_fulfilment_ledger, public.order_refunds,
  public.order_admin_audit to service_role;
revoke all on function public.create_multi_service_order(jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.refresh_multi_service_order_status(uuid) from public, anon, authenticated;
revoke all on function public.accept_multi_service_offer(uuid,uuid) from public, anon, authenticated;
revoke all on function public.transition_multi_service_fulfilment(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.drop_multi_service_fulfilment(uuid,uuid) from public, anon, authenticated;
revoke all on function public.claim_multi_service_delivery_attempt(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.issue_multi_service_delivery_otp(uuid,uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.complete_multi_service_fulfilment_admin(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.reassign_multi_service_fulfilment_admin(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.cancel_multi_service_item(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.edit_multi_service_item(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.cancel_multi_service_unpaid_order(uuid,uuid) from public, anon, authenticated;
revoke all on function public.sweep_multi_service_order_offers(integer) from public, anon, authenticated;
revoke all on function public.record_multi_service_delivery_invoices() from public, anon, authenticated;
revoke all on function public.sync_multi_service_invoice_payment() from public, anon, authenticated;
grant execute on function public.create_multi_service_order(jsonb,jsonb,jsonb) to service_role;
grant execute on function public.refresh_multi_service_order_status(uuid) to service_role;
grant execute on function public.accept_multi_service_offer(uuid,uuid) to service_role;
grant execute on function public.transition_multi_service_fulfilment(uuid,uuid,text) to service_role;
grant execute on function public.drop_multi_service_fulfilment(uuid,uuid) to service_role;
grant execute on function public.claim_multi_service_delivery_attempt(uuid,uuid,text) to service_role;
grant execute on function public.issue_multi_service_delivery_otp(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.complete_multi_service_fulfilment_admin(uuid,uuid,text) to service_role;
grant execute on function public.reassign_multi_service_fulfilment_admin(uuid,uuid,uuid,text) to service_role;
grant execute on function public.cancel_multi_service_item(uuid,uuid,text) to service_role;
grant execute on function public.edit_multi_service_item(uuid,uuid,jsonb) to service_role;
grant execute on function public.cancel_multi_service_unpaid_order(uuid,uuid) to service_role;
grant execute on function public.sweep_multi_service_order_offers(integer) to service_role;
grant execute on function public.record_multi_service_delivery_invoices() to service_role;
grant execute on function public.sync_multi_service_invoice_payment() to service_role;
notify pgrst, 'reload schema';
commit;

alter table public.bookings
  add column if not exists tracking_confirmation_email_sent_at timestamptz;

-- Additive admin-access approval support. The nullable column addition avoids
-- rewriting profiles; existing administrators are backfilled as approved.
alter table public.profiles
  add column if not exists admin_approval_status text;

alter table public.profiles
  add column if not exists is_active boolean not null default true;

update public.profiles
set admin_approval_status = 'approved'
where role = 'admin'
  and admin_approval_status is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_admin_approval_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_admin_approval_status_check
      check (admin_approval_status is null or admin_approval_status in ('pending', 'approved', 'rejected')) not valid;
  end if;
end $$;

create table if not exists public.admin_access_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone_e164 text not null,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  requested_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  provisioned_user_id uuid references auth.users(id) on delete set null
);

create index if not exists admin_access_requests_pending_idx
  on public.admin_access_requests (requested_at)
  where status = 'pending';

create unique index if not exists admin_access_requests_active_email_idx
  on public.admin_access_requests (lower(email))
  where status in ('pending', 'approved');

create unique index if not exists admin_access_requests_active_phone_idx
  on public.admin_access_requests (phone_e164)
  where status in ('pending', 'approved');

alter table public.admin_access_requests enable row level security;
revoke all on public.admin_access_requests from public, anon, authenticated;
grant all on public.admin_access_requests to service_role;

-- Performance indexes consolidated from 002_performance_indexes.sql.
create index if not exists vendors_owner_profile_idx on public.vendors (owner_profile_id);
create index if not exists vendors_online_approved_idx on public.vendors (service_zone)
  where is_online = true and verification = 'approved';
create index if not exists profiles_admin_idx on public.profiles (id) where role = 'admin';
create index if not exists bookings_order_group_idx on public.bookings (order_group_id)
  where order_group_id is not null;
create index if not exists bookings_vehicle_idx on public.bookings (vehicle_id) where vehicle_id is not null;
create index if not exists order_fulfilments_order_idx on public.order_fulfilments (order_id);
create index if not exists order_fulfilments_legacy_booking_idx on public.order_fulfilments (legacy_booking_id)
  where legacy_booking_id is not null;
create index if not exists order_items_legacy_booking_idx on public.order_items (legacy_booking_id)
  where legacy_booking_id is not null;
create index if not exists order_offers_fulfilment_idx on public.order_offers (fulfilment_id);
create index if not exists invoices_booking_idx on public.invoices (booking_id);
create index if not exists invoices_order_idx on public.invoices (order_id) where order_id is not null;
create index if not exists notifications_offer_booking_idx on public.notifications ((payload->>'bookingId'))
  where event_type = 'vendor_order_created';
create index if not exists ratings_booking_idx on public.ratings (booking_id);
create index if not exists ratings_customer_idx on public.ratings (customer_id);
create index if not exists complaints_booking_idx on public.complaints (booking_id);
create index if not exists complaints_customer_idx on public.complaints (customer_id);
create index if not exists subscriptions_customer_idx on public.subscriptions (customer_id);
create index if not exists wallet_transactions_customer_idx on public.wallet_transactions (customer_id);
create index if not exists customer_memberships_customer_idx on public.customer_memberships (customer_id);
create index if not exists driver_attendance_driver_idx on public.driver_attendance (driver_id);
create index if not exists driver_attendance_vendor_idx on public.driver_attendance (vendor_id);
create index if not exists vendor_location_updates_vendor_idx on public.vendor_location_updates (vendor_id);
create index if not exists order_fulfilment_ledger_vendor_idx on public.order_fulfilment_ledger (vendor_id);
create index if not exists order_fulfilment_ledger_order_idx on public.order_fulfilment_ledger (order_id);
create index if not exists order_admin_audit_order_idx on public.order_admin_audit (order_id);
create index if not exists order_fulfilment_ratings_order_idx on public.order_fulfilment_ratings (order_id);
create index if not exists audit_logs_created_idx on public.audit_logs (created_at);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

drop index if exists public.vendor_location_booking_recorded_idx;
drop index if exists public.bookings_tracking_token_hash_idx;

notify pgrst, 'reload schema';

-- Additive migration for existing databases. Safe to run more than once.
begin;

create table if not exists public.email_templates (
  template_key text primary key,
  subject text not null,
  body text not null,
  variables text[] not null default '{}',
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.email_templates enable row level security;
revoke all on public.email_templates from public, anon, authenticated;
grant all on public.email_templates to service_role;

insert into public.email_templates (template_key, subject, body, variables) values
  (
    'guest_booking_confirmation',
    'Your booking {{reference}} is confirmed',
    E'Hello,\n\nYour Urban Tanker booking {{reference}} is confirmed. We will keep you updated as it moves through each stage.\n\nTrack your booking: {{trackingUrl}}',
    '{reference,trackingUrl}'
  ),
  (
    'booking_status_update',
    'Booking {{reference}}: {{status}}',
    E'Hello,\n\nThere is an update to your Urban Tanker booking {{reference}}.\n\n{{status}}\n{{detail}}\n\nTrack your booking: {{trackingUrl}}',
    '{reference,status,detail,trackingUrl}'
  ),
  (
    'vendor_acceptance',
    'Your Urban Tanker delivery team is assigned',
    E'Hello,\n\nYour booking {{reference}} has an assigned delivery team.\n\nVehicle: {{vehicle}}\nDriver: {{driver}}\n\nFollow your delivery: {{trackingUrl}}\n{{customerMapDetail}}',
    '{reference,vehicle,driver,trackingUrl,customerMapDetail}'
  ),
  (
    'delivery_confirmation',
    'Your booking {{reference}} is complete',
    E'Hello,\n\nYour Urban Tanker delivery for booking {{reference}} is complete.\n\nThank you for choosing Urban Tanker. We appreciate your business.',
    '{reference}'
  )
on conflict (template_key) do nothing;

commit;

-- Add email content for registration, each booking status, and vendor decisions.
-- Existing customized templates are preserved.
begin;

insert into public.email_templates (template_key, subject, body, variables) values
  (
    'user_registration_otp',
    'Confirm your Urban Tanker registration',
    E'Hello,\n\nWelcome to Urban Tanker. Enter verification code {{otp}} to confirm your email address and complete your registration.\n\nThis code expires in 10 minutes. For your security, never share it with anyone. If you did not request this code, you can ignore this email.',
    '{otp}'
  ),
  (
    'booking_pending_vendor',
    'We received booking {{reference}}',
    E'Hello,\n\nWe have received booking {{reference}} and are finding a service partner for your request.\n\n{{detail}}\n\nThere is no action needed right now. We will email you again as soon as the booking moves to its next stage. You can check the latest information here:\n{{trackingUrl}}',
    '{reference,detail,trackingUrl}'
  ),
  (
    'booking_vendor_assigned',
    'A service partner has been assigned to booking {{reference}}',
    E'Hello,\n\nA service partner has been assigned to your Urban Tanker booking {{reference}}.\n\n{{detail}}\n\nPlease keep your phone available in case the service partner needs to reach you. View the booking and its latest details here:\n{{trackingUrl}}',
    '{reference,detail,trackingUrl}'
  ),
  (
    'booking_accepted',
    'Booking {{reference}} has been accepted',
    E'Hello,\n\nYour service partner has accepted booking {{reference}}.\n\n{{detail}}\n\nPlease make sure the delivery location is accessible at the scheduled time. You can review your booking here:\n{{trackingUrl}}',
    '{reference,detail,trackingUrl}'
  ),
  (
    'booking_en_route',
    'Your delivery is on the way - booking {{reference}}',
    E'Hello,\n\nThe tanker for booking {{reference}} is on its way to your delivery location.\n\n{{detail}}\n\nPlease ensure someone is available to receive the delivery. Follow the latest progress here:\n{{trackingUrl}}',
    '{reference,detail,trackingUrl}'
  ),
  (
    'booking_arrived',
    'Your tanker has arrived - booking {{reference}}',
    E'Hello,\n\nThe tanker for booking {{reference}} has arrived at the delivery location.\n\n{{detail}}\n\nPlease coordinate with the driver to complete your delivery. View the booking details here:\n{{trackingUrl}}',
    '{reference,detail,trackingUrl}'
  ),
  (
    'booking_cancelled',
    'Booking {{reference}} has been cancelled',
    E'Hello,\n\nBooking {{reference}} has been cancelled.\n\n{{detail}}\n\nIf you did not request this cancellation or need help with the booking, please contact Urban Tanker support. You can review the booking here:\n{{trackingUrl}}',
    '{reference,detail,trackingUrl}'
  ),
  (
    'booking_payment_online',
    'Payment received for booking {{reference}}',
    E'Hello,\n\nWe have received the online payment for booking {{reference}}.\n\n{{detail}}\n\nNo cash payment is due to the driver for this booking. View your booking and payment details here:\n{{trackingUrl}}',
    '{reference,detail,trackingUrl}'
  ),
  (
    'booking_payment_cod',
    'Payment method updated for booking {{reference}}',
    E'Hello,\n\nThe payment method for booking {{reference}} has been updated to cash on delivery.\n\n{{detail}}\n\nPlease pay the amount shown in your booking when the delivery is completed. Review the latest details here:\n{{trackingUrl}}',
    '{reference,detail,trackingUrl}'
  ),
  (
    'booking_rescheduled',
    'Booking {{reference}} has been rescheduled',
    E'Hello,\n\nThe schedule for booking {{reference}} has been changed.\n\n{{detail}}\n\nPlease check your booking for the latest delivery date and time, and contact support if the new schedule does not work for you:\n{{trackingUrl}}',
    '{reference,detail,trackingUrl}'
  ),
  (
    'booking_delivered',
    'Delivery completed for booking {{reference}}',
    E'Hello,\n\nThe delivery for booking {{reference}} has been marked complete.\n\n{{detail}}\n\nPlease check that your delivery is complete and contact Urban Tanker support if you need assistance. Thank you for choosing Urban Tanker.\n{{trackingUrl}}',
    '{reference,detail,trackingUrl}'
  ),
  (
    'vendor_application_approved',
    'Your Urban Tanker partner application is approved',
    E'Hello {{businessName}},\n\nWe are pleased to let you know that your Urban Tanker partner application (reference {{reference}}) has been approved.\n\nOur team will share the next steps for onboarding and account setup. Please keep this reference for your records. We look forward to working with you.',
    '{businessName,reference}'
  ),
  (
    'vendor_application_rejected',
    'Update on your Urban Tanker partner application',
    E'Hello {{businessName}},\n\nWe have completed our review of your Urban Tanker partner application (reference {{reference}}). We are unable to approve the application at this time.\n\nReview details: {{reviewNote}}\n\nIf you would like clarification or believe additional information may help, please contact our partnerships team and include your application reference.',
    '{businessName,reference,reviewNote}'
  ),
  (
    'vendor_account_approved',
    'Your Urban Tanker vendor account is approved',
    E'Hello {{name}},\n\nYour Urban Tanker vendor account has been approved. You can now sign in and continue with vendor onboarding:\n{{loginUrl}}\n\nPlease keep your account credentials secure. Contact support if you need assistance.',
    '{name,loginUrl}'
  ),
  (
    'vendor_account_rejected',
    'Update on your Urban Tanker vendor account',
    E'Hello {{name}},\n\nWe have reviewed your Urban Tanker vendor account and are unable to approve it at this time.\n\nPlease contact Urban Tanker support if you need clarification or believe further information should be considered.',
    '{name}'
  ),
  (
    'vendor_profile_approved',
    'Your Urban Tanker vendor profile is approved',
    E'Hello {{businessName}},\n\nYour Urban Tanker vendor profile has been approved. You can now sign in to manage your business profile and continue onboarding:\n{{loginUrl}}\n\nPlease keep your contact and service details up to date. Contact support if you need assistance.',
    '{businessName,loginUrl}'
  ),
  (
    'vendor_profile_rejected',
    'Update on your Urban Tanker vendor profile',
    E'Hello {{businessName}},\n\nWe have reviewed your Urban Tanker vendor profile and are unable to approve it at this time.\n\nPlease contact Urban Tanker support if you need clarification or would like to provide additional information.',
    '{businessName}'
  )
on conflict (template_key) do nothing;

update public.email_templates
set subject = 'Your booking {{reference}} is confirmed',
    body = E'Hello,\n\nYour Urban Tanker booking {{reference}} is confirmed. We have received your request and will keep you informed as the service partner is assigned, accepts the booking, and completes the delivery.\n\nYou can view your booking, check its scheduled details, and follow its progress here:\n{{trackingUrl}}\n\nPlease keep your contact number available for service updates. If any booking details need attention, contact Urban Tanker support and include your booking reference.',
    updated_at = now()
where template_key = 'guest_booking_confirmation'
  and subject = 'Your booking {{reference}} is confirmed'
  and body = E'Hello,\n\nYour Urban Tanker booking {{reference}} is confirmed. We will keep you updated as it moves through each stage.\n\nTrack your booking: {{trackingUrl}}';

update public.email_templates
set subject = 'Your Urban Tanker delivery team is assigned',
    body = E'Hello,\n\nA delivery team has been assigned to booking {{reference}}.\n\nVehicle: {{vehicle}}\nDriver: {{driver}}\n\nPlease keep your phone available and ensure the delivery location is accessible. Follow your delivery and review the booking details here:\n{{trackingUrl}}\n\n{{customerMapDetail}}\n\nContact Urban Tanker support if you need help with this booking.',
    updated_at = now()
where template_key = 'vendor_acceptance'
  and subject = 'Your Urban Tanker delivery team is assigned'
  and body = E'Hello,\n\nYour booking {{reference}} has an assigned delivery team.\n\nVehicle: {{vehicle}}\nDriver: {{driver}}\n\nFollow your delivery: {{trackingUrl}}\n{{customerMapDetail}}';

update public.email_templates
set subject = 'Your booking {{reference}} is complete',
    body = E'Hello,\n\nYour Urban Tanker delivery for booking {{reference}} has been marked complete.\n\nPlease check that your delivery is complete and contact our support team if anything needs attention. Thank you for choosing Urban Tanker; we appreciate your business.',
    updated_at = now()
where template_key = 'delivery_confirmation'
  and subject = 'Your booking {{reference}} is complete'
  and body = E'Hello,\n\nYour Urban Tanker delivery for booking {{reference}} is complete.\n\nThank you for choosing Urban Tanker. We appreciate your business.';

commit;

-- Store an optional guest email on the booking so status updates go to the
-- address supplied for that booking, without changing the registered account email.
begin;

alter table public.bookings add column if not exists customer_email text;

commit;

