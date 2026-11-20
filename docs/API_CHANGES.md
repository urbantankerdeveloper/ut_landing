# API changes

**Status:** Service enquiry and pricing-history APIs are implemented; dependent additive migrations must be applied before deployment.
**Updated:** 2026-11-20

## Existing API inventory

The Express API is mounted under `/api` and includes auth, public config, customer, vendor, admin, payments, public tracking, partner applications, analytics, support, uploads, and device-token routes. Health routes are `/health` and `/health/ready`. Web and Flutter clients have typed/structured API layers and share this service.

Existing business contracts identified include:

- Customer quote/booking, order/payment, addresses, invoices, tracking and delivery OTP endpoints.
- Vendor order lifecycle, fleet, location, documents and earnings endpoints.
- Admin/dispatcher order, assignment, dashboard, report, pricing, partner application, enquiry, notification and system-health endpoints.
- Razorpay order, signature verification, webhook, reconciliation and refund endpoints.
- Partner application submission and signed document uploads; admin enquiry list and status updates.

The dated `docs/api_consumers.md` contains endpoint-by-endpoint request/response/consumer notes for the web and native app. Recheck that inventory against the current branch before depending on its historical branch names or reported mismatch list.

## Change log

| Date | Change | Compatibility / validation |
| --- | --- | --- |
| 2026-11-20 | Hardened authenticated account phone verification: requests no longer reveal duplicate-number ownership; confirms report conflicts. Five incorrect codes lock further confirmation and resends for 10 minutes. 24-hour caps are 10 sends per phone and 30 per IP. Added masked structured audit events. Optional `PHONE_VERIFY_REQUIRED_AFTER` (ISO-8601) gates customer order and payment-order creation plus authenticated partner applications after its deadline when `PHONE_VERIFY_DIALOG_ENABLED=true`; `/auth/me` exposes `phoneVerificationRequired`. | Uses the existing shared OTP challenge table and provider fallback. Guest partner applicants retain their existing OTP flow, and per-order contact OTP remains separate and required by default. Apply `backend/supabase/006_phone_verification_hardening.sql` before deploying; migration not applied. |
| 2026-11-18 | None. Stage 1 was repository analysis and documentation. | No API implementation changed; endpoint behavior was inspected, not newly integration-tested. |
| 2026-11-18 | Flutter Admin Setup now consumes existing `GET /api/admin/enquiries?page=&pageSize=` and `PATCH /api/admin/enquiries/:id` contracts for listing and status/response updates. | No backend route or response contract changed. Authenticated MockClient contract tests cover pagination and update payloads; a stored response note is not an outbound customer notification. |
| 2026-11-18 | Added public `POST /api/service-enquiries` for Empty Tanker, RMC Concrete Mixer, and Borewell enquiries. Added admin `GET /api/admin/enquiries/:id/history`; admin status/response updates now write the acting admin and preserve an existing response when omitted. | Zod validation and IP rate limiting are covered by route tests; web API and mobile history contracts are tested. Apply `002_service_enquiries.sql` before deploying these API changes. Live database, SMS/email and deployed Admin App behavior were not tested. |
| 2026-11-18 | Extended partner application submissions with an optional `vehicles` array containing each vehicle's registration, type, selected service, capacity, availability and associated document paths. Added admin `GET /api/admin/partner-applications/:id/history`, the `additional_info_required` review status, and persisted admin notifications after application save. Active applications are checked by mobile number before insert; legacy single-primary-vehicle payloads remain accepted. | Backend validates vehicle count, unique registrations within one application, selected service membership, document association, and duplicate active applications for a phone number. The migration adds a race-safe partial unique index and append-only history trigger. Notification failure does not roll back an application and is returned as `notificationStatus: "unavailable"`; cross-phone vehicle-registration collisions and live notification/Admin App behavior remain unverified. |
| 2026-11-18 | Admin report requests now validate report type and ISO date ranges, reject reversed ranges, and return the selected type. Vendor reports group actual assigned bookings by vendor with order/completion counts and quoted value. The live Admin Reports screen exports filtered rows as CSV or PDF. | Backend route tests cover invalid ranges, filters, empty results and vendor grouping; a Playwright browser test verifies vendor CSV contents and a valid PDF download. Totals are quoted booking amounts, not reconciled cash revenue or profit; Excel export remains outstanding. |
| 2026-11-18 | Razorpay verification now requires a successful provider lookup confirming the exact payment ID, order ID, amount, and `captured` status before marking an existing payment paid or creating a checkout booking. Lookup failures and authorization-only payments remain unconfirmed for safe retry/webhook settlement. | Backend regression tests cover provider lookup failure and non-captured payments for both existing bookings and pre-booking checkouts. Staging credentials/provider behavior and live webhook delivery remain unverified. |
| 2026-11-18 | Added admin-only `GET /api/admin/services/:id/pricing-history`, returning up to 100 newest snapshots with old/new base price and config, timestamp, action, and resolved administrator name. Admin service create/price updates now identify the actor for the database audit trigger. | Backend route tests cover authorized access, invalid IDs, changed-by attribution, history output, and vendor catalog field allowlisting; web API tests cover the typed client. Apply `004_service_pricing_history.sql` before deploying these writes/reads. |
| 2026-11-18 | Admin report exports now include a real `.xlsx` workbook in addition to the existing filtered CSV and PDF downloads. | No API change; the workbook uses the already generated report rows and current date filters. A browser test opens the downloaded workbook and verifies its report type and vendor values. Production data and financial accounting semantics remain unverified. |

## Service enquiry contract

`POST /api/service-enquiries` is public and rate-limited to 10 submissions per IP per hour. It requires `customerName`, a 10-digit Indian `mobile`, `location`, `requiredDate` (today or later), `serviceCategory`, and category-specific `details`; `email` is optional. Categories and required details:

- `empty_tanker`: `capacityLitres` (1,000–50,000) and `requirements`.
- `rmc`: `grade`, `quantityCubicMetres`, `pumpRequired`, and optional `requirements`.
- `borewell`: `proposedDepthMetres` and `siteRequirements`.

The API stores the enquiry before attempting admin notifications. A successful response includes `notificationStatus: "created" | "unavailable"`; `"unavailable"` means the enquiry is still saved and visible in the Admin Panel, while notification failure is logged and shown to the customer.

`GET /api/admin/enquiries/:id/history` requires admin authentication and returns the append-only submission/status/response history written by the database trigger. `PATCH /api/admin/enquiries/:id` remains admin-only; omitting `response` retains the saved note.

Partner application clients may continue sending the existing `vehicleCount`, `registration`, and `capacity` fields. New clients additionally send `vehicles`, where the array length must match `vehicleCount`; each vehicle contains `registrationNumber`, `vehicleType`, `serviceCategory`, `capacity`, `availability`, and `documents`. The API retains the legacy primary-registration/capacity columns and writes the structured array to `vehicle_details`.

`GET /api/admin/partner-applications/:id/history` requires admin authentication and returns submission/review status and note history written by the database trigger. It only includes events recorded after `003_partner_vehicle_details.sql` is applied; it does not fabricate earlier review history.

Partner submission persists the application before creating `partner.application_submitted` notifications for admins. The response includes `notificationStatus: "created" | "unavailable"`; an unavailable notification leaves the saved application available in the Admin Panel and is logged for operations follow-up.

`POST /api/admin/reports` accepts `type` (`orders`, `vendors`, or `revenue`), ISO `from`/`to` dates with `from <= to`, and optional status/service/customer-type filters. Orders/revenue return matching booking rows; vendor reports group assigned bookings by vendor and include booking count, delivered count, and quoted amount. The total is based on `quoted_amount_paise`, not an accounting revenue/profit measure; expenses and reconciled cash revenue are not represented by this endpoint.

`GET /api/admin/services/:id/pricing-history` is admin-only and accepts a service UUID. It returns an array with `action`, `changed_by` / `changed_by_name`, `old_base_price_paise`, `new_base_price_paise`, `old_config`, `new_config`, and `created_at`. Results are newest-first and capped at 100. History is recorded by PostgreSQL triggers for catalog inserts and base-price/config changes after `004_service_pricing_history.sql` is applied; it does not backfill pre-migration prices or implement multiple concurrent/future price schedules.

`POST /api/payment/razorpay/verify` still requires a valid checkout signature. It now also queries Razorpay and only settles as paid when the returned payment ID/order ID/amount match the stored order and the provider reports `captured`. If provider status cannot be fetched, the API responds `503`; if the payment is not yet captured or its details do not match, it responds `409`. Clients should retry confirmation with the same payment IDs and must not initiate a second payment; the signed webhook remains the settlement path if capture arrives later.

## Contract requirements for future changes

- Preserve existing paths, auth, role checks and response shapes unless all web/mobile consumers are assessed.
- Add backend Zod validation, explicit authorization, audit behavior where appropriate, and useful failure responses.
- Use idempotency/transactions for payment, booking, assignment, notifications, and invoice creation where the existing workflow requires them.
- Do not expose secrets, delivery hashes, private document URLs, or unrelated customer/vendor data.
- For web/Admin Flutter parity, document request fields, response shape, auth role, retry/idempotency semantics, and rollout behavior together.
- Add contract-focused API/client tests and update this file for each new or changed route.
