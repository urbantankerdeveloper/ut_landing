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

For an existing database, apply `backend/supabase/012_booking_service_details.sql` before deploying the API. It adds the JSONB column that stores each service's details under the same booking record. Fresh installs also receive the column from `backend/supabase/001_initial.sql`.

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
