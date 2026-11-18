# Testing report

**Updated:** 2026-11-18  
**Stage 1:** Repository discovery was analysis-only. Follow-up code changes and current-branch verification are recorded below. Do not interpret historical audit results as current-branch execution.

## Available checks

| Project | Configured checks |
| --- | --- |
| Web (`ut_landing`) | `npm test` (Vitest), `npm run lint`, `npm run build`, `npm run test:e2e`, plus booking/realtime Playwright configurations. |
| API (`ut_landing/backend`) | `npm test`, `npm run lint` (TypeScript no-emit), `npm run build`, `npm run db:check`; Vitest and Supertest are installed. |
| Flutter (`urban_tanker_app`) | `flutter analyze`, `flutter test`; Android build on an appropriately configured machine. iOS build/signing requires macOS/Xcode. |
| CI | Workflow files under `.github/workflows/` run configured repository checks; inspect the current workflow before claiming which gates passed. |

## Historical baseline (not rerun)

- `docs/APP_ANALYSIS.html` reports 15 frontend and 65 backend tests passing during a prior review, with three Playwright specs not run in that review.
- `docs/IMPLEMENTATION_BACKLOG.html` records earlier frontend/backend/Playwright checks. These are dated findings and may not match the current branch.
- `docs/api_consumers.md` and prior reports contain unverified staging/device follow-ups and historical client/API mismatch observations. Confirm any candidate bug on current source before changing it.

## Required validation by stage

- **Customer:** homepage/navigation, OTP throttling/expiry/errors, profile/session, single and multi-service pricing, payment cancel/failure/retry/signature/idempotency, invoice eligibility/download, tracking stale/unavailable states, delivery OTP authorization, enquiries/partner submissions.
- **Vendor:** account isolation, service queues, pagination, accept/reject/transitions, vehicle capacity, location permission/freshness, delivery verification, earnings.
- **Admin/dispatcher:** role boundary, actual dashboard metrics, assignment conflict/capacity rules and audit trail, operational filters/refresh, pricing history, filtered financial exports, partner/enquiry status synchronization and health alerts.
- **Cross-platform/release:** targeted unit/API/integration tests, web build/lint/type checks, Flutter analyze/test/build where supported, responsive/accessibility review, migration test on disposable DB, provider staging tests, security checks, and regression coverage.

## Results log

| Date | Command / scenario | Result |
| --- | --- | --- |
| 2026-11-18 | Current partner vehicle details increment: `npm test`, `npm run lint`, and `npm run build` in `ut_landing` and `ut_landing/backend` | Passed: web 21 files / 75 tests; backend 47 files / 346 tests; both lint checks and production builds passed. Migration `003_partner_vehicle_details.sql` was not run against PostgreSQL. |
| 2026-11-18 | Flutter Admin partner review increment: `flutter analyze` and `flutter test` in `urban_tanker_app` | Passed: analyzer reported no issues; 279 tests passed and 5 were skipped. |
| 2026-11-18 | Partner review history increment: backend `npm test`, `npm run lint`, `npm run build`; Flutter `flutter analyze`, `flutter test` | Passed: backend 47 files / 348 tests; Flutter analyzer clean; 279 tests passed and 5 skipped. PostgreSQL migration and deployed history were not verified. |
| 2026-11-18 | Partner review statuses and client contracts: backend `npm test`, lint, build; Flutter `flutter analyze`, `flutter test` | Passed: backend 47 files / 349 tests; Flutter analyzer clean; 281 tests passed and 5 skipped. Migration `003_partner_vehicle_details.sql` was not run against PostgreSQL. |
| 2026-11-18 | Partner admin notifications: web `npm test`, lint, build; backend `npm test`, lint, build; Flutter checks unchanged | Passed: web 21 files / 75 tests; backend 47 files / 351 tests; web and API lint/builds passed. Notification failure preservation is unit-tested; live notification delivery remains unverified. |
| 2026-11-18 | Live report filters and exports: web `npm test`, lint, build; backend `npm test`, lint, build | Passed: web 21 files / 75 tests; backend 47 files / 353 tests; lint/builds passed. Report filter and empty-result API tests pass; PDF download was not browser-tested. |
| 2026-11-18 | Vendor report aggregation: web `npm test`, lint, build; backend `npm test`, lint, build | Passed: web 21 files / 75 tests; backend 47 files / 354 tests; lint/builds passed. Vendor grouping, delivery counts, and quoted-value aggregation are API-tested; export downloads were not browser-tested. |
| 2026-11-18 | Admin report export: `npx playwright test --config=playwright.admin-reports.config.ts` | Passed: browser-generated vendor report request retained selected filters, CSV downloaded with the expected grouped vendor values, and PDF downloaded with a valid PDF signature. API data was intercepted; this does not verify production data or accounting semantics. |
| 2026-11-18 | Razorpay capture verification: backend `npm test -- --run src/routes/payments.test.ts`, full `npm test`, `npm run lint`, `npm run build`; Flutter payment-flow/API tests and `flutter analyze` | Passed: payment route 27 tests; backend 47 files / 357 tests; backend lint/build passed; Flutter 16 payment tests passed and analyzer clean. Tests confirm provider lookup failures and authorized-but-uncaptured payments are not marked paid or used to create checkout bookings. Live Razorpay API/webhook behavior remains unverified. |
| 2026-11-18 | Service pricing audit increment: web and backend `npm test`, `npm run lint`, `npm run build` | Passed: web 21 files / 76 tests; backend 47 files / 362 tests; both lint checks and production builds passed. Targeted coverage includes history endpoint fields, invalid IDs, admin-only access, authenticated editor attribution, API client shape, and ensuring vendor catalog selections omit `updated_by`. Migration 004 and trigger behavior remain unverified on PostgreSQL. |
| 2026-11-18 | Excel report export: web `npm test`, `npm run lint`, `npm run build`; `npx playwright test --config=playwright.admin-reports.config.ts`; dependency audits | Passed: web 21 files / 76 tests; lint/build; browser test downloaded CSV, XLSX, and PDF and read the generated workbook rows; `npm audit --omit=dev` found 0 vulnerabilities. Semver-compatible `npm audit fix` updated the lockfile; full audit still reports 15 high advisories in development/build tooling (including picomatch paths), for separate compatibility review. |
| 2026-11-18 | `npm run test:e2e:booking` in `ut_landing` | Passed: all 21 browser tests, including a 320px no-horizontal-scroll homepage assertion, password recovery, email OTP signup, multi-service details, and repeat booking. |
| 2026-11-18 | Local homepage browser check | Passed: no horizontal document overflow at 320, 390, 400, 401, 414, 760, 761, and 1280px; hero heading and booking action remained visible. |
| 2026-11-18 | `npm test`, `npm run lint`, and `npm run build` in `ut_landing` | Passed: 20 files / 72 tests; ESLint; TypeScript/Vite production build, deployment-config preparation, and clean bundle verification (75 JavaScript assets). |
| 2026-11-18 | `npm test` in `ut_landing` | Passed: 20 files, 72 tests. |
| 2026-11-18 | `npm test` in `ut_landing/backend` | Passed: 46 files, 337 tests. |
| 2026-11-18 | `npm run lint` and `npm run build` in `ut_landing` | Passed: ESLint, TypeScript/Vite production build, deployment-config preparation, and bundle verification (75 JavaScript assets). |
| 2026-11-18 | `npm run lint` and `npm run build` in `ut_landing/backend` | Passed: TypeScript no-emit lint and API build. |
| 2026-11-18 | `flutter analyze` and `flutter test` in `urban_tanker_app` | Passed after adding mounted-context guards in the booking flow: no analyzer issues; 276 tests passed and 5 skipped. |
| 2026-11-18 | `flutter test test/api_client_contract_test.dart` in `urban_tanker_app` | Passed: 13 tests, including authenticated Admin enquiry pagination and status/response updates. |
| 2026-11-18 | `flutter analyze` and `flutter test` in `urban_tanker_app` | Passed after adding the Admin Enquiries tab and API client methods: analyzer reported no issues; 278 tests passed and 5 skipped. |
| 2026-11-18 | `git diff --check` in `ut_landing` | Passed; Git reported line-ending normalization notices for the two routing files. |
| 2026-11-18 | `npm test`, `npm run lint`, `npm run build`, and `npm run test:e2e:booking` in `ut_landing` | Passed: 21 files / 75 tests; ESLint; production build and bundle verification; all 22 Playwright tests, including mobile RMC enquiry submission and the unavailable-notification message. |
| 2026-11-18 | `npm test`, `npm run lint`, and `npm run build` in `ut_landing/backend` | Passed: 47 files / 343 tests; TypeScript no-emit lint and API build. |
| 2026-11-18 | `flutter analyze` and `flutter test` in `urban_tanker_app` | Passed after adding enquiry-history API/UI; analyzer reported no issues and full test command exited successfully (5 skipped). |
| 2026-11-18 | `git diff --check` in `ut_landing` and `urban_tanker_app` | Passed. |

## External limitations

No staging credentials, Razorpay transactions, SMS/email/push delivery, GPS device session, production database, additive migration execution, or Admin App deployment was available for validation during this review.
