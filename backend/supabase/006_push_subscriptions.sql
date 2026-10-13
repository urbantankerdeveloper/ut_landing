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
