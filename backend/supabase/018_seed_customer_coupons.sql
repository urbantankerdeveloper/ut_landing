insert into public.coupons (
  code,
  title,
  discount_type,
  discount_value,
  valid_until,
  is_active
)
values
  ('WELCOME10', '10% off your first tanker booking', 'percentage', 10, now() + interval '90 days', true),
  ('WATER150', 'INR 150 off water tanker delivery', 'flat', 150, now() + interval '60 days', true),
  ('CLEAN200', 'INR 200 off tank cleaning', 'flat', 200, now() + interval '60 days', true),
  ('URBAN15', '15% off your next service', 'percentage', 15, now() + interval '45 days', true)
on conflict (code) do nothing;
