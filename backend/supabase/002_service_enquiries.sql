-- Additive migration for structured public service enquiries and an append-only status history.
begin;

alter table public.enquiries
  add column if not exists customer_name text,
  add column if not exists mobile_e164 text,
  add column if not exists email text,
  add column if not exists location text,
  add column if not exists service_category text,
  add column if not exists required_date date,
  add column if not exists service_details jsonb not null default '{}'::jsonb,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'enquiries_service_category_check'
      and conrelid = 'public.enquiries'::regclass
  ) then
    alter table public.enquiries
      add constraint enquiries_service_category_check
      check (service_category is null or service_category in ('empty_tanker', 'rmc', 'borewell'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'enquiries_mobile_e164_check'
      and conrelid = 'public.enquiries'::regclass
  ) then
    alter table public.enquiries
      add constraint enquiries_mobile_e164_check
      check (mobile_e164 is null or mobile_e164 ~ '^\+91[6-9][0-9]{9}$');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'enquiries_service_details_object_check'
      and conrelid = 'public.enquiries'::regclass
  ) then
    alter table public.enquiries
      add constraint enquiries_service_details_object_check
      check (jsonb_typeof(service_details) = 'object');
  end if;
end;
$$;

create index if not exists enquiries_category_status_created_idx
  on public.enquiries(service_category, status, created_at desc);

create table if not exists public.enquiry_history (
  id uuid primary key default gen_random_uuid(),
  enquiry_id uuid not null references public.enquiries(id),
  actor_id uuid references public.profiles(id) on delete set null,
  actor_type text not null check (actor_type in ('public', 'customer', 'admin', 'system')),
  action text not null check (action in ('submitted', 'updated')),
  old_status text,
  new_status text,
  response text,
  created_at timestamptz not null default now()
);

create index if not exists enquiry_history_enquiry_created_idx
  on public.enquiry_history(enquiry_id, created_at);

alter table public.enquiry_history enable row level security;
revoke all on public.enquiry_history from public, anon, authenticated;
grant select, insert on public.enquiry_history to service_role;

create or replace function public.record_enquiry_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.enquiry_history (
      enquiry_id, actor_id, actor_type, action, new_status, response
    ) values (
      new.id,
      new.customer_id,
      case when new.customer_id is null then 'public' else 'customer' end,
      'submitted',
      new.status,
      new.response
    );
  elsif old.status is distinct from new.status
     or old.response is distinct from new.response then
    insert into public.enquiry_history (
      enquiry_id, actor_id, actor_type, action, old_status, new_status, response
    ) values (
      new.id,
      new.updated_by,
      case when new.updated_by is null then 'system' else 'admin' end,
      'updated',
      old.status,
      new.status,
      new.response
    );
  end if;
  return new;
end;
$$;

revoke all on function public.record_enquiry_history() from public, anon, authenticated;

drop trigger if exists enquiries_history on public.enquiries;
create trigger enquiries_history
  after insert or update of status, response on public.enquiries
  for each row execute function public.record_enquiry_history();

commit;
