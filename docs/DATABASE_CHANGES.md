# Database changes

**Status:** Canonical schema reset on the explicitly confirmed disposable test project on 2026-11-20; PostgreSQL connectivity check passed. All 17 Auth users and 8 Storage objects were removed; 2 buckets remain empty. No production project was accessed.
**Updated:** 2026-11-25

## Current database

- Supabase PostgreSQL is the system of record; Supabase Auth manages identities. The Express service uses the server-side Supabase service role and a PostgreSQL pool.
- The canonical schema is `backend/supabase/001_initial.sql`. It includes profiles/roles, vendors, vehicles/drivers, catalog and prices, bookings/grouped services, lifecycle/audit history, payments, invoices, addresses, notifications, location, documents, partner applications, enquiries, payouts and analytics.
- RLS protects selected customer-owned tables and service-role access is restricted at the application/API boundary. Preserve both database and route-level authorization.
- The canonical SQL file drops and recreates the public schema and is explicitly for fresh/test installation; it is not an incremental production migration. No incremental migration command/runner is currently exposed in `backend/package.json`.

## Change log

| Date | Change | Migration / data safety |
| --- | --- | --- |
| 2026-11-25 | Added optional paired latitude/longitude coordinates for drivers to the canonical schema and admin/vendor create and update APIs. Tracking APIs prefer live vendor-device coordinates and fall back to the assigned driver's registered pin while the booking is active; the fallback is labeled as a fixed pin, not live GPS, and is coarsened in public tracking links. | For existing installations, apply `backend/supabase/005_driver_coordinates.sql` before deploying the API; it adds nullable columns and a pair/range constraint without changing existing rows. The migration is additive and transactional. |
| 2026-11-20 | Consolidated the phone-verification schema updates into `backend/supabase/001_initial.sql`; no 006 migration files remain in this branch. | Canonical schema only; destructive and not an incremental migration. Do not run it against an existing database. |
| 2026-11-21 | Applied the additive Feature 2 multi-service order schema to the development project `qlotsoputalbqkbkezlt`; verified all eleven Feature 2 tables, RLS, triggers, and service-role-only access for the unpaid-order cancellation RPC. `npm run db:check` passed and `MULTI_SERVICE_ORDERS_ENABLED` remains false. Consolidated the complete Feature 2 schema and function privileges into `backend/supabase/001_initial.sql`; removed the standalone 007 up/down files as requested. | No application data was cleared. The canonical `001_initial.sql` is for fresh/disposable installations only and must not be run on an existing database. Other existing projects still need a separately reviewed additive upgrade before enabling Feature 2. |
| 2026-11-20 | Reinstalled the canonical schema from `001_initial.sql` on the explicitly confirmed disposable test project; deleted all Auth users and emptied Storage. | Reset ran with `NODE_ENV=test` and an explicit project allowlist; `npm run db:check` passed. Removed 17 Auth users and 8 objects; both Storage buckets remain configured and empty. Canonical install seed rows remain. No production project was accessed. |
| 2026-11-18 | Applied migrations 002–004 sequentially to the configured development PostgreSQL database and verified expected schema objects, RLS, triggers, and indexes; `npm run db:check` passed afterward. | Development only; no production database was accessed. Migration 003 preflight found no duplicate active-phone groups or unsupported partner statuses. The SQL was applied through the existing `pg` connection pool because `psql` and the Supabase CLI were unavailable. |
| 2026-11-18 | Added `backend/supabase/002_service_enquiries.sql`: structured contact/service/date fields on existing enquiries, an indexed append-only `enquiry_history` table, and a trigger that records submissions and admin status/response changes. | Additive/idempotent; applied and verified on development only. Existing enquiries are not backfilled, and history begins after migration. |
| 2026-11-18 | Added `backend/supabase/003_partner_vehicle_details.sql`: per-vehicle JSONB details, a partial unique index for active applications by mobile number, append-only application review history, and the `additional_info_required` status. | Additive/transactional; applied and verified on development only. Existing rows retain legacy fields and receive an empty vehicle array; history starts with post-migration activity. Incomplete historic vehicle data is not fabricated. |
| 2026-11-18 | Added `backend/supabase/004_service_pricing_history.sql`: an `updated_by` reference on `service_catalog`, an append-only `service_pricing_history` table, and insert/price-or-config-update triggers that snapshot old/new prices and config. | Additive/transactional; applied and verified on development only. Existing catalog prices are not backfilled; history begins after migration. RLS is enabled and no client-role access is granted. |

## Requirements for any later schema change

1. Add a reviewed additive migration for existing installations; never run the canonical reset against production or user data.
2. Preserve confirmed booking pricing snapshots, payment/invoice history, audit records, ownership and existing API contracts.
3. Use constraints/indexes that match query and idempotency patterns; apply RLS/revokes/grants and test least-privilege access.
4. Preserve historical price snapshots; never rewrite confirmed booking prices when catalog prices change. Pricing audit history is not a substitute for effective-dated rate schedules or a financial ledger.
5. Use transactions for multi-record lifecycle changes and define a rollback/forward-recovery plan.
6. Validate against an isolated disposable database first. Record migration order, backfill, lock/downtime considerations, deploy sequence, and verification.

## Unverified items

Production schema version, production backups/restore, production RLS policy coverage, and whether a deployment-specific incremental migration exists outside these repositories were not checked. Do not assume the production database has migrations 002–004.
