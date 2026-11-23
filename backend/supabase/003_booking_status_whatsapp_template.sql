insert into public.sms_templates (template_key, body, variables)
values (
  'booking_status_update',
  'Urban Tanker: Booking {{reference}} update: {{status}}. {{detail}} Track your booking: {{trackingUrl}}',
  '{reference,status,detail,trackingUrl}'
)
on conflict (template_key) do nothing;
