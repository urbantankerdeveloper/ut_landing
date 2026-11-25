begin;

alter table public.drivers
  add column if not exists latitude numeric(9,6),
  add column if not exists longitude numeric(9,6);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'drivers_coordinates_pair_check'
      and conrelid = 'public.drivers'::regclass
  ) then
    alter table public.drivers
      add constraint drivers_coordinates_pair_check
      check (
        (latitude is null) = (longitude is null)
        and (latitude is null or latitude between -90 and 90)
        and (longitude is null or longitude between -180 and 180)
      );
  end if;
end
$$;

commit;
