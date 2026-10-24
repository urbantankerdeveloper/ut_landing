alter table public.bookings
  add column if not exists service_details jsonb not null default '[]'::jsonb;
