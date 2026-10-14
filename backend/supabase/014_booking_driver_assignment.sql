alter table public.bookings
  add column if not exists driver_id uuid references public.drivers(id) on delete set null;

create index if not exists bookings_driver_id_idx on public.bookings(driver_id);
