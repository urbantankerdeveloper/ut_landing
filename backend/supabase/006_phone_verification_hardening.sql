begin;

-- Adds persisted account-level lockouts to the existing shared OTP challenge flow.
alter table public.guest_otp_challenges
  add column if not exists consumed_at timestamptz;

create table if not exists public.user_phone_verification_lockouts (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.user_phone_verification_lockouts enable row level security;
revoke all on public.user_phone_verification_lockouts from public, anon, authenticated;
grant all on public.user_phone_verification_lockouts to service_role;

create or replace function public.begin_user_phone_verification_attempt(
  p_phone text,
  p_user_id uuid
)
returns table(challenge_id uuid, otp_hash text, outcome text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_failed_attempts integer;
  v_locked_until timestamptz;
  v_challenge public.guest_otp_challenges%rowtype;
begin
  insert into public.user_phone_verification_lockouts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select lockout.failed_attempts, lockout.locked_until
    into v_failed_attempts, v_locked_until
    from public.user_phone_verification_lockouts as lockout
    where lockout.user_id = p_user_id
    for update;

  if v_locked_until > now() then
    return query select null::uuid, null::text, 'locked'::text,
      greatest(1, ceil(extract(epoch from (v_locked_until - now())))::integer);
    return;
  end if;

  if v_locked_until is not null then
    update public.user_phone_verification_lockouts as lockout
      set failed_attempts = 0, locked_until = null, updated_at = now()
      where lockout.user_id = p_user_id;
    v_failed_attempts := 0;
  end if;

  select challenge.*
    into v_challenge
    from public.guest_otp_challenges as challenge
    where challenge.user_id = p_user_id
      and challenge.phone_e164 = p_phone
      and challenge.template_key = 'user_registration_otp'
      and challenge.verified_at is null
      and challenge.expires_at > now()
    order by challenge.created_at desc
    limit 1
    for update;

  if not found then
    return query select null::uuid, null::text, 'invalid'::text, null::integer;
    return;
  end if;

  if v_challenge.attempts >= 5 then
    update public.user_phone_verification_lockouts as lockout
      set failed_attempts = 5, locked_until = now() + interval '10 minutes', updated_at = now()
      where lockout.user_id = p_user_id
      returning lockout.failed_attempts, lockout.locked_until
        into v_failed_attempts, v_locked_until;
    return query select null::uuid, null::text, 'locked'::text, 600;
    return;
  end if;

  update public.guest_otp_challenges as challenge
    set attempts = challenge.attempts + 1
    where challenge.id = v_challenge.id;

  return query select v_challenge.id, v_challenge.otp_hash, 'check'::text, null::integer;
end;
$$;

create or replace function public.finish_user_phone_verification_attempt(
  p_challenge_id uuid,
  p_user_id uuid,
  p_is_correct boolean
)
returns table(outcome text, locked_until timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_failed_attempts integer;
  v_locked_until timestamptz;
  v_challenge_id uuid;
begin
  insert into public.user_phone_verification_lockouts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select lockout.failed_attempts, lockout.locked_until
    into v_failed_attempts, v_locked_until
    from public.user_phone_verification_lockouts as lockout
   where lockout.user_id = p_user_id
   for update;

  if v_locked_until > now() then
    return query select 'locked'::text, v_locked_until;
    return;
  end if;

  select challenge.id
    into v_challenge_id
    from public.guest_otp_challenges as challenge
   where challenge.id = p_challenge_id
     and challenge.user_id = p_user_id
     and challenge.verified_at is null
     and challenge.expires_at > now()
   for update;
  if not found then
    return query select 'invalid'::text, null::timestamptz;
    return;
  end if;

  if p_is_correct then
    update public.guest_otp_challenges as challenge
       set verified_at = now()
     where challenge.id = p_challenge_id
       and challenge.user_id = p_user_id
       and challenge.verified_at is null
       and challenge.expires_at > now();
    if not found then
      return query select 'invalid'::text, null::timestamptz;
      return;
    end if;
    update public.user_phone_verification_lockouts as lockout
       set failed_attempts = 0, locked_until = null, updated_at = now()
     where lockout.user_id = p_user_id;
    return query select 'valid'::text, null::timestamptz;
    return;
  end if;

  update public.user_phone_verification_lockouts as lockout
    set failed_attempts = lockout.failed_attempts + 1,
        locked_until = case when lockout.failed_attempts + 1 >= 5 then now() + interval '10 minutes' else null end,
        updated_at = now()
    where lockout.user_id = p_user_id
    returning lockout.failed_attempts, lockout.locked_until
      into v_failed_attempts, v_locked_until;

  if v_locked_until is not null then
    return query select 'locked'::text, v_locked_until;
    return;
  end if;

  return query select 'incorrect'::text, null::timestamptz;
end;
$$;

revoke all on function public.begin_user_phone_verification_attempt(text, uuid) from public, anon, authenticated;
grant execute on function public.begin_user_phone_verification_attempt(text, uuid) to service_role;
revoke all on function public.finish_user_phone_verification_attempt(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.finish_user_phone_verification_attempt(uuid, uuid, boolean) to service_role;

commit;
