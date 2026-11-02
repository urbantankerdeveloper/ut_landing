-- Run after schema.sql. Review with your production DBA; enable RLS and audit triggers.
do $$ begin create type public.verification_status as enum ('pending','under_review','approved','verified','rejected','suspended'); exception when duplicate_object then null; end $$;
do $$ begin create type public.complaint_status as enum ('open','under_review','vendor_response_required','resolved','closed'); exception when duplicate_object then null; end $$;

alter table public.service_catalog add column if not exists category text;
alter table public.service_catalog add column if not exists description text;
alter table public.service_catalog add column if not exists config jsonb not null default '{}'::jsonb;

alter table public.vendors add column if not exists verification public.verification_status not null default 'pending';
alter table public.vendors add column if not exists operational_status text not null default 'inactive';
alter table public.vendors add column if not exists rejection_reason text;

alter table public.vehicles add column if not exists vehicle_type text;
alter table public.vehicles add column if not exists verification public.verification_status not null default 'pending';
alter table public.vehicles add column if not exists document_metadata jsonb not null default '{}'::jsonb;

create table if not exists public.vendor_services (
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  service_code text not null references public.service_catalog(code),
  active boolean not null default false,
  approved boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (vendor_id, service_code)
);

create table if not exists public.drivers (
  id uuid primary key default gen_random_uuid(), vendor_id uuid not null references public.vendors(id) on delete cascade,
  profile_id uuid references public.profiles(id), name text not null, mobile_e164 text not null, whatsapp_e164 text,
  licence_number text not null, licence_validity date, assigned_vehicle_id uuid references public.vehicles(id) on delete set null,
  service_code text references public.service_catalog(code), is_active boolean not null default false,
  verification public.verification_status not null default 'pending', metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(), owner_type text not null check (owner_type in ('vendor','vehicle','driver','booking','complaint')),
  owner_id uuid not null, document_type text not null, object_key text not null,
  verification public.verification_status not null default 'pending', expires_on date,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(), code text not null unique, title text not null,
  discount_type text not null check (discount_type in ('flat','percent','benefit')), discount_value numeric not null default 0,
  applicable_service_codes text[] not null default '{}', minimum_order numeric not null default 0, maximum_discount numeric,
  valid_from timestamptz, valid_until timestamptz, terms text, is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id) on delete cascade,
  plan_id text not null, status text not null, coupon_id uuid references public.coupons(id), benefits jsonb not null default '{}'::jsonb,
  starts_at timestamptz not null, renews_at timestamptz, ends_at timestamptz, created_at timestamptz not null default now()
);

create table if not exists public.complaints (
  id uuid primary key default gen_random_uuid(), vendor_id uuid references public.vendors(id), booking_id uuid references public.bookings(id),
  customer_id uuid references public.profiles(id), service_code text references public.service_catalog(code), category text not null,
  description text not null, priority text not null default 'normal', status public.complaint_status not null default 'open',
  admin_notes text, vendor_response text, resolution text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(), source text not null, customer_id uuid references public.profiles(id),
  vendor_id uuid references public.vendors(id), service_code text references public.service_catalog(code), status text not null default 'new',
  details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(), recipient_role text not null, recipient_id uuid, event_type text not null,
  priority text not null default 'normal', title text not null, payload jsonb not null default '{}'::jsonb,
  read_at timestamptz, created_at timestamptz not null default now()
);

-- Server-side allocation invariant:
-- vendor verification approved + operational_status active + vendor_service active/approved
-- + vehicle verified/active + assigned driver verified/active.
