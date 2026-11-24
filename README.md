# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Local Design Comparison

Run the React application and the supplied HTML references in separate terminals:

```powershell
npm run dev
npm run reference
```

The React app is available at `http://localhost:5173/` and the reference site is available at `http://localhost:4174/`. The reference server serves the original `public_html` tree, so pages retain their relative links and assets; for example, open `http://localhost:4174/account.html` or `http://localhost:4174/admin.html` directly.

List every supplied HTML page URL with:

```powershell
npm run reference:list
```

The reference server intentionally fails when port `4174` is occupied instead of switching ports silently.

## Database setup

The canonical install, including security hardening, is `backend/supabase/001_initial.sql`. `npm run db:reset` in `backend/` applies it by dropping and recreating the `public` schema; application data is deleted, while Supabase-managed authentication data is preserved. Use it only for a disposable/test database. The reset script requires `NODE_ENV=test`, an explicitly allowed project ref, and `CONFIRM_DATABASE_RESET=URBAN_TANKER_RESET`.

There is no incremental database update command. Do not run the reset against an existing database whose data must be retained.

## Production deployment

The frontend is served by Hostinger from `public_html`, and the backend API is available at `https://api.urbantanker.in`. Both web and Flutter clients use this API origin by default; their configuration supports switching back to Render if rollback is needed.

**Frontend (Hostinger, `public_html`)**

- Build with `npm ci` then `npm run build` (also available as `npm run build:hostinger`). Upload the contents of `dist/` to `public_html`, including the generated `.htaccess`.
- `.htaccess` (from `public/`) provides the single-page-app fallback for paths such as `/track/<token>`, security headers, and the Content-Security-Policy. Its `connect-src` API and WebSocket origins are generated from `VITE_API_BASE_URL`.
- `.env.production` sets `VITE_API_BASE_URL=https://api.urbantanker.in`. The web app derives both its `/api` HTTP base and Socket.IO origin from this value. Rebuild after changing it.
- To roll the web app back to Render, set `VITE_API_BASE_URL=https://urban-tanker-backend.onrender.com` and rebuild.
- The `public_html/` folder in the repository is the legacy design reference site. It is not part of the React build and is kept for later verification.

**API (Hostinger Node.js, `api.urbantanker.in`)**

- Deploy the backend package described in [Hostinger deploy](#hostinger-deploy). Health check: `GET /health` (process) and `GET /health/ready` (database).
- Set `FRONTEND_ORIGIN=https://www.urbantanker.in` and include the apex website origin `https://urbantanker.in` in `CORS_ORIGINS`. `FRONTEND_ORIGIN` is also used to generate public tracking links, so keep it on the website domain, not the API host.
- Enter production secrets in hPanel only; never commit them. The Render blueprint and manual-deploy workflow remain available as legacy rollback infrastructure.
- The server refuses to start in production when `FRONTEND_ORIGIN` is not HTTPS, when `USE_DEFAULT_VERIFICATION_CODE` is `true`, or when `SUPABASE_DB_URL` is set without `DB_SSL_CA`. Get the CA certificate from the Supabase dashboard and paste it into `DB_SSL_CA` with `\n` for line breaks.
- The refresh cookie is `SameSite=None; Secure` in production so it works across the website and API subdomain.
- Scale out only when load needs it. Each API instance must set the same `REDIS_URL`, which shares Socket.io rooms and rate limits across instances. Without it the API runs as one instance, and the server logs a `scaling.single_instance` warning in production. Background sweeps are guarded by a database advisory lock, so they run on one instance per cycle.
- Socket.io clients fall back to HTTP long-polling, and polling needs sticky sessions at the load balancer. Either enable sticky sessions, or set the client to WebSocket-only transport before running more than one instance.
- Node 22 is pinned in `.nvmrc`, `engines`, and the deployment configuration.
- CI (`.github/workflows/ci.yml`) runs lint, tests, both builds, and a high-severity production audit for both packages.

## Hostinger deploy

The backend can run as a Node.js application on Hostinger LiteSpeed. Create the upload archive from the repository root with `npm run package:hostinger --prefix backend`; it contains `package.json`, `package-lock.json`, and `dist/` at the archive root.

In hPanel, configure the Node.js application to use Node 22, set its application root to the extracted package directory, and set **Entry file** to `dist/server.cjs`. Install production dependencies from that directory with:

```sh
npm ci --omit=dev
```

Set the backend environment variables in the hPanel application settings. Use `backend/.env.example` as the variable reference, supply production credentials through hPanel only, and do not upload `.env` files or commit secrets. Set the port as required by the hPanel Node.js application environment.

## Maps

Google Maps is the primary web map when `VITE_GOOGLE_MAPS_API_KEY` is
configured. Leaflet/OpenStreetMap is used if the key is missing or Google Maps
fails to load. Set the key as a GitHub Actions secret for manual deploys or in
ignored `.env.local` for local work. Restrict this public client key to
approved HTTP referrers and the Maps JavaScript API. The Flutter app also uses
Google Maps first with OpenStreetMap fallback; its native key setup is
documented in `../urban_tanker_app/README.md`.

## Customer email confirmation

All application email (registration confirmation, password reset, and notifications) is sent by the backend. Local development defaults to SMTP, so existing Gmail settings continue to work even if a Resend key is present. On Render, set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, and a `MAIL_FROM` address on a domain verified with Resend; the HTTPS API avoids relying on direct SMTP. To explicitly use SMTP, set `EMAIL_PROVIDER=smtp`, configure `SMTP_USER` with the Gmail address and `SMTP_PASSWORD` with its Google app password. The defaults are `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, and `SMTP_SECURE=true`; set `MAIL_FROM` only to an address authorized by the configured provider. Add `${FRONTEND_ORIGIN}/login` to the Supabase Auth redirect allow list.

## Registration phone OTP

Phone OTP delivery tries the configured Combirds WhatsApp campaign first, then uses MSG91 SMS when the fallback is enabled. For Render, set the relevant Combirds API key, campaign name, and user name, or configure `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID_USER_REGISTRATION_OTP`. The `user_registration_otp` row in Supabase `sms_templates` must be active and include the `{{otp}}` placeholder; its stored MSG91 template ID takes precedence over the environment variable.

## Booking phone verification fallback

Guest booking verification uses SMS by default. Until the SMS provider is configured, set these variables in the backend environment:

```env
USE_DEFAULT_VERIFICATION_CODE=true
DEFAULT_VERIFICATION_CODE=123456
```

When `USE_DEFAULT_VERIFICATION_CODE` is `true`, SMS delivery is skipped and the configured six-digit code is used. Leave it unset or set it to `false` to use the normal random OTP and SMS delivery flow.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://npmx.dev/package/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://npmx.dev/package/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
