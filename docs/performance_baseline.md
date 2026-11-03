# Performance baseline (Phase 0)

Date: 2026-11-03. Branch: `perf/phase-0-audit` (ut_landing). No production code changed in this phase.

## Status

| Item | Status |
|---|---|
| Web + Flutter API inventory (`docs/api_consumers.md`) | Done |
| Backend findings verified against `backend/src` | Done (below) |
| Test/typecheck baseline | Done: 140/140 tests pass, `tsc --noEmit` clean |
| Benchmark suite (`backend/scripts/bench/`) | Done, smoke-tested against a throwaway mock only |
| Baseline **numbers** (p50/p95/p99, RPS, error rate) | **Not measured.** No local or staging backend with seeded data is available here (no Supabase staging project, no Docker, no `psql`). See "Blocking questions". |

Nothing in this document is a measured production number. Do not quote the targets below as baseline results.

## Environment

- Node `v26.13.0` (backend `engines`: `>=22`).
- Express: **5.3.0** (declared `^5.1.0`). The checklist assumed Express 4; that is wrong for this repo.
- `@supabase/supabase-js`: 2.117.3 installed (declared `^2.58.0`).
- Vitest 5.0.4, 23 test files, 140 tests, all passing. `tsc -p tsconfig.json --noEmit` clean.
- Build was **not** run in Phase 0 because `npm run build` rewrites `backend/dist/`, which must not be edited or regenerated here.

### Dependency change in this phase

`npm install -D autocannon@^8` (for the bench suite) also pruned from `backend/package-lock.json` packages that nothing in the declared dependency tree needs anymore: `jsonwebtoken`, `jws`, `jwa`, `jose`, `@supabase/server`, `@supabase/middleware` and a few `lodash.*` helpers. No file in `src/` imports any of them (checked), and all 140 tests pass after the prune.

Consequence for Phase 2: `jose` is **not** currently in the lockfile, so local JWT verification will need it added explicitly. Please confirm this lockfile change is acceptable before the commit.

## Backend findings verification

Status key: **C** = confirmed, **P** = partly true, **R** = refuted.

| Finding | Status | Evidence (file:line) | Note |
|---|---|---|---|
| A1 auth: 2 sequential calls per request | C | `src/middleware/auth.ts:35` (`auth.getUser`), `:38` (profiles `.single()`) | A profile-lookup error is swallowed (`:38-40`), so the request continues without a role. Vendor routes re-query `vendors` (`vendorExtended.ts:14,18`; `vendor.ts:55,94,96,105-108`). |
| A2 socket handshake | C | `src/server.ts:88` (getUser), `:108-111` (profiles + vendors in parallel), `:135` (bookings per `booking:join`) | Profile and vendor lookups already run in parallel. `booking:join` is capped at 30/min and 20 rooms (`:131-132`). |
| A3 audit write per mutation | C | `src/middleware/auth.ts:43` (finish listener), `:47` (offline_mutations update), `:60` (audit_logs insert) | Runs after the response finishes: adds DB load, not response latency. Only non-GET requests through `requireAuth` are audited. |
| A4 login chains | C (+1) | Username: `auth.ts:375,378,385,387,390`. Phone OTP existing user: `:245` (`passesChallengeAttempt`, rpc at `:124`), `:248-250`, `:261` (`markChallengeVerified`), `:268`, `:272`, `:281` | Checklist omitted the `markChallengeVerified` write at `:261`. |
| A5 `/admin/vendors` N+1 | P | `src/routes/admin.ts:14,15,21-23` | Per-orphan `getUserById` calls run via `Promise.all`, not sequentially. Still unbounded fan-out to the Auth admin API. |
| A6 offer fan-out | C + **correctness bug** | `src/routes/vendorExtended.ts:45` (limit 500, no recipient/booking filter), `:47` (JS filter), `:49-53` (sequential update + vendor lookup per loser), `:111` (call site); `vendorOffer` `:38` (limit 200); `vendor.ts:59` (limit 200) | Offers for a booking that fall outside the newest 500 platform-wide are never marked taken: stale "new order" offers stay visible. |
| A7 nearby vendors | C | `src/routes/customer.ts:55` (online + approved, no geo filter), `:47-53` (Haversine), `:66` (filter), `:248` (call) | Vendors with null coordinates are kept for every order (`:66`). See Questions. |
| A8 `/customer/usage` | C | `src/routes/customer.ts:98` | Reads all of the customer's bookings (two columns) and sums in Node. |
| A9 unbounded lists | C | Admin: `admin.ts:14,50,51,66,70` (reports date range only); `adminExtended.ts:70,75,82,84`. Customer: `customerExtended.ts:21,35`; `customer.ts:279,285`. Vendor: `vendorExtended.ts:135,138,145`. Support: `support.ts:9` | Already bounded or paged (keep as is): `admin.ts:11` (orders, paged), `:73`, `adminExtended.ts:44,86,91,92,95,97`, `customer.ts:99-108`, `vendor.ts:95-104`. `select('*')`: **41** calls in non-test `src` (34 bare, 7 with embeds). |
| A10 jobs do no useful work | C | `src/services/jobs.ts:5-6` (fetch rows, return `.length`), `:27` (15-min interval), `:7` (storage cleanup: `limit(100)`, sequential remove + delete per row) | Count is client-side, so full rows are transferred. Both queries are index-backed (`002:307,310`). |
| C11 per-instance route limiters | C | No `store` on 14 route limiters: `auth.ts:25-34`, `analytics.ts:9`, `customer.ts:19`, `customerExtended.ts:14`, `partner.ts:8`. Global limiter sets Redis store: `server.ts:65` | Effective limits scale with instance count. |
| C12 server timeouts | P | `server.ts:36` (`createServer(app)`, no options) | Node defaults on v26: `requestTimeout` 300 s, `headersTimeout` 60 s, `keepAliveTimeout` 5 s. A 5 s keep-alive is shorter than most proxies' idle timeout, which is the usual cause of sporadic 502s. Setting `keepAliveTimeout` above the proxy's idle timeout is still the right fix. |
| C13 `/health/ready` hangs | **R** | `package.json` (`express ^5.1.0`, installed 5.3.0); `node_modules/router/lib/layer.js:119-124`; `server.ts:68-71`; `database.ts:9-10,20-24`; `middleware/errors.ts:12` | Express 5 forwards rejected promises to `next(err)`, so the handler cannot hang. A DB error gives a **500** JSON response from `errors.ts`, not the intended 503. Query is bounded by a 10 s connection and 15 s statement timeout. `SUPABASE_DB_URL` unset: `checkDatabaseConnection` returns false and the route returns 503 (`server.ts:70`). Remaining work is only to return 503 on error instead of 500. |
| C14 uncached catalogs | C | `customer.ts:85` (services), `:86` (offers); `customerExtended.ts:28` (plans); `adminExtended.ts:80` (feature flags); `vendor.ts:107` (services) | No `Cache-Control` on API responses. Express weak ETags return 304 but still run the query. Only server-side cache: `sms.ts:42-48,62-73` (SMS templates, per process). |
| C15 observability | P | `src/middleware/observability.ts:14-20` (`durationMs` logged) | Latency is logged per request. No slow-request threshold, `Server-Timing`, metrics endpoint, or `prom-client`. |
| D16 SMTP only | C | `src/services/providers.ts:1,11-18` (nodemailer SMTP); `src/config.ts:25-27` (default `smtp.gmail.com`, 465, secure); sends at `auth.ts:507` (signup), `:529` (password reset) | No HTTP mail provider exists. `signupEmail.ts` holds templates only. HTTP providers present: Twilio (`providers.ts:36`), OneSignal (`pushNotifications.ts:21`). |
| D17 placeholder emails | C | `auth.ts:296` (`phone-${digits}@phone.urbantanker.local`); `phoneSchema` at `:93` (`/^\d{10}$/`) | Other placeholders: username `phone_<phone>_<hex>` (`:295`), guest email `guest-<phone>-<hex>@guest.urbantanker.local` (`:190`), `no-account@login.urbantanker.local` (`:19`). |
| D18 signup phone not stored | C | `auth.ts:422` (phone required), `:452-459` (profile upsert has no phone) | Comment at `:437` implies the phone is written later. The later phone route only writes a phone to accounts it creates itself (`:296-320`), so the signup phone is dropped. The checklist says to keep this behaviour; the comment is misleading. |

## Additional findings the checklist missed

1. **`POST /api/customer/orders/quote` is the place-order call**, not a read-only quote. Both clients use it to create the booking, and it returns `{ ...booking, quote }`. Do not benchmark it on any shared instance.
2. **`quote-preview` shares the order-placement limiter.** `customer.ts:267` uses `quoteLimit` (20 requests per 10 min per user, `customer.ts:19`). The Flutter live quote summary calls `POST /customer/orders/quote-preview` on each form change after a 400 ms debounce (`urban_tanker_app/lib/screens/home/booking/live_quote_summary.dart:46,102`). Normal form editing can exhaust the budget and return 429. **Likely, to be confirmed on a device**: what the UI shows on 429.
3. **Duplicate index** on `vendor_location_updates (booking_id, recorded_at desc)`: `001_initial.sql:63` and `:69` (`vendor_location_updates_booking_recorded_idx` and `vendor_location_booking_recorded_idx`). Do not drop in Phase 3 without approval (the rules forbid drops).
4. **Vendor offer correctness bug** (see A6): offers beyond the newest 500 platform-wide are never marked taken.
5. **Null-coordinate vendors receive every order** (`customer.ts:66`). This is current behaviour and a business decision; it is not changed in Phase 1.
6. **Global limiter fails open**: `server.ts:65` sets `passOnStoreError: true`, so if Redis fails the global limit silently disappears.
7. **Migration 002 builds indexes inside one transaction** with plain `CREATE INDEX` (`002:42-350`, index lines `305-312`). That blocks writes on the hot tables. The file flags this itself (`002:17-19`). The new migrations must use `CREATE INDEX CONCURRENTLY`, which cannot run inside a transaction, so the runner needs a per-file "no transaction" mode.
8. **`vendorId()` uses `.single()`** (`vendorExtended.ts:14`, `vendor.ts:96`). `vendors.owner_profile_id` has no unique constraint in 001; duplicates would make these calls error.
9. **Storage cleanup is capped at 100 per run** (`jobs.ts:7`). The backlog drains at most 400 per hour.
10. **Unbounded endpoints not in the checklist:** `vendor.ts:105` (`/vehicles`), `:106` (`/drivers`), `:107` (`/services`), `:108` (`/payouts`); `admin.ts:71` (`/partner-applications`); `adminExtended.ts:81` (`/services`); `admin.ts:39` (`/vendors/:id` embeds all vehicles and drivers).
11. **Per-process SMS template cache** (`sms.ts:42-48`, 5-min TTL, local invalidation only): other instances can serve stale templates.
12. **Client-side fan-out** (from `api_consumers.md`): admin entity managers mount four lists each; "mark all read" sends one PATCH per notification; the Flutter vendor offline flush sends one POST per queued item.

## Existing indexes vs the Phase 3 list

The Phase 3 index list must not duplicate what exists. Status is based on the index names in `backend/supabase/001_initial.sql` and `002_security_hardening.sql`. Definitions must be checked before the migration is written.

| Requested index | Status |
|---|---|
| `bookings (customer_id, created_at desc)` | Exists: `bookings_customer_created_idx` (001) |
| `bookings (vendor_id, created_at desc)` | Exists: `bookings_vendor_created_idx` (001) |
| `bookings (status, scheduled_for)` | Partly: `bookings_accepted_scheduled_for_idx` (002), `bookings_status_created_idx` (002). Verify definitions. |
| `bookings (tracking_token_hash)` | Exists: `bookings_tracking_token_hash_idx` (001) |
| `notifications (recipient_id, created_at desc)` | Exists: `notifications_recipient_created_idx` (001) |
| `notifications (booking_id)` | Missing. Needs the new column first (Phase 3.2). |
| `profiles (role, created_at desc)` | Missing |
| `profiles (phone_e164) where phone_verified_at is not null` | Exists as `profiles_phone_verified_unique_idx` (002). Verify it is the same partial index. |
| `profiles (lower(username))` | Exists: `profiles_username_lower_idx` (001) |
| `vendors (owner_profile_id)` | Exists: `vendors_owner_profile_id_idx` (002) |
| partial `vendors (latitude, longitude) where is_online and verification = 'approved'` | Missing |
| `vehicles (vendor_id)` | Covered by leading column of `vehicles_vendor_status_idx` (001). Verify. |
| `drivers (vendor_id)` | Covered by leading column of `drivers_vendor_status_idx` (001). Verify. |
| `vendor_location_updates (booking_id, recorded_at desc)` | Exists, twice (see Additional finding 3) |
| `booking_events (booking_id, created_at)` | Exists: `booking_events_booking_created_idx` (002) |
| `guest_otp_challenges (phone_e164, verified_at)` | Partly: `guest_otp_challenges_phone_created_idx` (001). `verified_at` variant missing; verify with `EXPLAIN`. |
| `audit_logs (created_at desc)` | Missing (only `audit_logs_actor_created_idx`) |
| `payments (provider_order_id)` | Missing |
| `invoices (customer_id, issued_at desc)` | Exists: `invoices_customer_issued_idx` (002) |
| `wallet_transactions (customer_id, created_at desc)` | Missing (only `wallet_transactions_provider_reference_idx`) |
| `complaints (customer_id, created_at desc)` | Missing (only `complaints_vendor_created_idx`) |
| `complaints (vendor_id, created_at desc)` | Exists: `complaints_vendor_created_idx` (002) |

Likely unindexed filters the checklist missed (verify with `EXPLAIN` first): `documents (owner_type, owner_id)` (`vendorExtended.ts:138`); `subscriptions (customer_id)` (`customer.ts:285`, `adminExtended.ts:82`); `saved_addresses (user_id)` (`customer.ts:281`); `profiles (role)` (`admin.ts:15,50`); `vendors (is_online, verification)` (`customer.ts:55`); `audit_logs (action)` (`admin.ts:73`); `notifications` JSON `payload->>'bookingId'` (`customerExtended.ts:35`, to be replaced by the `booking_id` column).

## Prioritized change list

Impact is an estimate from the code paths, not a measurement. Risk covers compatibility and correctness.

| # | Change | Phase | Expected impact | Risk |
|---|---|---|---|---|
| 1 | Local JWT verification (JWKS) + cached profile/vendor context | 2 | High: removes 2 to 3 network round-trips on every authenticated request and on vendor routes | Medium: auth path. Blocked on signing-key mode (Question 1). |
| 2 | Offer fan-out via `booking_id` + one SQL statement | 3 | High, and fixes the "offers past 500 never taken" bug | Medium: realtime and notification payloads must stay identical |
| 3 | Admin list fixes: `/admin/vendors` orphan emails in one query; bound the unbounded lists; explicit columns | 1 and 3 | High for admin page loads and payload size | Low to medium: clients read bare arrays, so keep the array and add headers |
| 4 | Nearby-vendor RPC with bounding box | 3 | Medium now, high as vendor count grows | Low: keep `distance_km` semantics (null coordinates included) |
| 5 | Redis-backed route limiters (login/OTP fail closed per instance) | 1 | Security: correct brute-force limits across instances | Low, but needs `REDIS_URL` (Question 2) |
| 6 | Server timeouts (`keepAliveTimeout` above the proxy idle timeout) | 1 | Reliability: likely removes sporadic 502s | Low; measure 502s first |
| 7 | Health returns 503 on DB error (C13 corrected) | 1 | Low: correct status for probes | Low |
| 8 | Cache catalogs with ETag and short TTL | 1 | Medium on app start and browse | Low; invalidate on admin writes |
| 9 | Quote-preview limiter: separate it from placing orders, or debounce | 1 | High for the booking form (potential 429s on normal use) | Low to medium: rate limit change needs product sign-off |
| 10 | Audit batching | 2 | Medium: fewer DB writes per mutation | Low; must flush on `SIGTERM` |
| 11 | Login: `profiles.email` + `lower(username)` equality + concurrency | 2 | Medium on login | Medium: login behaviour must match |
| 12 | Jobs: head counts, batched storage cleanup | 1 | Low (runs every 15 min) | Low |
| 13 | Non-blocking index migrations (`CONCURRENTLY`) | 3 | Protects hot tables during rollout | Medium: needs a no-transaction runner |
| 14 | Email provider abstraction (HTTP API, SMTP fallback) | 4 prerequisite | Required for email OTP at scale (Gmail caps) | Medium: deliverability setup |

## Benchmark suite

- Location: `backend/scripts/bench/` (`run.mjs`, `scenarios.mjs`, `README.md`). npm script: `npm run bench` in `backend/`.
- Scenarios: `login-email`, `login-username`, `customer-services`, `customer-orders`, `customer-quote-preview`, `vendor-dashboard`, `admin-orders`, `admin-vendors`, `admin-customers`.
- Safety: refuses non-local hosts unless `BENCH_ALLOW_REMOTE=true`; never calls `POST /customer/orders/quote`; skips any scenario whose inputs are not set.
- Verified: smoke-tested against a throwaway local mock (not the backend). It exercises login, role tokens, skip logic, and the output files.
- Metrics note: autocannon 8 reports p50, p97.5 and p99, but not p95. The table reports p97.5 in place of p95 and the column header says so. DB calls per request need a server-side counter (Phase 1).

## Blocking questions

1. **Supabase JWT signing mode.** Is the project on asymmetric signing keys (JWKS), or still on the legacy HS256 secret? Phase 2 cannot start without this. (I can't read the Supabase dashboard from here.)
2. **Production topology.** How many API instances run on Render, and is `REDIS_URL` set? This decides how urgent the limiter change is.
3. **Staging with seeded data.** Is there a staging Supabase project and backend (URL and test accounts supplied through env, not committed)? Without it, Phase 0 numbers cannot be measured.
4. **`SUPABASE_DB_URL`** in production? It controls the advisory lock and `/health/ready`.
5. **Lockfile prune** (see Dependency change): OK to commit?
6. **Null-coordinate vendors** (`customer.ts:66`): keep sending them every order (current behaviour), or change it? I will not change it in Phase 1.
7. **Real reminders:** the reminder and document-expiry sweeps send nothing today. Do you want real reminders in a later phase (SMS/push, idempotent via a `reminder_sent_at` column)?
8. **Quote-preview limiter** (Additional finding 2): raise or split the limit, or fix the client debounce? Confirm the product behaviour on 429.
9. **`prom-client`**: approved for `/metrics`, or prefer log-based latency only?
