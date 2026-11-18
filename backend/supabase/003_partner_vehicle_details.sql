-- Store each vehicle's onboarding details without rewriting existing application records.
begin;

alter table public.partner_applications
  add column if not exists vehicle_details jsonb not null default '[]'::jsonb;

do $$
begin
  if exists (
    select phone_e164
    from public.partner_applications
    where status in ('submitted', 'under_review', 'additional_info_required', 'approved')
    group by phone_e164
    having count(*) > 1
  ) then
    raise exception 'Duplicate active partner applications exist; resolve them before applying the active-phone constraint.';
  end if;
end $$;

create unique index if not exists partner_applications_active_phone_uidx
  on public.partner_applications(phone_e164)
  where status in ('submitted', 'under_review', 'additional_info_required', 'approved');

alter table public.partner_applications
  drop constraint if exists partner_applications_status_check;

alter table public.partner_applications
  add constraint partner_applications_status_check
  check (status in ('submitted', 'under_review', 'additional_info_required', 'approved', 'rejected'));

create table if not exists public.partner_application_history (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.partner_applications(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  actor_type text not null check (actor_type in ('public', 'admin', 'system')),
  action text not null check (action in ('submitted', 'reviewed')),
  old_status text,
  new_status text not null,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists partner_application_history_created_idx
  on public.partner_application_history(application_id, created_at);

alter table public.partner_application_history enable row level security;
revoke all on public.partner_application_history from public, anon, authenticated;
grant select, insert on public.partner_application_history to service_role;

create or replace function public.record_partner_application_history()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.partner_application_history (
      application_id, actor_type, action, new_status, review_note
    ) values (
      new.id, 'public', 'submitted', new.status, new.review_note
    );
  elsif old.status is distinct from new.status
     or old.review_note is distinct from new.review_note then
    insert into public.partner_application_history (
      application_id, actor_id, actor_type, action, old_status, new_status, review_note
    ) values (
      new.id,
      new.reviewed_by,
      case when new.reviewed_by is null then 'system' else 'admin' end,
      'reviewed',
      old.status,
      new.status,
      new.review_note
    );
  end if;
  return new;
end;
$$;

revoke all on function public.record_partner_application_history() from public, anon, authenticated;

drop trigger if exists partner_applications_history on public.partner_applications;
create trigger partner_applications_history
  after insert or update of status, review_note on public.partner_applications
  for each row execute function public.record_partner_application_history();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'partner_applications_vehicle_details_array_check'
      and conrelid = 'public.partner_applications'::regclass
  ) then
    alter table public.partner_applications
      add constraint partner_applications_vehicle_details_array_check
      check (jsonb_typeof(vehicle_details) = 'array');
  end if;
end $$;

commit;
