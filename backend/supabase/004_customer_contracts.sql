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