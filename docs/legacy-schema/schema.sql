-- Urban Tanker production data model (PostgreSQL / Supabase).
-- Run this in a new project, then replace the demo Store in app.js with secure API calls.
-- Keep payment keys, SMS credentials and role changes on the server only.

create extension if not exists pgcrypto;

create type public.user_role as enum ('customer', 'vendor', 'dispatcher', 'admin');
create type public.booking_status as enum (
  'pending_vendor', 'vendor_assigned', 'accepted', 'en_route', 'arrived', 'delivered', 'cancelled'
);
create type public.payment_status as enum ('pending', 'authorized', 'paid', 'failed', 'refunded', 'due_on_delivery');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone_e164 text unique,
  role public.user_role not null default 'customer',
  created_at timestamptz not null default now()
);

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  owner_profile_id uuid references public.profiles(id),
  business_name text not null,
  driver_name text,
  phone_e164 text not null,
  service_zone text not null,
  latitude numeric(9,6),
  longitude numeric(9,6),
  is_online boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  registration_number text not null unique,
  capacity_litres integer,
  supported_services text[] not null default array['water_tanker'],
  is_active boolean not null default true
);

create table public.service_catalog (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  base_price_paise integer not null check (base_price_paise >= 0),
  is_active boolean not null default true
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  customer_id uuid not null references public.profiles(id),
  vendor_id uuid references public.vendors(id),
  vehicle_id uuid references public.vehicles(id),
  service_code text not null references public.service_catalog(code),
  capacity_litres integer,
  scheduled_for timestamptz,
  address_text text not null,
  latitude numeric(9,6),
  longitude numeric(9,6),
  access_notes text,
  quoted_amount_paise integer not null check (quoted_amount_paise >= 0),
  status public.booking_status not null default 'pending_vendor',
  delivery_otp_hash text,
  delivery_otp_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_status_created_at_idx on public.bookings(status, created_at desc);
create index bookings_customer_id_idx on public.bookings(customer_id, created_at desc);
create index bookings_vendor_id_idx on public.bookings(vendor_id, created_at desc);

create table public.booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  actor_id uuid references public.profiles(id),
  from_status public.booking_status,
  to_status public.booking_status not null,
  note text,
  created_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  provider text not null,
  provider_order_id text unique,
  provider_payment_id text unique,
  amount_paise integer not null check (amount_paise >= 0),
  currency char(3) not null default 'INR',
  status public.payment_status not null default 'pending',
  raw_webhook jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.vendor_location_updates (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  latitude numeric(9,6) not null,
  longitude numeric(9,6) not null,
  accuracy_metres numeric,
  recorded_at timestamptz not null default now()
);
create index vendor_location_booking_recorded_idx on public.vendor_location_updates(booking_id, recorded_at desc);

-- Server-only function: call after validating the customer-provided delivery OTP.
create or replace function public.complete_booking(
  input_booking_id uuid,
  input_otp_hash text
) returns void language plpgsql security definer as $$
declare current_booking public.bookings;
begin
  select * into current_booking from public.bookings where id = input_booking_id for update;
  if current_booking.id is null then raise exception 'Booking not found'; end if;
  if current_booking.status <> 'arrived' then raise exception 'Booking is not ready for completion'; end if;
  if current_booking.delivery_otp_expires_at < now() then raise exception 'Delivery OTP expired'; end if;
  if current_booking.delivery_otp_hash <> input_otp_hash then raise exception 'Invalid delivery OTP'; end if;
  update public.bookings set status = 'delivered', completed_at = now(), updated_at = now() where id = input_booking_id;
  insert into public.booking_events(booking_id, to_status, note) values (input_booking_id, 'delivered', 'OTP verified');
end;
$$;

-- Enable RLS. Policies below are a starting point; use server-side service-role
-- functions for allocation, payment webhooks, dispatch overrides and OTP checks.
alter table public.profiles enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;
alter table public.payments enable row level security;
alter table public.vendor_location_updates enable row level security;

create policy "customer sees own profile" on public.profiles for select using (auth.uid() = id);
create policy "customer updates own profile" on public.profiles for update using (auth.uid() = id);
create policy "customer sees own bookings" on public.bookings for select using (auth.uid() = customer_id);
create policy "customer creates own bookings" on public.bookings for insert with check (auth.uid() = customer_id);
create policy "customer sees own booking events" on public.booking_events for select using (
  exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid())
);
create policy "customer sees own payments" on public.payments for select using (
  exists (select 1 from public.bookings b where b.id = booking_id and b.customer_id = auth.uid())
);

-- Add explicit vendor/admin policies only after their role is checked in a
-- security-definer function or in trusted server middleware.
