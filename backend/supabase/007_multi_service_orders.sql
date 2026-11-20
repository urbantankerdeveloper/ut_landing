-- Feature 2: normalized parent orders, service items and vendor fulfilments.
-- Deploy the backend with the feature disabled, then apply before enabling; this migration is additive.
begin;
create table if not exists public.service_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique references public.service_catalog(code) on update cascade on delete restrict,
  name text not null,
  active boolean not null default true,
  min_quantity numeric(12, 3) not null default 1 check (min_quantity > 0),
  max_quantity numeric(12, 3) not null default 20 check (max_quantity >= min_quantity),
  quantity_unit text not null default 'service',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.service_types (code, name, active, min_quantity, max_quantity, quantity_unit)
select code, name, is_active,
  coalesce(nullif(config->>'min_quantity','')::numeric,1),
  coalesce(nullif(config->>'max_quantity','')::numeric,20),
  coalesce(nullif(config->>'quantity_unit', ''), nullif(config->>'unit',''), 'service')
from public.service_catalog
on conflict (code) do update set name = excluded.name, active = excluded.active;

create or replace function public.sync_catalog_service_type()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.service_types(code,name,active,min_quantity,max_quantity,quantity_unit,updated_at)
  values(new.code,new.name,new.is_active,
    coalesce(nullif(new.config->>'min_quantity','')::numeric,1),
    coalesce(nullif(new.config->>'max_quantity','')::numeric,20),
    coalesce(nullif(new.config->>'quantity_unit',''),nullif(new.config->>'unit',''),'service'),
    now())
  on conflict(code) do update set name=excluded.name,active=excluded.active,
    min_quantity=excluded.min_quantity,max_quantity=excluded.max_quantity,quantity_unit=excluded.quantity_unit,updated_at=now();
  return new;
end $$;
drop trigger if exists service_catalog_service_type_sync on public.service_catalog;
create trigger service_catalog_service_type_sync after insert or update of name,is_active,config on public.service_catalog
for each row execute function public.sync_catalog_service_type();

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  customer_id uuid references public.profiles(id) on delete set null,
  legacy_booking_id uuid unique references public.bookings(id) on delete set null,
  legacy_group_key text unique,
  idempotency_key uuid,
  payment_method text not null check (payment_method in ('wallet','gateway','cod')),
  status text not null default 'pending_vendor'
    check (status in ('pending_vendor','partially_accepted','accepted','in_progress','partially_completed','completed','cancelled')),
  total_paise integer not null check (total_paise >= 0),
  currency char(3) not null default 'INR',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (customer_id, idempotency_key)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  service_type_id uuid not null references public.service_types(id) on delete restrict,
  legacy_booking_id uuid references public.bookings(id) on delete set null,
  legacy_item_key text unique,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  quantity_unit text not null default 'service',
  location text not null,
  latitude numeric(9,6),
  longitude numeric(9,6),
  scheduled_for timestamptz,
  slot text,
  service_details jsonb not null default '{}'::jsonb,
  locked_price_paise integer not null check (locked_price_paise >= 0),
  delivery_charge_paise integer not null default 0 check (delivery_charge_paise >= 0),
  discount_paise integer not null default 0 check (discount_paise >= 0),
  status text not null default 'pending_vendor'
    check (status in ('pending_vendor','offered','accepted','en_route','arrived','delivered','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);
create index if not exists order_items_order_status_idx on public.order_items(order_id, status);
create index if not exists order_items_schedule_idx on public.order_items(scheduled_for) where status = 'pending_vendor';

create table if not exists public.order_fulfilments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  legacy_booking_id uuid references public.bookings(id) on delete set null,
  reference text not null unique,
  vendor_id uuid references public.vendors(id) on delete set null,
  status text not null default 'pending_vendor'
    check (status in ('pending_vendor','offered','accepted','en_route','arrived','delivered','cancelled')),
  delivery_otp_hash text,
  delivery_otp_expires_at timestamptz,
  delivery_otp_attempts integer not null default 0 check (delivery_otp_attempts between 0 and 5),
  delivery_otp_locked_at timestamptz,
  delivery_otp_sms_sent boolean,
  delivery_otp_requests integer not null default 0 check (delivery_otp_requests between 0 and 100),
  delivery_otp_last_requested_at timestamptz,
  latitude numeric(9,6),
  longitude numeric(9,6),
  delivered_at timestamptz,
  offer_expires_at timestamptz,
  commission_paise integer not null default 0 check (commission_paise >= 0),
  vendor_payout_paise integer not null default 0 check (vendor_payout_paise >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists order_fulfilments_vendor_status_idx on public.order_fulfilments(vendor_id, status);
create index if not exists order_fulfilments_unassigned_idx on public.order_fulfilments(status, created_at) where vendor_id is null;

create table if not exists public.order_fulfilment_items (
  fulfilment_id uuid not null references public.order_fulfilments(id) on delete cascade,
  item_id uuid not null references public.order_items(id) on delete cascade,
  primary key (fulfilment_id, item_id),
  unique (item_id)
);

create table if not exists public.vendor_services (
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  service_type_id uuid not null references public.service_types(id) on delete cascade,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (vendor_id, service_type_id)
);
insert into public.vendor_services (vendor_id, service_type_id, active)
select availability.vendor_id, service_type.id, availability.is_enabled
from public.vendor_service_availability availability
join public.service_types service_type on service_type.code = availability.service_code
on conflict (vendor_id, service_type_id) do update set active = excluded.active;
insert into public.vendor_services (vendor_id, service_type_id, active)
select v.id, st.id, true
from public.vendors v cross join public.service_types st
where not exists (
  select 1 from public.vendor_service_availability a
  where a.vendor_id = v.id and a.service_code = st.code
)
on conflict (vendor_id, service_type_id) do nothing;

create or replace function public.sync_vendor_service_type_availability()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.vendor_services(vendor_id,service_type_id,active,updated_at)
  select new.vendor_id,st.id,new.is_enabled,now() from public.service_types st where st.code=new.service_code
  on conflict(vendor_id,service_type_id) do update set active=excluded.active,updated_at=now();
  return new;
end $$;
drop trigger if exists vendor_service_types_sync on public.vendor_service_availability;
create trigger vendor_service_types_sync after insert or update of is_enabled on public.vendor_service_availability
for each row execute function public.sync_vendor_service_type_availability();

create or replace function public.seed_vendor_service_types()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.vendor_services(vendor_id,service_type_id,active)
  select new.id,st.id,true from public.service_types st
  on conflict(vendor_id,service_type_id) do nothing;
  return new;
end $$;
drop trigger if exists vendors_seed_service_types on public.vendors;
create trigger vendors_seed_service_types after insert on public.vendors
for each row execute function public.seed_vendor_service_types();
create or replace function public.seed_service_type_vendor_capabilities()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.vendor_services(vendor_id,service_type_id,active)
  select v.id,new.id,true from public.vendors v
  on conflict(vendor_id,service_type_id) do nothing;
  return new;
end $$;
drop trigger if exists service_types_seed_vendor_capabilities on public.service_types;
create trigger service_types_seed_vendor_capabilities after insert on public.service_types
for each row execute function public.seed_service_type_vendor_capabilities();

create table if not exists public.order_offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  fulfilment_id uuid references public.order_fulfilments(id) on delete cascade,
  offer_scope_id uuid not null,
  item_ids uuid[] not null,
  is_bundle boolean not null default false,
  status text not null default 'offered' check (status in ('offered','accepted','expired','declined','taken','cancelled')),
  expires_at timestamptz not null,
  availability_snapshot jsonb not null default '{}'::jsonb,
  bundle_priority_at timestamptz,
  distance_km numeric(8,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, vendor_id, is_bundle, offer_scope_id)
);
create index if not exists order_offers_expiry_idx on public.order_offers(expires_at) where status = 'offered';
create index if not exists order_offers_vendor_idx on public.order_offers(vendor_id, status, created_at desc);

create table if not exists public.order_fulfilment_ratings (
  id uuid primary key default gen_random_uuid(),
  fulfilment_id uuid not null references public.order_fulfilments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid references public.profiles(id) on delete set null,
  rating integer not null check (rating between 1 and 5),
  review text,
  created_at timestamptz not null default now(),
  unique (fulfilment_id, customer_id)
);

create table if not exists public.order_fulfilment_ledger (
  id uuid primary key default gen_random_uuid(),
  fulfilment_id uuid not null unique references public.order_fulfilments(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete set null,
  gross_paise integer not null check (gross_paise >= 0),
  commission_paise integer not null check (commission_paise >= 0),
  payout_paise integer not null check (payout_paise >= 0),
  settled_payout_id uuid references public.vendor_payouts(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.order_refunds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id uuid not null references public.order_items(id) on delete cascade,
  idempotency_key uuid not null,
  amount_paise integer not null check (amount_paise > 0),
  provider_refund_id text,
  status text not null default 'pending' check (status in ('pending','processed','failed')),
  created_at timestamptz not null default now(),
  unique (order_id, idempotency_key),
  unique (item_id)
);

create table if not exists public.order_admin_audit (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  fulfilment_id uuid references public.order_fulfilments(id) on delete set null,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  reason text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.invoices add column if not exists order_id uuid references public.orders(id) on delete set null;
alter table public.invoices add column if not exists fulfilment_id uuid references public.order_fulfilments(id) on delete set null;
create unique index if not exists invoices_fulfilment_unique_idx on public.invoices(fulfilment_id) where fulfilment_id is not null;

-- Backfill one parent per legacy booking/group and preserve service details as individual lines.
do $$
declare
  booking_row record;
  parent_id uuid;
  parent_reference text;
  item_row record;
  item_id uuid;
  service_code_value text;
  item_index integer;
begin
  for booking_row in
    select b.*,
      coalesce(b.order_group_id, b.id) as normalized_id,
      coalesce(b.order_group_reference, b.reference) as normalized_reference,
      coalesce(b.order_group_id::text, b.id::text) as normalized_group_key
    from public.bookings b
    order by b.created_at, b.id
  loop
    parent_id := booking_row.normalized_id;
    parent_reference := booking_row.normalized_reference;
    insert into public.orders (
      id, reference, customer_id, legacy_booking_id, legacy_group_key,
      idempotency_key, payment_method, status, total_paise, created_at, updated_at
    ) values (
      parent_id, parent_reference, booking_row.customer_id, booking_row.id,
      booking_row.normalized_group_key, booking_row.idempotency_key,
      coalesce(booking_row.payment_method, 'cod'),
      case when booking_row.status = 'delivered' then 'completed'
           when booking_row.status = 'cancelled' then 'cancelled'
           when booking_row.status in ('accepted','en_route','arrived') then 'in_progress'
           else 'pending_vendor' end,
      case when booking_row.order_group_id is null then booking_row.quoted_amount_paise else 0 end,
      booking_row.created_at, booking_row.updated_at
    ) on conflict (id) do nothing;
    if booking_row.order_group_id is not null then
      update public.orders o set total_paise = (
        select coalesce(sum(b.quoted_amount_paise), 0)::integer from public.bookings b
        where b.order_group_id = booking_row.order_group_id
      ) where o.id = parent_id;
    end if;
    item_index := 0;
    if jsonb_typeof(booking_row.service_details) = 'array' and jsonb_array_length(booking_row.service_details) > 0 then
      for item_row in select value from jsonb_array_elements(booking_row.service_details)
      loop
        item_index := item_index + 1;
        service_code_value := coalesce(item_row.value->>'serviceId', booking_row.service_code);
        insert into public.service_types (code, name, active)
        select c.code, c.name, c.is_active from public.service_catalog c where c.code = service_code_value
        on conflict (code) do nothing;
        select st.id into item_id from public.service_types st where st.code = service_code_value;
        if item_id is not null and not exists (
          select 1 from public.order_items oi
          where oi.legacy_item_key = booking_row.id::text || ':' || item_index::text
        ) then
          insert into public.order_items (
            order_id, service_type_id, legacy_booking_id, legacy_item_key, quantity,
            quantity_unit, location, latitude, longitude, scheduled_for, slot,
            service_details, locked_price_paise, status, created_at, updated_at
          ) values (
            parent_id, item_id, booking_row.id, booking_row.id::text || ':' || item_index::text,
            1, 'service', coalesce(item_row.value->>'location', booking_row.address_text),
            coalesce((item_row.value->>'latitude')::numeric, booking_row.latitude),
            coalesce((item_row.value->>'longitude')::numeric, booking_row.longitude),
            booking_row.scheduled_for, item_row.value->>'preferredTime', item_row.value,
            coalesce(nullif(item_row.value->'invoice_line'->>'totalPaise','')::integer,
              case when item_index = 1 then booking_row.quoted_amount_paise else 0 end),
            case when booking_row.status = 'delivered' then 'delivered'
                 when booking_row.status = 'cancelled' then 'cancelled'
                 when booking_row.status in ('accepted','en_route','arrived') then booking_row.status::text
                 when booking_row.status = 'vendor_assigned' then 'accepted'
                 else 'pending_vendor' end,
            booking_row.created_at, booking_row.updated_at
          ) returning id into item_id;
          insert into public.order_fulfilments (id, order_id, legacy_booking_id, reference, vendor_id, status, delivered_at, created_at, updated_at)
          values (item_id, parent_id, booking_row.id, booking_row.reference || '-' || item_index, booking_row.vendor_id,
            case when booking_row.status = 'vendor_assigned' then 'accepted' else booking_row.status::text end,
            case when booking_row.status = 'delivered' then booking_row.updated_at else null end,
            booking_row.created_at, booking_row.updated_at)
          on conflict (id) do nothing;
          insert into public.order_fulfilment_items (fulfilment_id, item_id) values (item_id, item_id) on conflict do nothing;
        end if;
      end loop;
    else
      service_code_value := booking_row.service_code;
      select st.id into item_id from public.service_types st where st.code = service_code_value;
      if item_id is not null and not exists (select 1 from public.order_items oi where oi.legacy_item_key = booking_row.id::text || ':1') then
        insert into public.order_items (
          order_id, service_type_id, legacy_booking_id, legacy_item_key, location,
          latitude, longitude, scheduled_for, locked_price_paise, service_details, status,
          created_at, updated_at
        ) values (
          parent_id, item_id, booking_row.id, booking_row.id::text || ':1', booking_row.address_text,
          booking_row.latitude, booking_row.longitude, booking_row.scheduled_for,
          booking_row.quoted_amount_paise, coalesce(booking_row.service_details, '{}'::jsonb),
          case when booking_row.status = 'delivered' then 'delivered'
               when booking_row.status = 'cancelled' then 'cancelled'
               when booking_row.status in ('accepted','en_route','arrived') then booking_row.status::text
               when booking_row.status = 'vendor_assigned' then 'accepted'
               else 'pending_vendor' end,
          booking_row.created_at, booking_row.updated_at
        ) returning id into item_id;
        insert into public.order_fulfilments (id, order_id, legacy_booking_id, reference, vendor_id, status, delivered_at, created_at, updated_at)
        values (item_id, parent_id, booking_row.id, booking_row.reference, booking_row.vendor_id,
          case when booking_row.status = 'vendor_assigned' then 'accepted' else booking_row.status::text end,
          case when booking_row.status = 'delivered' then booking_row.updated_at else null end,
          booking_row.created_at, booking_row.updated_at)
        on conflict (id) do nothing;
        insert into public.order_fulfilment_items (fulfilment_id, item_id) values (item_id, item_id) on conflict do nothing;
      end if;
    end if;
  end loop;
end $$;

create or replace function public.refresh_multi_service_order_status(p_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
  v_open integer;
  v_done integer;
  v_accepted integer;
  v_next text;
begin
  select count(*), count(*) filter (where status not in ('delivered','cancelled')),
    count(*) filter (where status = 'delivered'), count(*) filter (where status in ('accepted','en_route','arrived'))
    into v_total, v_open, v_done, v_accepted from public.order_items where order_id = p_order_id;
  if v_total = 0 then v_next := 'pending_vendor';
  elsif v_open = 0 and v_done = 0 then v_next := 'cancelled';
  elsif v_open = 0 then v_next := 'completed';
  elsif v_done > 0 then v_next := 'partially_completed';
  elsif v_accepted = v_total then v_next := 'in_progress';
  elsif v_accepted > 0 then v_next := 'partially_accepted';
  else v_next := 'pending_vendor';
  end if;
  update public.orders set status = v_next, updated_at = now() where id = p_order_id;
  update public.bookings b set status = case
      when v_open = 0 and v_done = 0 then 'cancelled'::public.booking_status
      when v_open = 0 then 'delivered'::public.booking_status
      when exists (select 1 from public.order_items i where i.order_id=p_order_id and i.status='arrived') then 'arrived'::public.booking_status
      when exists (select 1 from public.order_items i where i.order_id=p_order_id and i.status='en_route') then 'en_route'::public.booking_status
      when v_accepted > 0 then 'accepted'::public.booking_status
      else 'pending_vendor'::public.booking_status end,
    updated_at=now()
    from public.orders o where o.id=p_order_id and b.id=o.legacy_booking_id;
  return v_next;
end $$;

create or replace function public.record_multi_service_delivery_invoices()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_fulfilment public.order_fulfilments%rowtype;
  v_order public.orders%rowtype;
  v_gross integer;
  v_payment_status text;
  v_service text;
  v_location text;
  v_all_delivered boolean;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;
  select f.* into v_fulfilment from public.order_fulfilment_items fi
    join public.order_fulfilments f on f.id=fi.fulfilment_id where fi.item_id=new.id;
  if not found then return new; end if;
  select o.* into v_order from public.orders o where o.id=v_fulfilment.order_id;
  select coalesce(sum(i.locked_price_paise+i.delivery_charge_paise-i.discount_paise),0)::integer,
    string_agg(st.name,', '), string_agg(distinct i.location,', ')
    into v_gross,v_service,v_location
    from public.order_fulfilment_items fi
    join public.order_items i on i.id=fi.item_id
    join public.service_types st on st.id=i.service_type_id
    where fi.fulfilment_id=v_fulfilment.id;
  select case when p.status='paid' then 'Paid' else 'Pending' end into v_payment_status
    from public.payments p where p.booking_id=v_order.legacy_booking_id;
  insert into public.invoices(number,customer_id,service,location,amount,status,order_id,fulfilment_id,
    subtotal_paise,total_paise,payment_method,payment_status)
  select 'INV-'||v_fulfilment.reference,v_order.customer_id,coalesce(v_service,'Service'),coalesce(v_location,''),
    v_gross/100.0,coalesce(v_payment_status,'Pending'),v_order.id,v_fulfilment.id,
    v_gross,v_gross,v_order.payment_method,lower(coalesce(v_payment_status,'Pending'))
  on conflict (fulfilment_id) where fulfilment_id is not null do update set
    amount=excluded.amount,status=excluded.status,total_paise=excluded.total_paise,payment_status=excluded.payment_status;
  select not exists(select 1 from public.order_items i where i.order_id=v_order.id and i.status<>'delivered')
    into v_all_delivered;
  if v_all_delivered then
    if v_order.payment_method='cod' then
      update public.payments set status='paid',captured_at=now(),updated_at=now()
        where booking_id=v_order.legacy_booking_id and provider='cash_on_delivery' and status='pending';
    end if;
    insert into public.invoices(number,customer_id,booking_id,service,location,amount,status,order_id,
      subtotal_paise,total_paise,payment_method,payment_status)
    select 'RCT-'||v_order.reference,v_order.customer_id,v_order.legacy_booking_id,
      coalesce(string_agg(st.name,', '),'Services'),coalesce(string_agg(distinct i.location,', '),''),
      v_order.total_paise/100.0,
      case when p.status='paid' or v_order.payment_method='cod' then 'Paid' else 'Pending' end,
      v_order.id,v_order.total_paise,v_order.total_paise,v_order.payment_method,
      case when p.status='paid' or v_order.payment_method='cod' then 'paid' else 'pending' end
    from public.order_items i join public.service_types st on st.id=i.service_type_id
    left join public.payments p on p.booking_id=v_order.legacy_booking_id
    where i.order_id=v_order.id
    group by p.status
    on conflict (booking_id) do update set
      amount=excluded.amount,status=excluded.status,total_paise=excluded.total_paise,payment_status=excluded.payment_status;
  end if;
  return new;
end $$;
drop trigger if exists order_item_delivery_invoice on public.order_items;
create trigger order_item_delivery_invoice after update of status on public.order_items
for each row execute function public.record_multi_service_delivery_invoices();

create or replace function public.sync_multi_service_invoice_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status and new.refunded_paise is not distinct from old.refunded_paise then return new; end if;
  update public.invoices i set
    status=case when new.status='refunded' or coalesce(new.refunded_paise,0)>=new.amount_paise then 'refunded'
      when coalesce(new.refunded_paise,0)>0 then 'partially_refunded'
      when new.status='paid' then 'Paid' else 'Pending' end,
    payment_status=case when new.status='refunded' or coalesce(new.refunded_paise,0)>=new.amount_paise then 'refunded'
      when coalesce(new.refunded_paise,0)>0 then 'partially_refunded'
      when new.status='paid' then 'paid' else 'pending' end,
    paid_at=case when new.status='paid' then coalesce(new.captured_at,now()) else paid_at end
  from public.orders o where o.legacy_booking_id=new.booking_id and i.order_id=o.id;
  return new;
end $$;
drop trigger if exists multi_service_payment_invoice_sync on public.payments;
create trigger multi_service_payment_invoice_sync after update of status,refunded_paise on public.payments
for each row execute function public.sync_multi_service_invoice_payment();

create or replace function public.create_multi_service_order(p_order jsonb, p_items jsonb, p_payment jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_order_id uuid := gen_random_uuid();
  v_booking_id uuid := gen_random_uuid();
  v_customer_id uuid := (p_order->>'customer_id')::uuid;
  v_reference text := p_order->>'reference';
  v_total integer := (p_order->>'total_paise')::integer;
  v_first jsonb;
  v_item jsonb;
  v_service record;
  v_item_id uuid;
  v_item_count integer := jsonb_array_length(p_items);
  v_existing public.orders%rowtype;
begin
  if v_item_count < 1 or v_item_count > 20 then raise exception 'INVALID_ITEM_COUNT'; end if;
  if p_order->>'idempotency_key' is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_customer_id::text || ':' || (p_order->>'idempotency_key'), 0));
    select * into v_existing from public.orders where customer_id = v_customer_id
      and idempotency_key = (p_order->>'idempotency_key')::uuid;
    if found then
      return jsonb_build_object('created', false, 'order', to_jsonb(v_existing), 'legacyBookingId', v_existing.legacy_booking_id);
    end if;
  end if;
  v_first := p_items->0;
  select * into v_service from public.service_types where code = v_first->>'service_code' and active;
  if not found then raise exception 'SERVICE_UNAVAILABLE'; end if;
  insert into public.bookings (
    id, reference, customer_id, idempotency_key, payment_method, service_code,
    service_details, address_text, latitude, longitude, scheduled_for, quoted_amount_paise, status,
    customer_phone_e164
  ) values (
    v_booking_id, v_reference, v_customer_id, nullif(p_order->>'idempotency_key','')::uuid,
    p_order->>'payment_method', v_first->>'service_code', p_order->'legacy_service_details',
    coalesce(v_first->>'location', p_order->>'location'),
    nullif(v_first->>'latitude','')::numeric, nullif(v_first->>'longitude','')::numeric,
    nullif(v_first->>'scheduled_for','')::timestamptz, v_total, 'pending_vendor',
    nullif(p_order->>'customer_phone_e164','')
  );
  insert into public.orders (id, reference, customer_id, legacy_booking_id, idempotency_key, payment_method, total_paise)
  values (v_order_id, v_reference, v_customer_id, v_booking_id,
    nullif(p_order->>'idempotency_key','')::uuid, p_order->>'payment_method', v_total);
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select * into v_service from public.service_types where code = v_item->>'service_code' and active;
    if not found then raise exception 'SERVICE_UNAVAILABLE'; end if;
    if (v_item->>'quantity')::numeric < v_service.min_quantity or (v_item->>'quantity')::numeric > v_service.max_quantity then
      raise exception 'INVALID_SERVICE_QUANTITY';
    end if;
    v_item_id := gen_random_uuid();
    insert into public.order_items (
      id, order_id, service_type_id, legacy_booking_id, quantity, quantity_unit, location, latitude, longitude,
      scheduled_for, slot, service_details, locked_price_paise, delivery_charge_paise, discount_paise
    ) values (
      v_item_id, v_order_id, v_service.id, v_booking_id, (v_item->>'quantity')::numeric,
      coalesce(nullif(v_item->>'quantity_unit',''), v_service.quantity_unit),
      v_item->>'location', nullif(v_item->>'latitude','')::numeric, nullif(v_item->>'longitude','')::numeric,
      nullif(v_item->>'scheduled_for','')::timestamptz, v_item->>'slot',
      coalesce(v_item->'service_details','{}'::jsonb), (v_item->>'locked_price_paise')::integer,
      coalesce((v_item->>'delivery_charge_paise')::integer,0), coalesce((v_item->>'discount_paise')::integer,0)
    );
    insert into public.order_fulfilments (id, order_id, legacy_booking_id, reference)
    values (v_item_id, v_order_id, v_booking_id, v_reference || '-' || substr(replace(v_item_id::text,'-',''),1,8));
    insert into public.order_fulfilment_items (fulfilment_id, item_id) values (v_item_id, v_item_id);
  end loop;
  if p_payment is not null then
    insert into public.payments (booking_id, provider, amount_paise, currency, status)
    values (v_booking_id, p_payment->>'provider', v_total, 'INR', coalesce(p_payment->>'status','pending'))
    on conflict (booking_id) do nothing;
  end if;
  return jsonb_build_object('created', true, 'order', (select to_jsonb(o) from public.orders o where o.id = v_order_id), 'legacyBookingId', v_booking_id);
end $$;

create or replace function public.accept_multi_service_offer(p_offer_id uuid, p_vendor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_offer public.order_offers%rowtype;
  v_item_id uuid;
  v_count integer := 0;
  v_expected integer;
  v_state text;
begin
  select * into v_offer from public.order_offers where id = p_offer_id for update;
  if not found then return jsonb_build_object('accepted',false,'reason','not_found'); end if;
  if v_offer.vendor_id <> p_vendor_id then return jsonb_build_object('accepted',false,'reason','not_found'); end if;
  if v_offer.status = 'accepted' then return jsonb_build_object('accepted',true,'idempotent',true,'orderId',v_offer.order_id); end if;
  if v_offer.status <> 'offered' or v_offer.expires_at <= now() then
    update public.order_offers set status = 'expired', updated_at = now() where id = v_offer.id and status = 'offered';
    return jsonb_build_object('accepted',false,'reason','expired');
  end if;
  if not exists (select 1 from public.vendors v where v.id = p_vendor_id and v.is_online and v.verification = 'approved') then
    return jsonb_build_object('accepted',false,'reason','vendor_unavailable');
  end if;
  if v_offer.is_bundle then
    select count(*) into v_expected from public.order_items where order_id = v_offer.order_id and status not in ('delivered','cancelled');
    if v_expected <> cardinality(v_offer.item_ids) then return jsonb_build_object('accepted',false,'reason','items_taken'); end if;
  end if;
  for v_item_id in select unnest(v_offer.item_ids) order by 1
  loop
    perform 1 from public.order_items where id = v_item_id and order_id = v_offer.order_id and status in ('pending_vendor','offered') for update;
    if not found then return jsonb_build_object('accepted',false,'reason','items_taken'); end if;
    if not exists (
      select 1 from public.order_fulfilment_items fi
      join public.order_fulfilments f on f.id = fi.fulfilment_id
      join public.order_items i on i.id = fi.item_id
      join public.vendor_services vs on vs.service_type_id = i.service_type_id and vs.vendor_id = p_vendor_id and vs.active
      where fi.item_id = v_item_id and f.order_id = v_offer.order_id
    ) then return jsonb_build_object('accepted',false,'reason','service_not_supported'); end if;
    v_count := v_count + 1;
  end loop;
  update public.order_items set status = 'accepted', updated_at = now() where id = any(v_offer.item_ids);
  update public.order_fulfilments f set vendor_id = p_vendor_id, status = 'accepted', updated_at = now()
  from public.order_fulfilment_items fi where fi.fulfilment_id = f.id and fi.item_id = any(v_offer.item_ids);
  update public.order_offers set status = 'accepted', updated_at = now() where id = v_offer.id;
  update public.order_offers set status = 'taken', updated_at = now()
    where order_id = v_offer.order_id and id <> v_offer.id and status = 'offered' and item_ids && v_offer.item_ids;
  v_state := public.refresh_multi_service_order_status(v_offer.order_id);
  return jsonb_build_object('accepted',true,'idempotent',false,'orderId',v_offer.order_id,'itemsAccepted',v_count,'status',v_state);
end $$;

create or replace function public.transition_multi_service_fulfilment(
  p_fulfilment_id uuid, p_vendor_id uuid, p_next_status text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.order_fulfilments%rowtype;
  v_order_status text;
begin
  select * into v_f from public.order_fulfilments where id = p_fulfilment_id for update;
  if not found or v_f.vendor_id <> p_vendor_id then return jsonb_build_object('updated',false,'reason','not_found'); end if;
  if p_next_status = 'en_route' and v_f.status = 'accepted' then
    update public.order_fulfilments set status = 'en_route', updated_at = now() where id = v_f.id;
  elsif p_next_status = 'arrived' and v_f.status = 'en_route' then
    update public.order_fulfilments set status = 'arrived', updated_at = now() where id = v_f.id;
  else
    return jsonb_build_object('updated',false,'reason','invalid_transition');
  end if;
  update public.order_items i set status = p_next_status, updated_at = now()
    from public.order_fulfilment_items fi where fi.item_id = i.id and fi.fulfilment_id = v_f.id;
  v_order_status := public.refresh_multi_service_order_status(v_f.order_id);
  return jsonb_build_object('updated',true,'orderId',v_f.order_id,'status',v_order_status);
end $$;

create or replace function public.drop_multi_service_fulfilment(p_fulfilment_id uuid, p_vendor_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.order_fulfilments%rowtype; v_status text;
begin
  select * into v_f from public.order_fulfilments where id = p_fulfilment_id for update;
  if not found or v_f.vendor_id <> p_vendor_id then return jsonb_build_object('dropped',false,'reason','not_found'); end if;
  if v_f.status <> 'accepted' then return jsonb_build_object('dropped',false,'reason','already_started'); end if;
  update public.order_fulfilments set vendor_id = null, status = 'pending_vendor', updated_at = now() where id = v_f.id;
  update public.order_items i set status = 'pending_vendor', updated_at = now()
    from public.order_fulfilment_items fi where fi.item_id = i.id and fi.fulfilment_id = v_f.id;
  update public.order_offers set status = 'cancelled', updated_at = now() where order_id = v_f.order_id and v_f.id = any(
    select unnest(item_ids) from public.order_offers where order_id = v_f.order_id
  ) and status = 'offered';
  v_status := public.refresh_multi_service_order_status(v_f.order_id);
  return jsonb_build_object('dropped',true,'orderId',v_f.order_id,'status',v_status);
end $$;

create or replace function public.claim_multi_service_delivery_attempt(p_fulfilment_id uuid, p_vendor_id uuid, p_candidate_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.order_fulfilments%rowtype; v_order_status text;
begin
  select * into v_f from public.order_fulfilments where id = p_fulfilment_id and vendor_id = p_vendor_id for update;
  if not found then return jsonb_build_object('verified',false,'reason','not_found'); end if;
  if v_f.status <> 'arrived' then return jsonb_build_object('verified',false,'reason','invalid_status'); end if;
  if v_f.delivery_otp_locked_at is not null or v_f.delivery_otp_attempts >= 5 then return jsonb_build_object('verified',false,'reason','locked'); end if;
  if v_f.delivery_otp_hash is null or v_f.delivery_otp_expires_at <= now() then return jsonb_build_object('verified',false,'reason','expired'); end if;
  if v_f.delivery_otp_hash <> p_candidate_hash then
    update public.order_fulfilments set delivery_otp_attempts = delivery_otp_attempts + 1,
      delivery_otp_locked_at = case when delivery_otp_attempts + 1 >= 5 then now() else null end,
      updated_at = now() where id = v_f.id;
    if v_f.delivery_otp_attempts + 1 >= 5 then
      insert into public.order_admin_audit(order_id,fulfilment_id,action,reason,metadata)
      values (v_f.order_id,v_f.id,'delivery_otp_locked','Five incorrect delivery OTP attempts',jsonb_build_object('attempts',5));
      insert into public.notifications(recipient_id,event_type,title,payload)
      select p.id,'multi_service.delivery_otp_locked','Delivery OTP locked',jsonb_build_object('orderId',v_f.order_id,'fulfilmentId',v_f.id)
      from public.profiles p where p.role = 'admin';
    end if;
    return jsonb_build_object('verified',false,'reason',case when v_f.delivery_otp_attempts + 1 >= 5 then 'locked' else 'invalid' end);
  end if;
  update public.order_fulfilments set status = 'delivered', delivered_at = now(), delivery_otp_hash = null,
    delivery_otp_expires_at = null, updated_at = now() where id = v_f.id;
  update public.order_items i set status = 'delivered', updated_at = now()
    from public.order_fulfilment_items fi where fi.item_id = i.id and fi.fulfilment_id = v_f.id;
  v_order_status := public.refresh_multi_service_order_status(v_f.order_id);
  return jsonb_build_object('verified',true,'orderId',v_f.order_id,'status',v_order_status);
end $$;

create or replace function public.issue_multi_service_delivery_otp(
  p_fulfilment_id uuid, p_customer_id uuid, p_hash text, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.order_fulfilments%rowtype;
begin
  select f.* into v_f from public.order_fulfilments f
    join public.orders o on o.id=f.order_id
    where f.id=p_fulfilment_id and o.customer_id=p_customer_id for update of f;
  if not found then return jsonb_build_object('issued',false,'reason','not_found'); end if;
  if v_f.status<>'arrived' then return jsonb_build_object('issued',false,'reason','invalid_status'); end if;
  if v_f.delivery_otp_last_requested_at>now()-interval '60 seconds' then
    return jsonb_build_object('issued',false,'reason','cooldown');
  end if;
  if v_f.delivery_otp_last_requested_at is null or v_f.delivery_otp_last_requested_at<now()-interval '1 day' then
    v_f.delivery_otp_requests:=0;
  end if;
  if v_f.delivery_otp_requests>=5 then return jsonb_build_object('issued',false,'reason','rate_limited'); end if;
  update public.order_fulfilments set delivery_otp_hash=p_hash,delivery_otp_expires_at=p_expires_at,
    delivery_otp_attempts=0,delivery_otp_locked_at=null,delivery_otp_sms_sent=null,
    delivery_otp_requests=v_f.delivery_otp_requests+1,delivery_otp_last_requested_at=now(),updated_at=now()
    where id=v_f.id;
  return jsonb_build_object('issued',true,'reference',v_f.reference);
end $$;

create or replace function public.complete_multi_service_fulfilment_admin(
  p_fulfilment_id uuid, p_actor_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.order_fulfilments%rowtype; v_status text;
begin
  select * into v_f from public.order_fulfilments where id = p_fulfilment_id for update;
  if not found then return jsonb_build_object('completed',false,'reason','not_found'); end if;
  if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'AUDIT_REASON_REQUIRED'; end if;
  if v_f.status not in ('accepted','en_route','arrived') then return jsonb_build_object('completed',false,'reason','invalid_status'); end if;
  update public.order_fulfilments set status = 'delivered', delivered_at = now(), delivery_otp_hash = null,
    delivery_otp_expires_at = null, updated_at = now() where id = v_f.id;
  update public.order_items i set status = 'delivered', updated_at = now()
    from public.order_fulfilment_items fi where fi.item_id = i.id and fi.fulfilment_id = v_f.id;
  insert into public.order_admin_audit(order_id,fulfilment_id,actor_id,action,reason)
  values (v_f.order_id,v_f.id,p_actor_id,'manual_completion',trim(p_reason));
  v_status := public.refresh_multi_service_order_status(v_f.order_id);
  return jsonb_build_object('completed',true,'orderId',v_f.order_id,'status',v_status);
end $$;

create or replace function public.reassign_multi_service_fulfilment_admin(
  p_fulfilment_id uuid, p_vendor_id uuid, p_actor_id uuid, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.order_fulfilments%rowtype;
  v_item_id uuid;
  v_status text;
begin
  select * into v_f from public.order_fulfilments where id=p_fulfilment_id for update;
  if not found then return jsonb_build_object('reassigned',false,'reason','not_found'); end if;
  if length(trim(coalesce(p_reason,''))) < 5 then raise exception 'AUDIT_REASON_REQUIRED'; end if;
  if v_f.status not in ('pending_vendor','offered','accepted') then
    return jsonb_build_object('reassigned',false,'reason','invalid_status');
  end if;
  if not exists (select 1 from public.vendors where id=p_vendor_id and is_online and verification='approved') then
    return jsonb_build_object('reassigned',false,'reason','vendor_unavailable');
  end if;
  for v_item_id in select item_id from public.order_fulfilment_items where fulfilment_id=v_f.id
  loop
    if not exists (
      select 1 from public.order_items i join public.vendor_services vs
        on vs.service_type_id=i.service_type_id and vs.vendor_id=p_vendor_id and vs.active
      where i.id=v_item_id
    ) then return jsonb_build_object('reassigned',false,'reason','service_not_supported'); end if;
  end loop;
  update public.order_fulfilments set vendor_id=p_vendor_id,status='accepted',updated_at=now() where id=v_f.id;
  update public.order_items i set status='accepted',updated_at=now()
    from public.order_fulfilment_items fi where fi.item_id=i.id and fi.fulfilment_id=v_f.id;
  update public.order_offers set status='cancelled',updated_at=now()
    where order_id=v_f.order_id and v_f.id=any(select unnest(item_ids)) and status='offered';
  insert into public.order_admin_audit(order_id,fulfilment_id,actor_id,action,reason,metadata)
  values(v_f.order_id,v_f.id,p_actor_id,'manual_reassignment',trim(p_reason),jsonb_build_object('vendorId',p_vendor_id));
  v_status := public.refresh_multi_service_order_status(v_f.order_id);
  return jsonb_build_object('reassigned',true,'orderId',v_f.order_id,'status',v_status);
end $$;

create or replace function public.cancel_multi_service_item(p_item_id uuid, p_customer_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_item public.order_items%rowtype; v_order_status text;
begin
  select i.* into v_item from public.order_items i join public.orders o on o.id = i.order_id
    where i.id = p_item_id and o.customer_id = p_customer_id for update of i;
  if not found then return jsonb_build_object('cancelled',false,'reason','not_found'); end if;
  if v_item.status not in ('pending_vendor','offered') then return jsonb_build_object('cancelled',false,'reason','already_accepted'); end if;
  update public.order_items set status = 'cancelled', updated_at = now() where id = v_item.id;
  update public.order_fulfilments f set status = 'cancelled', updated_at = now()
    from public.order_fulfilment_items fi where fi.fulfilment_id = f.id and fi.item_id = v_item.id;
  update public.order_offers set status = 'cancelled', updated_at = now() where v_item.id = any(item_ids) and status = 'offered';
  v_order_status := public.refresh_multi_service_order_status(v_item.order_id);
  return jsonb_build_object('cancelled',true,'orderId',v_item.order_id,'status',v_order_status);
end $$;

create or replace function public.edit_multi_service_item(p_item_id uuid, p_customer_id uuid, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_item public.order_items%rowtype;
begin
  select i.* into v_item from public.order_items i join public.orders o on o.id = i.order_id
    where i.id = p_item_id and o.customer_id = p_customer_id for update of i;
  if not found then return jsonb_build_object('updated',false,'reason','not_found'); end if;
  if v_item.status not in ('pending_vendor','offered') then return jsonb_build_object('updated',false,'reason','already_accepted'); end if;
  update public.order_items set location = coalesce(p_changes->>'location',location),
    scheduled_for = coalesce(nullif(p_changes->>'scheduled_for','')::timestamptz,scheduled_for),
    slot = coalesce(p_changes->>'slot',slot),
    latitude = coalesce(nullif(p_changes->>'latitude','')::numeric,latitude),
    longitude = coalesce(nullif(p_changes->>'longitude','')::numeric,longitude),
    updated_at = now() where id = v_item.id;
  update public.order_offers set status = 'cancelled', updated_at = now() where v_item.id = any(item_ids) and status = 'offered';
  return jsonb_build_object('updated',true,'orderId',v_item.order_id);
end $$;

create or replace function public.sweep_multi_service_order_offers(p_escalation_minutes integer default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_expired integer; v_alerts integer;
begin
  update public.order_offers set status = 'expired', updated_at = now()
    where status = 'offered' and expires_at <= now();
  get diagnostics v_expired = row_count;
  insert into public.notifications(recipient_id,event_type,title,payload)
  select p.id,'multi_service.unassigned_escalation','Unassigned service requires attention',
    jsonb_build_object('orderId',o.id,'itemId',i.id,'reference',o.reference)
  from public.order_items i join public.orders o on o.id = i.order_id
  cross join public.profiles p
  where p.role = 'admin' and i.status in ('pending_vendor','offered')
    and i.created_at <= now() - make_interval(mins => greatest(1,coalesce(p_escalation_minutes,30)))
    and not exists (
      select 1 from public.order_admin_audit a where a.order_id = o.id and a.action = 'unassigned_escalation'
        and a.metadata->>'itemId' = i.id::text and a.created_at > now() - interval '1 day'
    );
  get diagnostics v_alerts = row_count;
  insert into public.order_admin_audit(order_id,action,reason,metadata)
  select o.id,'unassigned_escalation','No eligible vendor accepted before the escalation threshold',
    jsonb_build_object('itemId',i.id)
  from public.order_items i join public.orders o on o.id = i.order_id
  where i.status in ('pending_vendor','offered')
    and i.created_at <= now() - make_interval(mins => greatest(1,coalesce(p_escalation_minutes,30)))
    and not exists (select 1 from public.order_admin_audit a where a.order_id=o.id and a.action='unassigned_escalation' and a.metadata->>'itemId'=i.id::text and a.created_at > now()-interval '1 day');
  return jsonb_build_object('expiredOffers',v_expired,'alerts',v_alerts);
end $$;

alter table public.service_types enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_fulfilments enable row level security;
alter table public.order_fulfilment_items enable row level security;
alter table public.vendor_services enable row level security;
alter table public.order_offers enable row level security;
alter table public.order_fulfilment_ratings enable row level security;
alter table public.order_fulfilment_ledger enable row level security;
alter table public.order_refunds enable row level security;
alter table public.order_admin_audit enable row level security;
drop policy if exists "active service types are readable" on public.service_types;
create policy "active service types are readable" on public.service_types for select using (active);
drop policy if exists "customers read own normalized orders" on public.orders;
create policy "customers read own normalized orders" on public.orders for select using (auth.uid() = customer_id);
drop policy if exists "customers read own normalized order items" on public.order_items;
create policy "customers read own normalized order items" on public.order_items for select using (exists(select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid()));
drop policy if exists "vendors read assigned fulfilments" on public.order_fulfilments;
create policy "vendors read assigned fulfilments" on public.order_fulfilments for select using (exists(select 1 from public.vendors v where v.id=vendor_id and v.owner_profile_id=auth.uid()));
drop policy if exists "customers read own normalized fulfilments" on public.order_fulfilments;
create policy "customers read own normalized fulfilments" on public.order_fulfilments for select using (exists(select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid()));
grant select on public.service_types to anon, authenticated;
grant select on public.orders, public.order_items, public.order_fulfilments to authenticated;
grant all on public.service_types, public.orders, public.order_items, public.order_fulfilments,
  public.order_fulfilment_items, public.vendor_services, public.order_offers,
  public.order_fulfilment_ratings, public.order_fulfilment_ledger, public.order_refunds,
  public.order_admin_audit to service_role;
revoke all on function public.create_multi_service_order(jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.refresh_multi_service_order_status(uuid) from public, anon, authenticated;
revoke all on function public.accept_multi_service_offer(uuid,uuid) from public, anon, authenticated;
revoke all on function public.transition_multi_service_fulfilment(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.drop_multi_service_fulfilment(uuid,uuid) from public, anon, authenticated;
revoke all on function public.claim_multi_service_delivery_attempt(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.issue_multi_service_delivery_otp(uuid,uuid,text,timestamptz) from public, anon, authenticated;
revoke all on function public.complete_multi_service_fulfilment_admin(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.reassign_multi_service_fulfilment_admin(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.cancel_multi_service_item(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.edit_multi_service_item(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.sweep_multi_service_order_offers(integer) from public, anon, authenticated;
revoke all on function public.record_multi_service_delivery_invoices() from public, anon, authenticated;
revoke all on function public.sync_multi_service_invoice_payment() from public, anon, authenticated;
grant execute on function public.create_multi_service_order(jsonb,jsonb,jsonb) to service_role;
grant execute on function public.refresh_multi_service_order_status(uuid) to service_role;
grant execute on function public.accept_multi_service_offer(uuid,uuid) to service_role;
grant execute on function public.transition_multi_service_fulfilment(uuid,uuid,text) to service_role;
grant execute on function public.drop_multi_service_fulfilment(uuid,uuid) to service_role;
grant execute on function public.claim_multi_service_delivery_attempt(uuid,uuid,text) to service_role;
grant execute on function public.issue_multi_service_delivery_otp(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.complete_multi_service_fulfilment_admin(uuid,uuid,text) to service_role;
grant execute on function public.reassign_multi_service_fulfilment_admin(uuid,uuid,uuid,text) to service_role;
grant execute on function public.cancel_multi_service_item(uuid,uuid,text) to service_role;
grant execute on function public.edit_multi_service_item(uuid,uuid,jsonb) to service_role;
grant execute on function public.sweep_multi_service_order_offers(integer) to service_role;
grant execute on function public.record_multi_service_delivery_invoices() to service_role;
grant execute on function public.sync_multi_service_invoice_payment() to service_role;
notify pgrst, 'reload schema';
commit;
