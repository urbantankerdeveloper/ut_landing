alter table public.bookings
  add column if not exists tracking_confirmation_email_sent_at timestamptz;
