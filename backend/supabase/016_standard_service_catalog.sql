insert into public.service_catalog (code, name, description, base_price_paise, is_active)
values
  ('water_tanker', 'Water tanker', 'Potable and utility water delivery', 185000, true),
  ('sewage_tanker', 'Sewage tanker', 'Sewage and wastewater transport', 185000, true),
  ('tank_cleaning', 'Tank cleaning', 'Residential and commercial tank cleaning', 185000, true),
  ('borewell_service', 'Borewell service', 'Borewell inspection and service support', 185000, true)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    is_active = true;
