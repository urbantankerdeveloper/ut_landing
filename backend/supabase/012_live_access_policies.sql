-- Live access policy hardening for customer, vendor, admin, and realtime data paths.

grant usage on schema public to authenticated, service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
alter default privileges in schema public grant all privileges on functions to service_role;

grant select on public.service_catalog to anon, authenticated;
grant select, insert on public.bookings to authenticated;
grant select, update on public.notifications to authenticated;
grant select on public.vendors to authenticated;
grant select, insert, update on public.vehicles to authenticated;
grant select, insert, update on public.drivers to authenticated;
grant select, insert, update on public.vendor_service_availability to authenticated;

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
