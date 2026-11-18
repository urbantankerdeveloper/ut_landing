begin;

alter table public.service_catalog
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

create table if not exists public.service_pricing_history (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.service_catalog(id) on delete restrict,
  service_code text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('created', 'updated')),
  old_base_price_paise integer,
  new_base_price_paise integer not null check (new_base_price_paise >= 0),
  old_config jsonb,
  new_config jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists service_pricing_history_service_created_idx
  on public.service_pricing_history(service_id, created_at desc);

alter table public.service_pricing_history enable row level security;
revoke all on public.service_pricing_history from public, anon, authenticated;
grant select on public.service_pricing_history to service_role;

create or replace function public.record_service_pricing_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.service_pricing_history (
      service_id, service_code, changed_by, action,
      new_base_price_paise, new_config
    ) values (
      new.id, new.code, new.updated_by, 'created',
      new.base_price_paise, coalesce(new.config, '{}'::jsonb)
    );
  else
    insert into public.service_pricing_history (
      service_id, service_code, changed_by, action,
      old_base_price_paise, new_base_price_paise, old_config, new_config
    ) values (
      new.id, new.code, new.updated_by, 'updated',
      old.base_price_paise, new.base_price_paise,
      coalesce(old.config, '{}'::jsonb), coalesce(new.config, '{}'::jsonb)
    );
  end if;
  return new;
end;
$$;

revoke all on function public.record_service_pricing_history() from public, anon, authenticated;

drop trigger if exists service_catalog_pricing_history_insert on public.service_catalog;
create trigger service_catalog_pricing_history_insert
  after insert on public.service_catalog
  for each row execute function public.record_service_pricing_history();

drop trigger if exists service_catalog_pricing_history_update on public.service_catalog;
create trigger service_catalog_pricing_history_update
  after update of base_price_paise, config on public.service_catalog
  for each row
  when (
    old.base_price_paise is distinct from new.base_price_paise
    or old.config is distinct from new.config
  )
  execute function public.record_service_pricing_history();

commit;
