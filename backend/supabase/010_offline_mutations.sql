create table if not exists public.offline_mutations (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete cascade,
  mutation_type text not null,
  entity_type text not null,
  entity_id uuid,
  payload jsonb not null default '{}',
  client_version integer not null default 1,
  server_version integer not null default 0,
  conflict_status text not null default 'queued' check (conflict_status in ('queued','processing','conflict','applied','discarded')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists offline_mutations_actor_status_idx on public.offline_mutations(actor_id, conflict_status, created_at desc);
alter table public.offline_mutations enable row level security;
create policy "actor owns offline mutations" on public.offline_mutations for all using (auth.uid() = actor_id) with check (auth.uid() = actor_id);
