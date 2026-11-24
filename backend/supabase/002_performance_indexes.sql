-- 002_performance_indexes.sql
-- Additive and idempotent: only creates missing indexes and drops two duplicates.
-- Generated from a static read of 001_initial.sql. Not run against a live database.
-- Run on a copy first. On large tables, run each CREATE INDEX separately with
-- CONCURRENTLY (it cannot run inside a transaction block).

-- 1. Hot-path lookups used by the API ------------------------------------------------
-- vendor lookup by owner (vendorId() helper, socket connect, RLS subqueries)
create index if not exists vendors_owner_profile_idx on public.vendors (owner_profile_id);
-- findNearbyVendors(): online + approved vendors only
create index if not exists vendors_online_approved_idx on public.vendors (service_zone)
  where is_online = true and verification = 'approved';
-- persistAdminEvent(): list of admin profiles
create index if not exists profiles_admin_idx on public.profiles (id) where role = 'admin';
-- order group lookups (customer order list, invoice sync)
create index if not exists bookings_order_group_idx on public.bookings (order_group_id)
  where order_group_id is not null;
create index if not exists bookings_vehicle_idx on public.bookings (vehicle_id) where vehicle_id is not null;
-- customer order list: .in('legacy_booking_id', ids)
create index if not exists order_fulfilments_order_idx on public.order_fulfilments (order_id);
create index if not exists order_fulfilments_legacy_booking_idx on public.order_fulfilments (legacy_booking_id)
  where legacy_booking_id is not null;
create index if not exists order_items_legacy_booking_idx on public.order_items (legacy_booking_id)
  where legacy_booking_id is not null;
create index if not exists order_offers_fulfilment_idx on public.order_offers (fulfilment_id);
create index if not exists invoices_booking_idx on public.invoices (booking_id);
create index if not exists invoices_order_idx on public.invoices (order_id) where order_id is not null;

-- markOtherVendorOffersTaken(): filter notifications by booking inside the database
-- Query with PostgREST: .eq('event_type','vendor_order_created').eq('payload->>bookingId', bookingId)
create index if not exists notifications_offer_booking_idx on public.notifications ((payload->>'bookingId'))
  where event_type = 'vendor_order_created';

-- 2. Foreign keys without a leading index (slow deletes/cascades and joins) ---------
create index if not exists ratings_booking_idx on public.ratings (booking_id);
create index if not exists ratings_customer_idx on public.ratings (customer_id);
create index if not exists complaints_booking_idx on public.complaints (booking_id);
create index if not exists complaints_customer_idx on public.complaints (customer_id);
create index if not exists subscriptions_customer_idx on public.subscriptions (customer_id);
create index if not exists wallet_transactions_customer_idx on public.wallet_transactions (customer_id);
create index if not exists customer_memberships_customer_idx on public.customer_memberships (customer_id);
create index if not exists driver_attendance_driver_idx on public.driver_attendance (driver_id);
create index if not exists driver_attendance_vendor_idx on public.driver_attendance (vendor_id);
create index if not exists vendor_location_updates_vendor_idx on public.vendor_location_updates (vendor_id);
create index if not exists order_fulfilment_ledger_vendor_idx on public.order_fulfilment_ledger (vendor_id);
create index if not exists order_fulfilment_ledger_order_idx on public.order_fulfilment_ledger (order_id);
create index if not exists order_admin_audit_order_idx on public.order_admin_audit (order_id);
create index if not exists order_fulfilment_ratings_order_idx on public.order_fulfilment_ratings (order_id);

-- 3. Audit log: lookups by entity and by time (needed for retention deletes) --------
create index if not exists audit_logs_created_idx on public.audit_logs (created_at);
create index if not exists audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

-- 4. Drop duplicates (each extra index slows every write) ---------------------------
-- Identical to vendor_location_updates_booking_recorded_idx
drop index if exists public.vendor_location_booking_recorded_idx;
-- tracking_token_hash is already declared UNIQUE, which creates the same index
drop index if exists public.bookings_tracking_token_hash_idx;

-- 5. Retention (run from a scheduled job; adjust the windows) -----------------------
-- delete from public.vendor_location_updates where recorded_at < now() - interval '30 days';
-- delete from public.audit_logs              where created_at  < now() - interval '180 days';
-- delete from public.notifications           where created_at  < now() - interval '90 days' and read_at is not null;
-- Delete in batches (for example 5,000 rows per statement) on big tables.

-- 6. Verification helper: foreign keys that still lack a supporting index -----------
-- select c.conrelid::regclass as table_name, a.attname as column_name
-- from pg_constraint c
-- join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
-- where c.contype = 'f'
--   and not exists (
--     select 1 from pg_index i
--     where i.indrelid = c.conrelid and i.indkey[0] = c.conkey[1]
--   )
-- order by 1, 2;
