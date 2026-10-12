# Urban Tanker React Architecture

## Executive summary
`ut_landing` is a React 19 + TypeScript + Vite SPA/PWA. The approved HTML in `../URBAN TANKER FINAL WEBSITE` remains read-only and is the visual reference. The new app preserves the shared shell while rendering screen content from Zustand state, so internal navigation never changes the browser URL.

## Source analysis
The source contains 54 screens across customer, vendor, admin, booking, authentication, policy and marketing journeys. Shared visual primitives are the `.site-header`, `.site-footer`, buttons, cards, form fields, service tiles, portal shells and admin dashboards. The home screen uses a photographic hero, teal aqua accent, ink text, pale paper background, Manrope body text, DM Mono labels and Playfair-style editorial emphasis. The source's primary tokens are `$ink #10343a`, `$aqua #007c91`, `$aqua-dark #005c6c`, `$paper #f5fbfc`, `$line #dce9e8`, `$mint #c7eadb`, `$yellow #f8ca63`, `$coral #d96250`, a 16-20px card radius and a soft teal shadow.

## Folder purposes
- `src/app`: persistent application shell composition.
- `src/components`: reusable header, footer and screen renderer.
- `src/screens`: screen-level UI modules; lazy loaded for fast startup.
- `src/stores`: client state, including URL-independent navigation.
- `src/api`: typed fetch client and endpoint contracts.
- `src/providers`: TanStack Query provider and cache policy.
- `src/theme`: SCSS design tokens.
- `src/styles`: global, shell, screen and responsive styles.
- `src/pwa`: service worker registration boundary.
- `src/layouts`, `pages`, `features`, `services`, `hooks`, `constants`, `models`, `types`, `assets`, `utils`: reserved module boundaries for the remaining source screen migrations.

## Navigation architecture
`navigationStore.ts` owns `activeScreen`, `previousScreen`, bounded history, `activeRole`, mobile menu state and navigation actions. `ScreenRenderer` maps registered screen IDs to lazy components, including the Customer, Vendor and Admin workspaces. Header and Footer are outside `ScreenRenderer`, so they remain mounted while content changes. Workspace navigation remains on `/` and never exposes role routes.

## Data architecture
TanStack Query owns server state, caching, background refresh and future mutations. Zustand owns local UI/session state only. `api/client.ts` centralizes credentials, timeout, cancellation and typed HTTP errors. Replace the placeholder endpoints with the existing backend contracts (`/api/orders`, `/api/services`, `/api/customer/subscriptions`, `/api/notifications`) as each source screen is migrated.

## PWA architecture
`public/manifest.json` provides install metadata. `public/service-worker.js` pre-caches the app shell and approved hero asset, uses cache-first reads for static GETs and falls back to the cached shell offline. Version the `CACHE` constant for releases. API mutations should later use an IndexedDB outbox and Background Sync rather than silently retrying non-idempotent requests.

## Zero-flicker and performance strategy
The shell is persistent, screens are lazy loaded, queries have a 60-second stale window, and the renderer supplies a stable loading surface. Next migrations should prefetch the likely next screen query, add skeletons inside each screen, and virtualize large admin tables. Avoid global store subscriptions in leaf components.

## Accessibility
The initial shell includes a labeled main nav, explicit button labels, native form controls, focus-visible outlines, responsive mobile navigation and reduced-motion handling. Remaining screens should add focus trapping for dialogs, error summaries, keyboard-complete menus, and automated axe coverage.

## Workflow implementation
The initial workspace slice models the shared cross-role lifecycle from the visual handoff: booking created, vendor assigned, en route, delivered. Customer, Vendor and Admin each receive role-specific metrics and quick actions while sharing the same workflow language. The action feedback is inline and preserves the mounted shell.

## Screen inventory and migration order
1. Home, services, booking and booking confirmation.
2. Authentication and customer account screens.
3. Subscriptions, yearly contracts, invoices, wallet and support.
4. Vendor overview, orders, vehicles, drivers and earnings.
5. Admin overview, orders, live operations, finance, reports and settings.

## Testing strategy
Use Vitest for stores and API mapping, React Testing Library for components and forms, MSW for API contracts, axe for accessibility, and Playwright for the critical booking and internal-navigation journeys. The required baseline commands are `npm run lint` and `npm run build`.

## Production readiness review
The shell and initial customer journey are production-shaped and build successfully. Authentication, real backend wiring, IndexedDB mutation queues, full source-screen migration, CSP/security headers and automated tests remain follow-up work before production release.
