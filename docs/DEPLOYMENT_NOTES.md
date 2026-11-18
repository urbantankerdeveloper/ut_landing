# Deployment notes

**Updated:** 2026-11-18  
**Status:** Discovery only; no deployment or external configuration changed.

## Existing topology

- **Web:** React/Vite build is uploaded from `dist/` to Hostinger `public_html`; the React app is separate from the retained legacy HTML reference tree.
- **API:** Express/TypeScript service runs on Render using `render.yaml`; `/health` is liveness and `/health/ready` checks database readiness.
- **Mobile:** `urban_tanker_app` builds native Android/iOS applications and uses `API_BASE_URL`/`SOCKET_URL` build configuration. Release signing credentials must remain outside source control. iOS release work requires macOS/Xcode.
- **Database:** Supabase Auth, Postgres and private document storage. `backend/supabase/001_initial.sql` is destructive and must only be used for fresh/disposable installs.
- **Web export dependencies:** Excel workbooks use a lazily loaded ExcelJS bundle; the web build requires development dependencies (including Vite and Sass). The ExcelJS UUID dependency is pinned to a patched compatible release.
- **Incremental schema:** `backend/supabase/002_service_enquiries.sql` adds structured service enquiry fields/history; `003_partner_vehicle_details.sql` adds per-vehicle partner application data; `004_service_pricing_history.sql` adds administrator attribution and append-only price/config history. No migration runner is exposed in the repository; have an authorized operator review and apply the migrations in order to a disposable database first, then the target database before deploying dependent API code.

## Configuration and operational dependencies

Hosting/provider environments (not source files) supply Supabase URL/service key/database URL/CA, frontend CORS origins, Razorpay keys/secrets, SMS provider/templates, SMTP, push/OneSignal, OTP HMAC secret, optional Redis, Maps keys, and platform signing. See `.env.example`, `backend/.env.example`, `render.yaml`, and `hostinger_deploy.md` for current repository configuration details. Never copy real values into this document or a tracked file.

## Safe release sequence

1. Run targeted tests, lint/type checks and production builds for changed projects.
2. Review web/API contract compatibility and mobile consumers; validate `002_service_enquiries.sql`, `003_partner_vehicle_details.sql`, and `004_service_pricing_history.sql` against a disposable copy.
3. Apply an approved additive migration before enabling dependent behavior; never execute the reset schema installer against existing data.
4. Configure provider secrets and restrictions in the hosting control plane, verify HTTPS/CORS/CSP, and preserve a rollback path.
5. Deploy API and web in a compatible order; confirm liveness/readiness and realtime scaling configuration.
6. Smoke-test customer/vendor/admin/dispatcher roles and required notification/payment/map flows in staging before production rollout.
7. Release signed mobile builds separately; validate the actual Admin App build against deployed endpoints and feature flags.

## Not verified

Current hosting state, DNS/SSL, production health, backups, environment values, CI runs, live Razorpay/SMS/email/push, real GPS, app-store builds, and deployment rollback were not accessed or changed.
