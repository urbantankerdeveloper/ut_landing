# Hostinger backend deployment

## Confirmed application details

- The backend uses Express, declared directly in `backend/package.json`.
- `npm run build` runs `tsc -p tsconfig.build.json`; TypeScript emits `backend/dist/server.js`.
- The Hostinger ZIP overrides `build` to verify its prebuilt `dist/server.js`, since the archive intentionally excludes the TypeScript compiler configuration.
- `npm start` runs the compiled database check and then starts `node dist/server.js`.
- The existing `engines.node` range is `>=22`; select Node.js 22 in hPanel.
- The server reads `PORT` from the environment, with its existing default if the host does not supply one.
- `package-lock.json` is present and its root dependency metadata matches `package.json`.

## hPanel application settings

Use Business Web Hosting or a Cloud Startup, Professional, or Enterprise plan. Node.js applications are not available on basic shared hosting.

| Field | Value |
|---|---|
| Application type | `express` |
| Node.js version | `22` |
| Build script | `npm run build` (verifies the prebuilt `dist/server.js`) |
| Output directory | `dist` |
| Entry file | `server.cjs` (relative to the `dist` output directory) |
| Start command, if requested | `npm start` |

The compiled ESM server is stored as `dist/server.js`. The archive also includes `dist/server.cjs`, a CommonJS bootstrap that dynamically imports the ESM server so Hostinger's `require()`-based loader can start the app despite the server's top-level `await`. With `dist` configured as the output directory, hPanel resolves the entry file relative to that directory, so set it to `server.cjs` (not `dist/server.cjs`, which would resolve as `dist/dist/server.cjs`). The ZIP has `package.json` at its root, with `express` listed directly under `dependencies`. Upload the ZIP itself, not a ZIP containing an extra enclosing project folder. Hostinger can install dependencies from the included `package.json` and `package-lock.json`; `node_modules` is intentionally excluded.

## Build and upload

From the backend directory, run:

```powershell
npm run package:hostinger
```

The script runs the build, stages only the manifests and filtered `dist/` output, and creates:

```text
backend/hostinger-upload.zip
```

Upload that ZIP through the Node.js Web App in hPanel. The script excludes `.git`, `node_modules`, environment files, and test files.
The staged archive includes `.npmrc` with `omit=dev`; hPanel should install with `npm ci --omit=dev` (or confirm `.npmrc` is honored). Do not install TypeScript or test dependencies in production.

## Runtime environment variables

Enter values in hPanel's environment-variable settings; never put real credentials in the ZIP. Names below come from the backend runtime configuration schema.

Required in production:

- `NODE_ENV`
- `SUPABASE_URL`
- One of `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`
- `OTP_HMAC_SECRET`

Other supported variables (set the ones needed by the enabled integrations):

- Core and database: `PORT`, `LOG_LEVEL`, `FRONTEND_ORIGIN`, `CORS_ORIGINS`, `SUPABASE_DB_URL`, `DB_SSL_CA`, `DB_POOL_MAX`, `REDIS_URL`
- Email and SMS: `EMAIL_PROVIDER`, `RESEND_API_KEY`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `SMS_PROVIDER`, `COMBIRDS_WABA_API_KEY`, `COMBIRDS_WABA_CAMPAIGN_NAME`, `COMBIRDS_CAMPAIGN_USER_NAME`, `COMBIRDS_CAMPAIGN_USER_REGISTRATION_OTP`, `COMBIRDS_CAMPAIGN_BOOKING_VERIFICATION_OTP`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID_USER_REGISTRATION_OTP`, `MSG91_TEMPLATE_ID_BOOKING_VERIFICATION_OTP`, `MSG91_TEMPLATE_ID_GUEST_BOOKING_CONFIRMATION`, `MSG91_TEMPLATE_ID_VENDOR_ACCEPTANCE`, `MSG91_TEMPLATE_ID_DELIVERY_CONFIRMATION`, `MSG91_TEMPLATE_ID_DELIVERY_OTP`, `MSG91_TEMPLATE_ID_COD_SWITCHED_TO_ONLINE`, `MSG91_TEMPLATE_ID_COD_REVERTED_TO_CASH`
- Payments and notifications: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`
- Verification, analytics, and tuning: `USE_DEFAULT_VERIFICATION_CODE`, `REQUIRE_BOOKING_PHONE_VERIFICATION`, `DEFAULT_VERIFICATION_CODE`, `ANALYTICS_RETENTION_DAYS`, `ANALYTICS_ANONYMIZE_AFTER_DAYS`, `HTTP_KEEP_ALIVE_TIMEOUT_MS`, `HTTP_HEADERS_TIMEOUT_MS`, `HTTP_REQUEST_TIMEOUT_MS`, `SLOW_REQUEST_MS`, `CATALOG_CACHE_TTL_SECONDS`, `APPLIED_GST_PERCENTAGE`, `TEST_PRICING_ENABLED`

When `SUPABASE_DB_URL` is set in production, also configure `DB_SSL_CA` so the database certificate is verified. Production also requires `FRONTEND_ORIGIN` to use HTTPS; `OTP_HMAC_SECRET` must be at least 32 characters. Keep `USE_DEFAULT_VERIFICATION_CODE` and `TEST_PRICING_ENABLED` disabled in production. If configured, `REDIS_URL` must use TLS.

## Idle restart and realtime behavior

Hostinger may stop an application after a period without traffic and start it again on the next request. Since this backend also runs Socket.IO for live booking and vendor notifications, test the cold-start delay and the first realtime event after a quiet period once deployed. No keep-alive ping is included in this packaging change. Would you like a lightweight keep-alive added later?
