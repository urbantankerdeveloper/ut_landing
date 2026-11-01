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

## Booking service details

For an existing database, run `npm run db:update` in `backend/` before deploying the API. It applies the idempotent incremental blocks in `backend/supabase/001_initial.sql`, including the JSONB column that stores each service's details under the same booking record. Fresh installs get the same column from the full `001_initial.sql` installer.

Never run `npm run db:reset` against a database that holds data. It drops and recreates the `public` schema, and it refuses to run when `NODE_ENV=production`.

## Production deployment

The current topology is split: the frontend is served by Hostinger from `public_html`, and the API runs on Render. Hostinger is planned to host the full deployment later, so the API is configured only through environment variables and can move without code changes.

**Frontend (Hostinger, `public_html`)**

- Build with `npm ci` then `npm run build` (also available as `npm run build:hostinger`). Upload the contents of `dist/` to `public_html`, including the generated `.htaccess`.
- `.htaccess` (from `public/`) provides the single-page-app fallback for paths such as `/track/<token>`, the security headers, and the Content-Security-Policy. Its `connect-src` names the Render API origin; if the API origin changes, update `.htaccess` and `.env.production` together.
- `.env.production` points `VITE_API_BASE_URL` and `VITE_REALTIME_URL` at the Render origin. These values are compiled into the bundle, so rebuild after any change.
- The `public_html/` folder in the repository is the legacy design reference site. It is not part of the React build and is kept for later verification.

**API (Render, `render.yaml`)**

- The blueprint builds `backend/` with `npm ci && npm run build` and starts it with `npm start`. Health check: `GET /health` (process) and `GET /health/ready` (database).
- Secrets are entered in the Render dashboard (`sync: false` in `render.yaml`), never committed. Set `FRONTEND_ORIGIN` to the HTTPS Hostinger origin, and `CORS_ORIGINS` for any extra origin such as the `www` host.
- The server refuses to start in production when `FRONTEND_ORIGIN` is not HTTPS, when `USE_DEFAULT_VERIFICATION_CODE` is `true`, or when `SUPABASE_DB_URL` is set without `DB_SSL_CA`. Get the CA certificate from the Supabase dashboard and paste it into `DB_SSL_CA` with `\n` for line breaks.
- The refresh cookie is `SameSite=None; Secure` in production so it works across the Hostinger and Render origins. Browsers that block third-party cookies can still drop it. A same-site API subdomain (for example `api.<your-domain>` pointed at Render) removes that risk and is the recommended next step.
- Run one API instance. Socket.io uses the in-memory adapter, so realtime events do not cross instances. Background sweeps are guarded by a database advisory lock, but the realtime layer needs a Redis adapter before you scale out.
- Node 22 is pinned in `.nvmrc`, `engines`, and `render.yaml`.
- CI (`.github/workflows/ci.yml`) runs lint, tests, both builds, and a high-severity production audit for both packages.

## Customer email confirmation

All application email (registration confirmation, password reset, and notifications) is sent by the backend through Gmail SMTP. Configure `SMTP_USER` with the Gmail address and `SMTP_PASSWORD` with its Google app password. The defaults are `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, and `SMTP_SECURE=true`; set `MAIL_FROM` only if you use an address authorized by that Gmail account. Add `${FRONTEND_ORIGIN}/login` to the Supabase Auth redirect allow list.

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
