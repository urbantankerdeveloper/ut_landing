-- Urban Tanker canonical database install.
-- This script is destructive: it resets the public application schema.
-- Supabase auth.users is managed separately and is intentionally preserved.

begin;

drop schema if exists public cascade;
create schema public;
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to service_role;

-- ===== Consolidated from 001_initial.sql =====
create extension if not exists pgcrypto;

create type public.user_role as enum ('customer','vendor','dispatcher','admin');
create type public.booking_status as enum ('pending_vendor','vendor_assigned','accepted','en_route','arrived','delivered','cancelled');

create table if not exists public.profiles (id uuid primary key references auth.users(id) on delete cascade, full_name text not null, phone_e164 text unique, role public.user_role not null default 'customer', created_at timestamptz not null default now());
create table if not exists public.vendors (id uuid primary key default gen_random_uuid(), owner_profile_id uuid references public.profiles(id), business_name text not null, phone_e164 text not null, service_zone text not null, is_online boolean not null default false, verification text not null default 'pending', created_at timestamptz not null default now());
create table if not exists public.vehicles (id uuid primary key default gen_random_uuid(), vendor_id uuid not null references public.vendors(id) on delete cascade, registration_number text not null unique, capacity_litres integer, supported_services text[] not null default '{}', is_active boolean not null default true, metadata jsonb not null default '{}');
create table if not exists public.drivers (id uuid primary key default gen_random_uuid(), vendor_id uuid not null references public.vendors(id) on delete cascade, name text not null, mobile_e164 text not null, licence_number text not null, is_active boolean not null default false, verification text not null default 'pending', metadata jsonb not null default '{}');
create table if not exists public.service_catalog (id uuid primary key default gen_random_uuid(), code text unique not null, name text not null, description text, base_price_paise integer not null default 0, is_active boolean not null default true, config jsonb not null default '{}');
create table if not exists public.bookings (id uuid primary key default gen_random_uuid(), reference text unique not null, customer_id uuid not null references public.profiles(id), vendor_id uuid references public.vendors(id), vehicle_id uuid references public.vehicles(id), service_code text not null references public.service_catalog(code), capacity_litres integer, scheduled_for timestamptz, address_text text not null, latitude numeric(9,6), longitude numeric(9,6), access_notes text, quoted_amount_paise integer not null default 0, status public.booking_status not null default 'pending_vendor', delivery_otp_hash text, delivery_otp_expires_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create index if not exists bookings_customer_created_idx on public.bookings(customer_id, created_at desc);
create index if not exists bookings_vendor_created_idx on public.bookings(vendor_id, created_at desc);
create table if not exists public.booking_events (id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade, actor_id uuid references public.profiles(id), from_status public.booking_status, to_status public.booking_status not null, note text, created_at timestamptz not null default now());
create table if not exists public.payments (id uuid primary key default gen_random_uuid(), booking_id uuid unique not null references public.bookings(id), provider text not null, provider_order_id text unique, provider_payment_id text unique, amount_paise integer not null default 0, currency char(3) not null default 'INR', status text not null default 'pending', raw_webhook jsonb, created_at timestamptz not null default now());
create table if not exists public.invoices (id uuid primary key default gen_random_uuid(), number text unique not null, customer_id uuid not null references public.profiles(id), booking_id uuid references public.bookings(id), service text not null, location text not null, amount numeric not null default 0, status text not null default 'Paid', issued_at timestamptz not null default now());
create table if not exists public.saved_addresses (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, label text not null, address text not null, city text not null, pincode text not null, latitude numeric(9,6), longitude numeric(9,6), is_default boolean not null default false, created_at timestamptz not null default now());
alter table public.saved_addresses add column if not exists is_default boolean not null default false;
create unique index if not exists saved_addresses_one_default_idx on public.saved_addresses(user_id) where is_default = true;
create table if not exists public.subscriptions (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id) on delete cascade, plan_id text not null, status text not null, amount numeric not null default 0, next_delivery timestamptz, created_at timestamptz not null default now());
create table if not exists public.coupons (id uuid primary key default gen_random_uuid(), code text unique not null, title text not null, discount_type text not null, discount_value numeric not null default 0, valid_until timestamptz, is_active boolean not null default false, created_at timestamptz not null default now());
create table if not exists public.complaints (id uuid primary key default gen_random_uuid(), customer_id uuid references public.profiles(id), vendor_id uuid references public.vendors(id), booking_id uuid references public.bookings(id), subject text not null, message text not null, status text not null default 'open', created_at timestamptz not null default now());
create table if not exists public.notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid references public.profiles(id), event_type text not null, title text not null, payload jsonb not null default '{}', read_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.device_tokens (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade, token text not null unique, platform text not null check (platform in ('android','ios')), app_version text, is_active boolean not null default true, last_seen_at timestamptz not null default now(), created_at timestamptz not null default now());
create index if not exists device_tokens_user_active_idx on public.device_tokens(user_id, is_active);
create table if not exists public.audit_logs (id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles(id), action text not null, entity_type text not null, entity_id uuid, metadata jsonb not null default '{}', created_at timestamptz not null default now());

alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.saved_addresses enable row level security;
alter table public.invoices enable row level security;

create policy "profiles self read" on public.profiles for select using (auth.uid() = id);
create policy "customer own bookings" on public.bookings for select using (auth.uid() = customer_id);
create policy "customer own addresses" on public.saved_addresses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "customer own invoices" on public.invoices for select using (auth.uid() = customer_id);


-- ===== Consolidated from 002_operations.sql =====

create table if not exists public.vendor_location_updates (id bigint generated always as identity primary key, booking_id uuid not null references public.bookings(id) on delete cascade, vendor_id uuid not null references public.vendors(id) on delete cascade, latitude numeric(9,6) not null, longitude numeric(9,6) not null, accuracy_metres numeric, recorded_at timestamptz not null default now());
create index if not exists vendor_location_updates_booking_recorded_idx on public.vendor_location_updates(booking_id, recorded_at desc);
create table if not exists public.ratings (id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.bookings(id) on delete cascade, customer_id uuid not null references public.profiles(id), rating integer not null check (rating between 1 and 5), review text, created_at timestamptz not null default now(), unique(booking_id, customer_id));
create table if not exists public.wallet_transactions (id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id) on delete cascade, type text not null check (type in ('credit','debit')), amount numeric not null check (amount > 0), status text not null default 'pending', provider_reference text, created_at timestamptz not null default now());
create table if not exists public.driver_attendance (id uuid primary key default gen_random_uuid(), vendor_id uuid not null references public.vendors(id) on delete cascade, driver_id uuid not null references public.drivers(id) on delete cascade, attendance_date date not null, status text not null check (status in ('present','absent','on_leave')), created_at timestamptz not null default now(), unique(driver_id, attendance_date));
create table if not exists public.documents (id uuid primary key default gen_random_uuid(), owner_type text not null, owner_id uuid not null, document_type text not null, object_key text not null, expires_on date, verification text not null default 'pending', created_at timestamptz not null default now());
create table if not exists public.configs (key text primary key, value jsonb not null default '{}', updated_at timestamptz not null default now());
create index if not exists vendor_location_booking_recorded_idx on public.vendor_location_updates(booking_id, recorded_at desc);
create index if not exists notifications_recipient_created_idx on public.notifications(recipient_id, created_at desc);



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

create or replace function public.audit_booking_status() returns trigger language plpgsql security definer as $$ begin if old.status is distinct from new.status then insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata) values (auth.uid(), 'booking.status_changed', 'booking', new.id, jsonb_build_object('from', old.status, 'to', new.status)); end if; return new; end $$;
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
  p_driver_id uuid default null
) returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  current_booking public.bookings;
  next_booking public.bookings;
begin
  select * into current_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'BOOKING_NOT_FOUND';
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

grant execute on function public.transition_booking(uuid, uuid, public.booking_status, uuid, uuid, uuid) to service_role;


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

drop policy if exists "customers can create own bookings" on public.bookings;
create policy "customers can create own bookings"
on public.bookings
for insert
to authenticated
with check (auth.uid() = customer_id);

drop policy if exists "customers can read own bookings" on public.bookings;
create policy "customers can read own bookings"
on public.bookings
for select
to authenticated
using (auth.uid() = customer_id);

drop policy if exists "customers can update own bookings" on public.bookings;
create policy "customers can update own bookings"
on public.bookings
for update
to authenticated
using (auth.uid() = customer_id)
with check (auth.uid() = customer_id);

drop policy if exists "users can read own notifications" on public.notifications;
create policy "users can read own notifications"
on public.notifications
for select
to authenticated
using (auth.uid() = recipient_id);

drop policy if exists "users can mark own notifications read" on public.notifications;
create policy "users can mark own notifications read"
on public.notifications
for update
to authenticated
using (auth.uid() = recipient_id)
with check (auth.uid() = recipient_id);

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

insert into public.service_catalog (code, name, description, base_price_paise, is_active)
values
  ('water_tanker', 'Water tanker', 'Potable and utility water delivery', 185000, true),
  ('sewage_tanker', 'Sewage tanker', 'Sewage and wastewater transport', 185000, true),
  ('tank_cleaning', 'Tank cleaning', 'Residential and commercial tank cleaning', 185000, true),
  ('borewell_service', 'Borewell service', 'Borewell inspection and service support', 185000, true)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true;



-- ===== Consolidated from 017_guest_booking_phone.sql =====

alter table public.bookings
  add column if not exists customer_phone_e164 text;

create table if not exists public.guest_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists guest_otp_challenges_phone_created_idx
  on public.guest_otp_challenges(phone_e164, created_at desc);



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

-- Enforce RLS on every application table. Tables without an explicit policy remain deny-by-default.
insert into public.configs (key, value)
values
  ('maintenance_mode', 'false'::jsonb),
  ('cash_on_delivery_enabled', 'true'::jsonb),
  ('guest_booking_enabled', 'true'::jsonb),
  ('live_tracking_enabled', 'true'::jsonb)
on conflict (key) do update set value = excluded.value, updated_at = now();

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

commit;
