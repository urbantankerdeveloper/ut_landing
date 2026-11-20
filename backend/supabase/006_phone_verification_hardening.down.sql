begin;

-- Roll back the backend release that calls these objects before applying this migration.
drop function if exists public.finish_user_phone_verification_attempt(uuid, uuid, boolean);
drop function if exists public.begin_user_phone_verification_attempt(text, uuid);
drop table if exists public.user_phone_verification_lockouts;
alter table public.guest_otp_challenges
  drop column if exists consumed_at;

commit;
