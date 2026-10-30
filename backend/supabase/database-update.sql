-- Safe, repeatable update for an existing Urban Tanker database.
-- This file preserves application data. Use 001_initial.sql only for a fresh/reset install.

begin;

alter table public.vendors
  add column if not exists latitude numeric(9,6),
  add column if not exists longitude numeric(9,6);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vendors_coordinates_pair_check'
      and conrelid = 'public.vendors'::regclass
  ) then
    alter table public.vendors
      add constraint vendors_coordinates_pair_check check (
        (latitude is null) = (longitude is null)
        and (latitude is null or latitude between -90 and 90)
        and (longitude is null or longitude between -180 and 180)
      );
  end if;
end $$;

alter table public.bookings add column if not exists idempotency_key uuid;
alter table public.bookings add column if not exists payment_method text not null default 'wallet';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_payment_method_check' and conrelid = 'public.bookings'::regclass) then
    alter table public.bookings add constraint bookings_payment_method_check check (payment_method in ('wallet', 'gateway', 'cod'));
  end if;
end $$;
create unique index if not exists bookings_customer_idempotency_key_idx
  on public.bookings(customer_id, idempotency_key) where idempotency_key is not null;

create or replace function public.create_customer_booking(p_booking jsonb, p_notifications jsonb, p_payment jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_booking public.bookings;
  v_created boolean;
begin
  insert into public.bookings (reference, customer_id, idempotency_key, vendor_id, service_code,
    capacity_litres, scheduled_for, address_text, latitude, longitude, access_notes,
    service_details, quoted_amount_paise, payment_method)
  values (p_booking->>'reference', (p_booking->>'customer_id')::uuid,
    nullif(p_booking->>'idempotency_key', '')::uuid, nullif(p_booking->>'vendor_id', '')::uuid,
    p_booking->>'service_code', nullif(p_booking->>'capacity_litres', '')::integer,
    nullif(p_booking->>'scheduled_for', '')::timestamptz, p_booking->>'address_text',
    nullif(p_booking->>'latitude', '')::numeric, nullif(p_booking->>'longitude', '')::numeric,
    p_booking->>'access_notes', coalesce(p_booking->'service_details', '[]'::jsonb),
    coalesce(nullif(p_booking->>'quoted_amount_paise', '')::integer, 0),
    coalesce(p_booking->>'payment_method', 'wallet'))
  on conflict (customer_id, idempotency_key) where idempotency_key is not null do nothing
  returning * into v_booking;
  v_created := found;

  if not v_created then
    select * into v_booking
    from public.bookings
    where customer_id = (p_booking->>'customer_id')::uuid
      and idempotency_key = (p_booking->>'idempotency_key')::uuid;
  else
    if p_payment is not null then
      insert into public.payments (booking_id, provider, amount_paise, currency, status)
      values (v_booking.id, p_payment->>'provider', (p_payment->>'amount_paise')::integer,
        coalesce(p_payment->>'currency', 'INR'), coalesce(p_payment->>'status', 'pending'));
    end if;

    insert into public.notifications (recipient_id, event_type, title, payload)
    select n.recipient_id, n.event_type, n.title,
      coalesce(n.payload, '{}'::jsonb) || jsonb_build_object('bookingId', v_booking.id, 'reference', v_booking.reference)
    from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb))
      as n(recipient_id uuid, event_type text, title text, payload jsonb);
  end if;

  return jsonb_build_object('booking', to_jsonb(v_booking), 'created', v_created);
end;
$$;
revoke all on function public.create_customer_booking(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_customer_booking(jsonb, jsonb, jsonb) to service_role;

commit;
