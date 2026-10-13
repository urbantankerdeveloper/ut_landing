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