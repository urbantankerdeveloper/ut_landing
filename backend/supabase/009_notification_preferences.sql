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
