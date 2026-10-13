create table if not exists public.vendor_service_availability (
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  service_code text not null references public.service_catalog(code) on delete cascade,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (vendor_id, service_code)
);
alter table public.vendor_service_availability enable row level security;
create policy "vendor owns service availability" on public.vendor_service_availability for all using (auth.uid() in (select owner_profile_id from public.vendors where id = vendor_id)) with check (auth.uid() in (select owner_profile_id from public.vendors where id = vendor_id));