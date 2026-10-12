create or replace function public.transition_booking(
  p_booking_id uuid,
  p_actor_id uuid,
  p_next_status public.booking_status,
  p_vendor_id uuid default null,
  p_vehicle_id uuid default null,
  p_driver_id uuid default null
) returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  current_booking public.bookings;
  next_booking public.bookings;
begin
  select * into current_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'BOOKING_NOT_FOUND';
  end if;

  if p_vendor_id is not null and current_booking.vendor_id is not null and current_booking.vendor_id <> p_vendor_id then
    raise exception 'BOOKING_VENDOR_MISMATCH';
  end if;

  if p_vendor_id is not null and not exists (
    select 1 from public.vendors
    where id = p_vendor_id and verification = 'approved'
  ) then
    raise exception 'VENDOR_NOT_APPROVED';
  end if;

  if p_vehicle_id is not null and not exists (
    select 1 from public.vehicles
    where id = p_vehicle_id and vendor_id = coalesce(p_vendor_id, current_booking.vendor_id)
      and is_active and verification = 'approved'
  ) then
    raise exception 'VEHICLE_NOT_APPROVED';
  end if;

  if p_driver_id is not null and not exists (
    select 1 from public.drivers
    where id = p_driver_id and vendor_id = coalesce(p_vendor_id, current_booking.vendor_id)
      and is_active and verification = 'approved'
  ) then
    raise exception 'DRIVER_NOT_APPROVED';
  end if;

  if not (
    (current_booking.status = 'pending_vendor' and p_next_status in ('vendor_assigned', 'accepted', 'cancelled')) or
    (current_booking.status = 'vendor_assigned' and p_next_status in ('accepted', 'cancelled')) or
    (current_booking.status = 'accepted' and p_next_status in ('en_route', 'cancelled')) or
    (current_booking.status = 'en_route' and p_next_status = 'arrived') or
    (current_booking.status = 'arrived' and p_next_status = 'delivered')
  ) then
    raise exception 'INVALID_BOOKING_TRANSITION';
  end if;

  update public.bookings
  set status = p_next_status,
      vendor_id = coalesce(p_vendor_id, vendor_id),
      vehicle_id = coalesce(p_vehicle_id, vehicle_id),
      driver_id = coalesce(p_driver_id, driver_id),
      updated_at = now()
  where id = p_booking_id
  returning * into next_booking;

  insert into public.booking_events (booking_id, actor_id, from_status, to_status)
  values (p_booking_id, p_actor_id, current_booking.status, p_next_status);

  return next_booking;
end;
$$;

grant execute on function public.transition_booking(uuid, uuid, public.booking_status, uuid, uuid, uuid) to service_role;