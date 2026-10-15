alter table public.bookings
  add column if not exists customer_phone_e164 text;

create table if not exists public.guest_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  otp_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists guest_otp_challenges_phone_created_idx
  on public.guest_otp_challenges(phone_e164, created_at desc);
