begin;

alter table public.bookings
  add column if not exists order_group_id uuid,
  add column if not exists order_group_reference text,
  add column if not exists order_group_size integer;

create index if not exists bookings_order_group_idx
  on public.bookings(order_group_id, created_at)
  where order_group_id is not null;

create or replace function public.create_customer_bookings(
  p_bookings jsonb,
  p_notifications jsonb,
  p_payment jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task jsonb;
  v_booking public.bookings;
  v_existing public.bookings;
  v_rows jsonb := '[]'::jsonb;
  v_created boolean := false;
  v_task_count integer;
  v_task_index integer := 0;
  v_customer_id uuid;
  v_idempotency_key uuid;
begin
  if jsonb_typeof(p_bookings) <> 'array' then
    raise exception 'p_bookings must be a JSON array';
  end if;

  v_task_count := jsonb_array_length(p_bookings);
  if v_task_count < 2 or v_task_count > 20 then
    raise exception 'multi-service orders must contain between 2 and 20 tasks';
  end if;

  for v_task in select value from jsonb_array_elements(p_bookings)
  loop
    v_task_index := v_task_index + 1;
    v_customer_id := (v_task->>'customer_id')::uuid;
    v_idempotency_key := case
      when v_task_index = 1 then nullif(v_task->>'idempotency_key', '')::uuid
      else null
    end;

    insert into public.bookings (
      reference, customer_id, idempotency_key, vendor_id, service_code,
      capacity_litres, scheduled_for, address_text, latitude, longitude,
      access_notes, service_details, quoted_amount_paise, payment_method,
      customer_phone_e164, order_group_id, order_group_reference, order_group_size
    )
    values (
      v_task->>'reference', v_customer_id, v_idempotency_key,
      nullif(v_task->>'vendor_id', '')::uuid, v_task->>'service_code',
      nullif(v_task->>'capacity_litres', '')::integer,
      nullif(v_task->>'scheduled_for', '')::timestamptz,
      v_task->>'address_text', nullif(v_task->>'latitude', '')::numeric,
      nullif(v_task->>'longitude', '')::numeric, v_task->>'access_notes',
      coalesce(v_task->'service_details', '[]'::jsonb),
      coalesce(nullif(v_task->>'quoted_amount_paise', '')::integer, 0),
      coalesce(v_task->>'payment_method', 'wallet'),
      nullif(v_task->>'customer_phone_e164', ''),
      (v_task->>'order_group_id')::uuid, v_task->>'order_group_reference',
      v_task_count
    )
    on conflict (customer_id, idempotency_key)
      where idempotency_key is not null do nothing
    returning * into v_booking;

    if not found then
      select * into v_existing
      from public.bookings
      where customer_id = v_customer_id
        and idempotency_key = v_idempotency_key;

      if not found then
        raise exception 'idempotent booking could not be loaded';
      end if;

      if v_existing.order_group_id is not null then
        select coalesce(jsonb_agg(to_jsonb(grouped) order by grouped.created_at, grouped.reference), '[]'::jsonb)
          into v_rows
        from public.bookings as grouped
        where grouped.order_group_id = v_existing.order_group_id
          and grouped.customer_id = v_customer_id;
      else
        v_rows := jsonb_build_array(to_jsonb(v_existing));
      end if;

      return jsonb_build_object('bookings', v_rows, 'created', false);
    end if;

    v_created := true;
    v_rows := v_rows || jsonb_build_array(to_jsonb(v_booking));
  end loop;

  if p_payment is not null then
    insert into public.payments (booking_id, provider, amount_paise, currency, status)
    values (
      (v_rows->0->>'id')::uuid, p_payment->>'provider',
      (p_payment->>'amount_paise')::integer,
      coalesce(p_payment->>'currency', 'INR'),
      coalesce(p_payment->>'status', 'pending')
    );
  end if;

  for v_task in select value from jsonb_array_elements(v_rows)
  loop
    insert into public.notifications (recipient_id, event_type, title, payload)
    select n.recipient_id, n.event_type, n.title,
      coalesce(n.payload, '{}'::jsonb) || jsonb_build_object(
        'bookingId', v_task->>'id',
        'reference', v_task->>'reference',
        'orderGroupId', v_task->>'order_group_id',
        'orderGroupReference', v_task->>'order_group_reference',
        'taskCount', nullif(v_task->>'order_group_size', '')::integer
      )
    from jsonb_to_recordset(coalesce(p_notifications, '[]'::jsonb))
      as n(recipient_id uuid, event_type text, title text, payload jsonb);
  end loop;

  return jsonb_build_object('bookings', v_rows, 'created', v_created);
end;
$$;

revoke all on function public.create_customer_bookings(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_customer_bookings(jsonb, jsonb, jsonb)
  to service_role;

create or replace function public.cancel_customer_unpaid_order(
  p_booking_id uuid,
  p_customer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
  v_created_at timestamptz;
  v_booking_ids uuid[];
begin
  select order_group_id, created_at
    into v_group_id, v_created_at
  from public.bookings
  where id = p_booking_id and customer_id = p_customer_id
  for update;

  if not found then
    return jsonb_build_object('deleted', false, 'reason', 'not_found');
  end if;

  perform id
  from public.bookings
  where customer_id = p_customer_id
    and (id = p_booking_id or (v_group_id is not null and order_group_id = v_group_id))
  order by id
  for update;

  select array_agg(id)
    into v_booking_ids
  from public.bookings
  where customer_id = p_customer_id
    and (id = p_booking_id or (v_group_id is not null and order_group_id = v_group_id));

  if exists (
    select 1 from public.bookings
    where id = any(v_booking_ids)
      and (payment_method <> 'gateway' or status not in ('pending_vendor', 'vendor_assigned'))
  ) then
    return jsonb_build_object('deleted', false, 'reason', 'status');
  end if;

  if exists (
    select 1 from public.payments
    where booking_id = any(v_booking_ids) and status = 'paid'
  ) then
    return jsonb_build_object('deleted', false, 'reason', 'paid');
  end if;

  delete from public.payments
  where booking_id = any(v_booking_ids) and status <> 'paid';

  delete from public.bookings where id = any(v_booking_ids);

  return jsonb_build_object('deleted', true, 'created_at', v_created_at);
end;
$$;

revoke all on function public.cancel_customer_unpaid_order(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cancel_customer_unpaid_order(uuid, uuid)
  to service_role;

commit;
