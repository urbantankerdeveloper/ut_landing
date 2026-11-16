begin;

alter table public.invoices
  add column if not exists line_items jsonb not null default '[]'::jsonb,
  add column if not exists subtotal_paise integer not null default 0 check (subtotal_paise >= 0),
  add column if not exists tax_paise integer not null default 0 check (tax_paise >= 0),
  add column if not exists tax_rate numeric not null default 0 check (tax_rate >= 0),
  add column if not exists discount_paise integer not null default 0 check (discount_paise >= 0),
  add column if not exists total_paise integer not null default 0 check (total_paise >= 0),
  add column if not exists payment_method text,
  add column if not exists payment_status text not null default 'paid',
  add column if not exists paid_at timestamptz;

create unique index if not exists invoices_booking_id_unique_idx
  on public.invoices (booking_id);

commit;
