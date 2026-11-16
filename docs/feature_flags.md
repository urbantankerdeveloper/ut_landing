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

## Section 2 runtime checks

- `multi_service_tasks_enabled` is checked by
  `backend/src/routes/customer.ts` for task creation, customer order reads, and
  order payment/cancellation paths; by `backend/src/routes/payments.ts` for
  grouped checkout; and by `backend/src/routes/vendor.ts` for vendor task
  metadata. The grouped insert/cancel RPCs and additive schema are in
  `backend/supabase/002_multi_service_tasks.sql`. Apply and verify that
  migration before enabling the flag in any environment.
- Web reads the cached public flags through `src/hooks/useFeatureFlags.ts`.
  The task-count confirmation is checked in `src/screens/BookingScreen.tsx`;
  grouped customer tasks/progress in `CustomerBookingsTable.tsx`;
  administrator status board in `AdminBookingOperationsScreen.tsx`; and the
  vendor board in `VendorOrderPanel.tsx`.
- Flutter stores the map in `lib/app/app_controller.dart`. The task-count
  confirmation and grouped customer booking views read the controller's
  `multiServiceTasksEnabled` getter; customer progress, admin board, and vendor
  board read `orderTrackingBoardEnabled` in their corresponding booking,
  admin-orders, and vendor-operations screens.

## Planned flags

“Target default” is applied only once the related section passes its focused
tests and any required end-to-end checks.

| Flag | Runtime default now | Target default | Scope |
| --- | --- | --- | --- |
| `duplicate_phone_check_enabled` | `true` | `true` | Reject use of an already verified phone during account phone verification. |
| `mpin_cooldown_enabled` | `true` | `true` | Keep a session locked during cooldown instead of signing out after failed MPIN attempts. |
| `multi_service_tasks_enabled` | `false` | `true` after tests | Create independent tasks grouped under one order. |
| `order_tracking_board_enabled` | `true` | `true` | Show status-grouped admin/vendor boards and customer progress. |
| `vendor_earnings_realtime_enabled` | `true` | `true` | Show unsettled delivery accruals at the 85% default share in vendor earnings; it is not payable until admin settlement. |
| `online_payment_enabled` | `false` | `true` after both platform checkouts are verified | Expose online checkout while retaining cash on delivery. |
| `manual_assignment_mode_enabled` | `false` | `false` | When enabled, stop automatic vendor broadcast and await admin assignment. |
| `admin_availability_toggle_enabled` | `false` | `true` | Expose online/active controls for vendors, vehicles, and drivers. |
| `admin_dashboard_v2_enabled` | `false` | `true` | Show the consolidated dashboard while retaining the existing dashboard path. |
| `area_availability_enabled` | `false` | `true` | Show availability grouped by service area. |
| `partner_application_otp_enabled` | `false` | `true` after tests | Require phone OTP verification before collecting/submitting the partner application. |
| `address_geocoding_enabled` | `false` | `true` after location validation | Resolve selected/current coordinates to a usable address label. |
| `invoice_generation_enabled` | `false` | `false` until trigger and invoice contents are agreed and verified | Generate and reconcile invoice records. |
| `wallet_enabled` | `false` | `false` | Keep wallet code/routes available but hide wallet UI and reject wallet operations. |

`vendor_earnings_realtime_enabled` is checked by the backend
`GET /vendor/earnings/accrued` route and the delivery-event fan-out, and by the
React `VendorPayoutPanel`/`VendorManagementPanel` and Flutter
`VendorEarningsScreen`. Accruals include
only delivered bookings without `settled_payout_id`; they are derived from the
quoted amount at the 85% default rate, while payout requests remain limited to
settled payout records. An admin settlement using a custom share rate can
produce a different final payout amount.

`online_payment_enabled` is checked by the backend booking, Razorpay-order, and
COD-to-online-switch routes; the web `BookingScreen` and `CustomerBookingsTable`;
and the Flutter booking payment selector and booking-details action. It remains
off until checkout is verified end to end on both platforms. COD remains
available, and payment verification/webhook handling stays enabled for
payments already in flight.

Purely visual web design work (brand palette and landing-page improvements)
does not need a flag.
