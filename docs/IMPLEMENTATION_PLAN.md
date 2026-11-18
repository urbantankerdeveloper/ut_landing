# Implementation plan and feature checklist

**Overall status:** In Progress  
**Updated:** 2026-11-18  
**Working branch:** `feature/complete-platform-ui-ux-upgrade` in both `ut_landing` and `urban_tanker_app`.
**Database note:** Migrations 002–004 have been applied and verified on the configured development database only; production remains unverified.

Status definitions: **Not Started**, **In Progress**, **Completed**, **Blocked**, **Requires External Configuration**. A feature is not complete because a screen or API exists; mark it complete only after relevant behavior, authorization, error/empty states, tests, and required integration checks pass.

## Stages

| Stage | Scope | Status | Exit evidence |
| --- | --- | --- | --- |
| 1 — Discovery | Review both repositories, workflows, APIs, schema, dependencies, tests, deployment, and UI skill; create this documentation set; branch both repositories. | Completed | Branches active; architecture, design, API, database, integration, testing, and deployment baselines recorded. |
| 2 — Design system | Apply UI/UX Pro Max guidance to existing tokens/components; keep the branded service/logistics direction, define responsive/accessibility patterns, and validate relevant views. | In Progress | Skill prompt read; local Python search unavailable, so used the documented Quick Reference. Fixed the public header's mobile spacing/cascade and verified no overflow from 320px through desktop; operational review and broader accessibility checks remain. |
| 3 — Customer | Homepage/SEO, auth and OTP, service booking, multi-service orders, payment/invoice, tracking and delivery OTP. | In Progress | Corrected the verified canonical production host across static and route metadata; fixed repeat-booking navigation losing its payload; homepage mobile and booking browser coverage pass. Other customer workflows and external checks remain. |
| 4 — Vendor | Service queues, details, fleet/capacity, order transitions, location, earnings, responsive/accessibility. | In Progress | Existing role-scoped web and mobile surfaces identified; contract/device regression remains. |
| 5 — Administration | Dashboard/KPIs, assignment and audit, operations, rates/history, financial reports/downloads, health and monitoring. | In Progress | Existing admin APIs/screens identified; report filters validate date ranges, vendor reports group actual booking data, and live filtered results export as CSV/PDF/XLSX. Added append-only service pricing snapshots and a history view/API; migration 004 is applied on development only. Reconciled revenue/expenses/profit and broader admin validation remain. |
| 6 — Business and mobile integration | Enquiries, partner application/review, internal notifications and Flutter Admin parity. | In Progress | Added public service-specific enquiry forms/API, persisted admin notifications and history, plus Flutter list/status/history support. Partner applications collect per-vehicle details, reject duplicate active phone applications, persist admin alerts after save, and expose Flutter review/history including an additional-information-required status. Migrations 002–004 are applied on development only; deployed notification polling/synchronization, cross-phone vehicle duplicates and broader new-record/action parity remain unverified. |
| 7 — Quality assurance | Unit/integration/API/E2E, builds, lint/type checks, accessibility/responsive, security, migration and production integration checks. | In Progress | Web/API unit tests, lint/builds, booking Playwright tests, homepage viewport coverage and Flutter analysis/tests pass. Realtime E2E, provider, staging, migration, accessibility and production integration checks remain. |

## Business-area checklist

| # | Business area | Status | Discovery evidence / remaining work |
| --- | --- | --- | --- |
| 1 | Customer homepage and login/OTP | In Progress | Landing page, responsive hero assets, metadata/navigation, password and OTP endpoints exist. Recheck all current OTP UX, resend/error states, session restoration, SEO, and mobile layout. |
| 2 | Booking and multiple services | In Progress | Service-specific drafts, saved addresses, repeat booking, quote summary, grouped task support and rollout flag exist. Fixed navigation cleanup erasing repeat-booking data; the multi-service repeat flow now has passing browser coverage. Pricing/availability per line, parent summary and broader regression remain. |
| 3 | Payments and invoices | Requires External Configuration | Razorpay order/verify/webhook, reconciliation, refunds and invoice generation exist. Verify live keys/webhooks and enabled flags; confirm retry/idempotency and invoice delivery/history. |
| 4 | Tracking and delivery completion | Requires External Configuration | Ownership-checked tracking, maps, realtime/location records and delivery OTP exist. Verify real device permissions/location, update freshness, SMS and backend completion on staging. |
| 5 | Vendor dashboard | In Progress | Web and Flutter vendor screens, queues, fleet, services, earnings and order APIs exist. Validate category separation, pagination/contracts, authorization, transitions and mobile usability. |
| 6 | Vendor assignment | In Progress | Admin assignment, manual-assignment configuration, vehicle/driver and capacity-related records exist. Verify service/coverage/workload/capacity rules, conflict handling and audit history. |
| 7 | Admin dashboard | In Progress | Web and Flutter dashboards plus a versioned summary API exist. Verify actual metrics, date/currency semantics, responsive charts and permission boundaries. |
| 8 | Live operations | In Progress | Admin/dispatcher boards, events, alerts, location and status lifecycle exist. Verify update delivery, filters, volume behavior and delayed/exception states. |
| 9 | Reports and analytics | In Progress | Live report inputs validate date ranges and selected filters; vendor reports group assigned bookings and filtered exports are browser-verified as CSV/PDF/XLSX. Monthly trend analytics, accounting-grade revenue/expense/profit separation, timezone/currency semantics and deployed downloads remain. |
| 10 | Service rate management | In Progress | Admin pricing/catalog and quote snapshots exist. Added a database audit trail for catalog price/config changes and an admin history view/API. Migration 004 is applied on development only; the current catalog still holds one rate/config per service, so simultaneous/future schedules and location-specific rates remain outstanding. Verify confirmed-booking price immutability and deployed audit visibility. |
| 11 | Monitoring and notifications | Requires External Configuration | Health routes, admin health, logs, jobs and notification adapters exist. Validate DB/provider/job/GPS indicators, alert delivery, reminder intervals and sensitive-log redaction. |
| 12 | New service enquiries | In Progress | Marketing services collects Empty Tanker, RMC and Borewell requirements; a rate-limited API persists structured fields and returns an explicit admin-notification result; the migration trigger records history. Migration 002 is applied on development only; verify production notification and Admin Panel behavior. |
| 13 | Partner registration and approval | In Progress | OTP, document upload, partner application, admin review/history APIs, Flutter status/review-note/history UI, per-vehicle details, duplicate active mobile-number prevention, and persisted admin notifications exist. `003_partner_vehicle_details.sql` is applied on development only; verify cross-phone vehicle-registration duplicates, customer-facing additional-information notification, access timing, and deployed Admin Panel/App presentation. |
| 14 | Admin mobile integration | In Progress | Flutter app includes paginated enquiry list, status/response editor and history display, using authenticated admin endpoints. Verify migration/API compatibility, alert delivery, retries, dedupe, timestamps and deployed app/API behavior. |
| 15 | Cross-role quality and release | Not Started | Test frameworks and CI exist. Run targeted web/backend/mobile checks; staging, provider credentials, production data, signed builds, accessibility and security gates remain. |

## Execution guardrails

- Reuse existing patterns, clients, endpoints, and design tokens. Change one workflow at a time and preserve old contract behavior.
- Use a new additive migration for existing installations; do not edit production data through the destructive canonical installer.
- Treat provider, device, hosting, finance, and Admin App deployment checks as unverified until run with authorized test infrastructure.
- Before each stage is called complete, record changes/files, API and schema effects, commands/results, known issues, external prerequisites, and remaining work in the companion status documents.

## Initial implementation increment report (historical)

1. **Changes implemented:** Created the requested documentation and checklist; corrected static and route-driven canonical/Open Graph/Twitter/structured-data URLs to the documented production host; added explicit mounted-context guards around two asynchronous Flutter booking-dialog paths; fixed repeat-booking navigation dropping the one-time booking payload; corrected the public header's mobile gutter cascade and sizing to prevent horizontal scrolling at 320px; updated stale booking/auth browser assertions and fixtures to match the current OTP, recovery-link and booking-history contracts.
2. **Files modified:** `ut_landing/.gitignore`, `ut_landing/index.html`, `ut_landing/src/routing/useDocumentMeta.ts`, `ut_landing/src/routing/useAppNavigation.ts`, `ut_landing/src/styles/_layout.scss`, `ut_landing/src/styles/responsive.scss`, `ut_landing/tests/booking-e2e.spec.ts`, `urban_tanker_app/lib/screens/home/booking/booking_form_sheet.dart`, and the eight Markdown files in `ut_landing/docs/`.
3. **APIs added or changed:** None.
4. **Database migrations:** None; no database was accessed.
5. **Tests executed:** `npm run test:e2e:booking`, `npm test`, `npm run lint`, and `npm run build` in `ut_landing`; browser viewport checks at eight widths; earlier API and Flutter validation is detailed in `TESTING_REPORT.md`.
6. **Test results:** All 21 browser tests passed; frontend 72 tests passed; frontend lint/build passed; backend 337 tests and lint/build passed; Flutter analysis had no issues and 276 tests passed with 5 skipped; whitespace checks passed.
7. **Known issues:** The broader UI redesign and role-wide regression coverage remain incomplete; live provider, staging, GPS-device, deployed Admin App, migration and accessibility checks are still unverified.
8. **External dependencies:** UI/UX Pro Max's search script requires Python 3, unavailable in this environment. No provider, production database, GPS device, or deployed Admin App credentials were supplied.
9. **Remaining work:** Continue design-system adoption and role-by-role behavior verification; run realtime E2E, accessibility/security checks; validate provider and Admin App flows in staging; review non-destructive migration/deployment requirements before any schema change.

## Service enquiry and admin mobile increment

1. **Changes implemented:** Added public, validated service-specific enquiry forms for Empty Tanker, RMC Concrete Mixer, and Borewell Services; rate-limited persistence and admin notification creation; database-triggered enquiry history; an admin history endpoint; web status updates that preserve omitted response notes; and Flutter list, status/response editor, and history display.
2. **Files modified:** Web: `src/api/customer.ts`, `src/api/admin.ts`, `src/screens/MarketingServicesScreen.tsx`, `src/screens/ServiceEnquiryDialog.tsx`, `src/screens/AdminProgramsScreen.tsx`, `src/styles/workspace-actions.scss`, `src/styles/admin-workspace.scss`, `src/api/customer.test.ts`, `src/api/admin.test.ts`, and `tests/booking-e2e.spec.ts`. API/schema: `backend/src/routes/serviceEnquiries.ts`, `backend/src/routes/serviceEnquiries.test.ts`, `backend/src/routes/adminExtended.ts`, `backend/src/server.ts`, and `backend/supabase/002_service_enquiries.sql`. Flutter: `lib/services/api/admin_api.dart`, `lib/services/api_client.dart`, `lib/screens/admin/operations/setup_section.dart`, and `test/api_client_contract_test.dart`.
3. **APIs added or changed:** Added public `POST /api/service-enquiries` and admin-only `GET /api/admin/enquiries/:id/history`; `PATCH /api/admin/enquiries/:id` now preserves the response when omitted and records the acting admin.
4. **Database migrations:** Added `backend/supabase/002_service_enquiries.sql`; not applied. The canonical `001_initial.sql` was not changed or executed.
5. **Tests executed:** Web unit tests, lint, production build and booking Playwright suite; API full test suite, type check and build; Flutter analyzer and full tests. Exact results are recorded in `TESTING_REPORT.md`.
6. **Test results:** Web 75 tests and 22 browser tests passed; backend 343 tests passed; Flutter analyzer and test suite passed (5 skipped).
7. **Known issues:** The migration was not run against PostgreSQL. Admin alert delivery is in-app/realtime only; no SMS/email notification or deployed app/API synchronization was verified.
8. **External dependencies:** Authorized disposable/staging PostgreSQL and deployed Admin App/API access are needed for migration and live integration verification.
9. **Remaining work:** Validate/apply the migration in the approved order; verify admin alert delivery/failure visibility and the history view on staging; continue remaining platform modernization and role-wide regression.

## Partner vehicle details increment

1. **Changes implemented:** The web partner form now supports adding/removing multiple vehicles and captures individual registration, vehicle type, selected service, capacity, availability, and vehicle documents. The API validates per-vehicle completeness, count consistency, unique registrations within one application, service membership, document association, and existing active applications by phone; legacy payloads remain accepted. Applications persist before admin notifications; failures are explicit and do not roll back submissions. Added an additive migration for structured vehicle details, race-safe active-phone uniqueness, status expansion, and append-only review history. Flutter Admin Finance offers review and history views.
2. **Files modified:** `src/screens/PartnerApplicationScreen.tsx`, `src/api/partner.ts`, `src/content/partner.ts`, `src/styles/_partner.scss`, `backend/src/routes/partner.ts`, `backend/src/routes/partner.test.ts`, `backend/src/routes/admin.ts`, `backend/src/routes/admin.partner-documents.test.ts`, `backend/supabase/003_partner_vehicle_details.sql`, and Flutter admin finance/API client and contract-test files; updated database, API, integration, deployment, testing, and implementation documents.
3. **APIs added or changed:** Extended `POST /api/partner/applications` with optional structured `vehicles`; added admin-only `GET /api/admin/partner-applications/:id/history`; extended partner review to support `additional_info_required`.
4. **Database migrations:** Added `backend/supabase/003_partner_vehicle_details.sql`; not applied or exercised against PostgreSQL.
5. **Tests executed:** Web `npm test`, `npm run lint`, `npm run build`; backend `npm test`, `npm run lint`, `npm run build`; Flutter `flutter analyze` and `flutter test`.
6. **Test results:** Web 75 tests passed and lint/build succeeded; backend 351 tests passed and TypeScript lint/build succeeded; Flutter analysis passed and 281 tests passed with 5 skipped.
7. **Known issues:** The migration was not applied; active phone duplicates must be resolved before applying it. Vehicle-registration collisions across applications with different phones, customer-facing additional-information notification, and live Admin Panel/App notification polling are not verified; legacy applications have no fabricated per-vehicle details or historical review entries.
8. **External dependencies:** Apply the migration through an authorized operator after disposable-database validation; staging is needed to verify document access and admin presentation.
9. **Remaining work:** Validate migrations in order; complete partner duplicate/access/approval flows and broader requested modernization; run deployed Admin App, staging, accessibility, and provider checks.

## Live report export increment

1. **Changes implemented:** The admin report endpoint validates supported report types and ISO date ranges, rejects reversed ranges, applies current status/service/customer filters, and safely returns empty results. Vendor reports group assigned bookings by vendor with count, delivery count, and quoted value. Live report exports include filtered records in CSV and a lazy-loaded PDF.
2. **Files modified:** `backend/src/routes/admin.ts`, `backend/src/routes/admin.partner-documents.test.ts`, `src/api/admin.ts`, `src/screens/AdminReportsLiveScreen.tsx`, `src/content/admin-operations.ts`, and `src/styles/admin-reports.scss`; updated API, testing, and implementation documentation.
3. **APIs added or changed:** Tightened `POST /api/admin/reports` validation and added selected report type to its response; no path changed.
4. **Database migrations:** None.
5. **Tests executed:** Web `npm test`, `npm run lint`, `npm run build`; backend `npm test`, `npm run lint`, `npm run build`.
6. **Test results:** Web 75 tests passed and lint/build succeeded; backend 354 tests passed and TypeScript lint/build succeeded.
7. **Known issues:** CSV/PDF download was not exercised in a browser. Current report total sums quoted booking amounts and must not be interpreted as reconciled revenue or profit; Excel export is not implemented.
8. **External dependencies:** Browser export smoke test and accounting data-source review are needed before operational use.
9. **Remaining work:** Implement correct report-specific data sources/aggregations and financial definitions; verify CSV/PDF output and add Excel only with an approved existing dependency/workflow; continue broader modernization.

## Service pricing audit increment

1. **Changes implemented:** Added an additive migration that stores the modifying administrator and creates append-only snapshots on service insert and base-price/config changes. Added an admin-only, newest-first history endpoint with actor names and a Pricing screen history panel showing action, editor, timestamp, prices, and effective-date window. Narrowed the vendor catalog field selection so the new internal actor ID is not exposed.
2. **Files modified:** `backend/supabase/004_service_pricing_history.sql`, `backend/src/routes/adminExtended.ts`, `backend/src/routes/vendor.ts`, `backend/src/routes/payments.test.ts`, `src/api/admin.ts`, `src/api/admin.test.ts`, `src/screens/AdminPricingScreen.tsx`, `src/content/admin-operations.ts`, and the database/API/integration/testing/deployment/implementation documents.
3. **APIs added or changed:** Added admin-only `GET /api/admin/services/:id/pricing-history`; service creation/price updates now associate the authenticated administrator for database audit records.
4. **Database migrations:** Added `004_service_pricing_history.sql`; not applied or run against PostgreSQL. Existing prices are not backfilled.
5. **Tests executed:** Web admin API tests, web lint and production build; backend pricing route tests and backend lint/build.
6. **Test results:** Web admin API: 3 tests passed; web lint/build passed. Backend payments/admin route file: 32 tests passed; backend lint/build passed.
7. **Known issues:** This is historical audit, not a financial ledger or a multi-rate scheduling model. Catalog pricing still represents a single current config; location-specific and concurrent/future schedules remain unimplemented. PostgreSQL trigger/privilege behavior has not been exercised on an actual database.
8. **External dependencies:** Validate and apply migration 004 after reviewing the additive migration sequence on a disposable PostgreSQL database and before deploying code that reads/writes the new schema.
9. **Remaining work:** Verify migration privileges/triggers on PostgreSQL, confirm confirmed booking snapshots stay unchanged in the deployed workflow, and continue the remaining modernization scope.

## Excel report export increment

1. **Changes implemented:** Added a lazy-loaded `.xlsx` workbook export for current filtered orders, revenue, or vendor report rows. Workbooks include a report title, selected date range, headers, numeric INR amounts, and filterable columns. Extended the browser report test to read the generated workbook and assert its values. Added ExcelJS with a compatible UUID override; moved Sass to development dependencies because it is a build-only tool.
2. **Files modified:** `package.json`, `package-lock.json`, `src/screens/AdminReportsLiveScreen.tsx`, `src/utils/xlsx.ts`, `src/content/admin-operations.ts`, and `tests/admin-reports.spec.ts`, plus API/implementation/testing/deployment notes.
3. **APIs added or changed:** None; exports use the already selected report response.
4. **Database migrations:** None.
5. **Tests executed:** Web `npm test`, `npm run lint`, `npm run build`, and `npx playwright test --config=playwright.admin-reports.config.ts`; production dependency audit with `npm audit --omit=dev`.
6. **Test results:** Web 21 files / 76 tests passed; lint/build passed; browser export test passed and reopened the XLSX workbook; production audit found zero vulnerabilities.
7. **Known issues:** Full development dependency audit still reports 15 high advisories in build/test tooling, including picomatch paths; these require separate compatibility review. Reported totals remain quoted booking amounts, not reconciled revenue or profit.
8. **External dependencies:** None for local export; workbook generation occurs in the browser.
9. **Remaining work:** Review remaining dev-tool advisories without unsafe major downgrades; implement accounting-grade financial data sources and continue report/analytics validation.
