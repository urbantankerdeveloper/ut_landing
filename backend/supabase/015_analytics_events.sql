create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null check (length(event_name) between 2 and 80),
  session_id text not null check (length(session_id) between 8 and 120),
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_created_at_idx
  on public.analytics_events(created_at desc);

create index if not exists analytics_events_name_created_at_idx
  on public.analytics_events(event_name, created_at desc);

alter table public.analytics_events enable row level security;
