# Feature flag plan

This is the rollout contract for the Urban Tanker meeting fixes. The backend
owns the runtime flag map; flags for sections not yet implemented remain off
until those sections pass focused validation.

## Shared mechanism

- The backend exposes the public boolean map at `GET /api/config/flags`; it
  contains no secrets or credentials.
- `FEATURE_FLAGS_JSON` accepts strict JSON boolean overrides for known flags.
  Invalid JSON, unknown names, or non-boolean values prevent startup rather
  than silently ignoring an operator's setting. For example:
  `FEATURE_FLAGS_JSON={"duplicate_phone_check_enabled":false}`.
- Web loads the map through the shared React Query cache (60 seconds) and
  refreshes when the window regains focus. Flutter loads it at startup and
  foreground, with a 60-second HTTP cache. A failed refresh does not change
  the last known/default value.
- Existing `GET /api/admin/feature-flags` is admin-authenticated and reads the
  database `configs` table. It is not a public runtime-configuration endpoint.
  The web `featureFlagStore` is local persisted state and is not a shared
  backend flag source.
- A false flag restores the current production behavior where the meeting
  request changes behavior. UI-only flags retain the existing screen as the
  fallback. Each server-side behavioral flag must also be enforced on the
  backend; hiding a client control alone is not enforcement.

## Section 1 runtime checks

- `duplicate_phone_check_enabled` is enforced in
  `backend/src/routes/auth.ts` while completing the email-plus-phone
  registration verification. The existing verified-phone unique index remains
  the race-condition backstop, so this section adds no duplicate index.
  Booking-contact OTP does not update a profile phone and is intentionally
  unaffected.
- `mpin_cooldown_enabled` is checked by
  `urban_tanker_app/lib/app/app_controller.dart` in `unlockWithMpin`.
- The React app fetches the map through `src/api/config.ts` and the Flutter app
  fetches it through `AuthApi.featureFlags`; both refresh on foreground/startup
  and cache for 60 seconds.

## Planned flags

“Target default” is applied only once the related section passes its focused
tests and any required end-to-end checks.

| Flag | Runtime default now | Target default | Scope |
| --- | --- | --- | --- |
| `duplicate_phone_check_enabled` | `true` | `true` | Reject use of an already verified phone during account phone verification. |
| `mpin_cooldown_enabled` | `true` | `true` | Keep a session locked during cooldown instead of signing out after failed MPIN attempts. |
| `multi_service_tasks_enabled` | `false` | `true` after tests | Create independent tasks grouped under one order. |
| `order_tracking_board_enabled` | `false` | `true` | Show status-grouped admin/vendor boards and customer progress. |
| `vendor_earnings_realtime_enabled` | `false` | `true` if a completion-time earnings change is needed | Refresh or create earnings data when delivery is completed. |
| `online_payment_enabled` | `false` | `true` after both platform checkouts are verified | Expose online checkout while retaining cash on delivery. |
| `manual_assignment_mode_enabled` | `false` | `false` | When enabled, stop automatic vendor broadcast and await admin assignment. |
| `admin_availability_toggle_enabled` | `false` | `true` | Expose online/active controls for vendors, vehicles, and drivers. |
| `admin_dashboard_v2_enabled` | `false` | `true` | Show the consolidated dashboard while retaining the existing dashboard path. |
| `area_availability_enabled` | `false` | `true` | Show availability grouped by service area. |
| `partner_application_otp_enabled` | `false` | `true` after tests | Require phone OTP verification before collecting/submitting the partner application. |
| `address_geocoding_enabled` | `false` | `true` after location validation | Resolve selected/current coordinates to a usable address label. |
| `invoice_generation_enabled` | `false` | `false` until trigger and invoice contents are agreed and verified | Generate and reconcile invoice records. |
| `wallet_enabled` | `false` | `false` | Keep wallet code/routes available but hide wallet UI and reject wallet operations. |

Purely visual web design work (brand palette and landing-page improvements)
does not need a flag.
