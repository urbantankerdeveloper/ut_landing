# Architecture review

**Review date:** 2026-11-18  
**Scope:** `ut_landing` web/API repository and the sibling `urban_tanker_app` Flutter repository.  
**Branch:** `feature/complete-platform-ui-ux-upgrade` is active in both repositories. Both were clean on `main` before branch creation. No source changes have been made for this review.

## Platform map

| Layer | Current implementation |
| --- | --- |
| Customer website and web workspaces | React 19, TypeScript 6, Vite 8, React Router 7, TanStack Query, Zustand, React Hook Form/Zod, and SCSS in `src/`. The public website and customer/vendor/admin/dispatcher workspaces share one application. |
| API | Node.js 22, Express 5, TypeScript, Zod request validation, Supabase JS, and a PostgreSQL connection pool in `backend/src/`. |
| Persistence and identity | Supabase Auth and PostgreSQL. The canonical schema is `backend/supabase/001_initial.sql`; it is a destructive fresh-install/reset script, not a safe production migration. |
| Realtime and maps | Socket.IO server/client with optional Redis adapter; Leaflet/OpenStreetMap is available, with optional Google Maps integrations. Vendor location updates are persisted by the API. |
| Native mobile / Admin App | The separate Flutter application in `urban_tanker_app` (Dart SDK `>=3.4.0`), with Riverpod, a shared API client, secure token storage, Socket.IO, maps, and customer/vendor/admin/dispatcher screens. This is the only Admin mobile codebase found in the workspace; no other Admin App repository or contract was supplied. |
| Deployment | Web build uploaded to Hostinger `public_html`; API deployed separately on Render using `render.yaml`; mobile builds require platform tooling/signing. |

## Identity, roles, and API boundaries

- Backend roles include customer, vendor, dispatcher, and admin. Authentication middleware validates Supabase-backed identities and enforces route roles.
- The web client uses access tokens and an HttpOnly refresh cookie. The mobile app uses a distinct mobile refresh endpoint and stores access/refresh tokens in platform secure storage.
- Authentication includes password/email, phone OTP, guest phone verification, refresh, logout, and account-recovery paths. OTP challenges are hashed, expire, and have rate and attempt limits. A repository audit notes that one native email-OTP path is not backed by a matching API route and is disabled on 404/501; verify before modifying auth.
- API route groups are mounted at `/api/auth`, `/api/config`, `/api/customer`, `/api/vendor`, `/api/admin`, `/api/payment`, `/api/public`, `/api/partner`, `/api/analytics`, `/api/support`, `/api/uploads`, and `/api/devices`; health routes are `/health` and `/health/ready`.
- A dated API-consumer audit (`docs/api_consumers.md`, 2026-11-03) inventories 132 web endpoints and native consumers. Treat its branch references and counts as historical evidence, not a substitute for rechecking current call sites.

## Business workflows and integrations found

- **Bookings:** booking quote/checkout, service-specific task details, parent order grouping, customer addresses and repeat-booking drafts. Multi-service tasks are behind `multi_service_tasks_enabled`.
- **Payments and invoices:** Razorpay orders, signature-verified callback, signed webhooks, reconciliation/refund paths, and idempotent itemized invoice generation exist. Online payment and invoice-generation flags remain conservative; production credentials, rollout flags, webhook delivery, and invoice-email behavior require live verification.
- **Dispatch and tracking:** booking lifecycle transitions, manual/automatic assignment modes, vendor/vehicle/driver records, location history, authenticated/public tracking, Socket.IO updates, delivery OTP, and document uploads exist. Continuous mobile/background tracking and real GPS/device behavior are not established by source inspection.
- **Partner onboarding and enquiries:** partner application APIs, OTP-gated document upload, admin application endpoints, and admin enquiry list/status endpoints exist. The Admin Flutter client's coverage and end-to-end synchronization for these records must be verified before claiming parity.
- **Notifications:** database notification records, email, SMS provider adapters, web/mobile push code, and realtime notifications exist. Delivery depends on provider credentials/templates, device registration, permissions, and deployment configuration.
- **Monitoring and reporting:** liveness/readiness health routes, an admin system-health view, JSON logging, analytics APIs/exports, admin reports, and scheduled cleanup/reminder jobs exist. Provider health, financial report correctness, export coverage, and operational alerting need focused validation.
- **Admin mobile:** Flutter contains admin dashboard, orders, reports, notifications, and management API clients. It uses the same REST API; no independent synchronization service was found. New records/actions must be confirmed against both clients and deployed API contracts.

## Data model and migration constraints

The schema includes profiles and roles, vendors, vehicles, drivers, service catalog, bookings and grouped tasks, lifecycle events, payments, invoices, addresses, notifications, saved documents, location updates, partner applications, enquiries, audit logs, pricing/configuration, payouts, and analytics. RLS is enabled on sensitive tables; application APIs use server-side service credentials and must preserve route-level authorization.

`backend/supabase/001_initial.sql` drops and recreates the public schema and consolidates historical schema changes. Never run it against a database with data to preserve. There is no established incremental migration runner in the current package scripts; any schema change requires an explicitly reviewed, non-destructive upgrade path and a documented rollout.

## Quality and deployment

- Frontend: Vitest, ESLint, TypeScript/Vite production build, and Playwright projects for core/booking/realtime behavior.
- Backend: Vitest, TypeScript build/lint, database-check/backup/reset scripts, and Supertest dependency.
- Flutter: `flutter analyze` and `flutter test`; Android builds are available on a configured machine, while iOS signing/build validation requires macOS/Xcode.
- CI is defined under `.github/workflows/`. Production secrets are configured in hosting/provider environments; `.env.local` files are intentionally excluded from this review.
- Existing architecture/design, consumer, feature-flag, deployment, payment, and Maps audit documents were consulted. Their results are not newly executed test evidence.

## Constraints and immediate risks

1. Keep the existing web and mobile applications and their contracts; do not rebuild them or infer missing functionality from UI alone.
2. Do not use the canonical SQL reset script as an upgrade. Require a reviewed additive migration before any persistent schema change.
3. Keep payment, invoice, geolocation, SMS/email, push, and cross-client status claims gated on provider/device/deployment verification.
4. Confirm which deployed native build is the intended Admin App and check the API contract before making synchronization claims.
5. Test current branches, not stale report branch names. Do not read, repeat, or copy local environment secrets into documentation.

## Repository analysis outcome

Stage 1 identified the application boundaries, frameworks, core data/workflow surfaces, integrations, tests, and deployment topology. The complete feature inventory and staged verification plan are in `IMPLEMENTATION_PLAN.md`.
