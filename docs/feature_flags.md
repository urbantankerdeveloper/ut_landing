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
- `manual_assignment_mode_enabled` is resolved by
  `backend/src/services/manualAssignmentMode.ts`; a saved boolean in
  `configs` overrides the environment default. Booking creation checks it in
  `backend/src/routes/customer.ts`; the admin setting is exposed through
  `/admin/dispatch-settings` and reflected in the public runtime flags.
- `admin_availability_toggle_enabled` gates the added independent vehicle and
  driver availability actions in `src/screens/AdminEntityManagerLive.tsx` and
  the new vendor-online/vehicle-active/driver-active controls in
  `urban_tanker_app/lib/screens/admin/operations/people_section.dart`.
  Existing approval actions remain available when this flag is off. The
  pre-existing web vendor online control is retained regardless of the flag.
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

## Section 8 runtime checks

- `address_geocoding_enabled` defaults to `true` and is returned through the
  public `GET /api/config/flags` endpoint. Set it to `false` through
  `FEATURE_FLAGS_JSON` to restore the previous approximate web lookup and
  coordinate-only Flutter selection.
- Web checks the flag in `src/screens/BookingScreen.tsx`,
  `src/components/LocationPickerModal.tsx`, and
  `src/components/DeliveryLocationChip.tsx`. When enabled, these use the
  existing Google Maps JavaScript API key and return the full formatted
  address; when disabled, booking lookup continues using Nominatim.
- Flutter checks the flag in `lib/app/app_controller.dart` and
  `lib/screens/home/booking/booking_fields.dart`. When enabled, map and current
  location selections resolve through the Google Geocoding API using the
  existing `GOOGLE_MAPS_API_KEY` build value. A lookup failure is surfaced and
  the address can still be entered manually.
- Both Google API keys must have Geocoding API access enabled and their
  restrictions must permit the corresponding web/mobile requests.

## Section 9 runtime checks

- `invoice_generation_enabled` defaults to `false`. The backend stores an
  itemized pricing snapshot in each new booking's `service_details` when the
  flag is enabled, then `backend/src/services/invoices.ts` creates one invoice
  per task only after delivery and payment are both confirmed. Vendor delivery
  transitions, admin delivery transitions, Razorpay verify, and the Razorpay
  webhook invoke the idempotent generator. COD is treated as cash-confirmed at
  delivery, as agreed; wallet bookings are treated as paid when their booking
  debit succeeds. Customer invoice history retries missing invoices if a
  completion/payment event could not persist one. Refund updates synchronize
  the invoice payment status.
- For multi-task orders, each invoice contains that task's allocated quote;
  the shared Razorpay payment is checked against the sum of all task quotes.
  Existing bookings without a quote-time snapshot are not backfilled because
  the original service price/tax/discount breakdown is unavailable.
- Apply `backend/supabase/003_invoice_generation.sql` before enabling the
  flag. The React invoice normalizer and PDF in `src/utils/customerData.ts` and
  `src/utils/pdf.ts`, and the Flutter invoice list/detail in
  `urban_tanker_app/lib/models/account.dart` and
  `urban_tanker_app/lib/screens/invoice_detail_screen.dart`, render itemized
  line amounts and totals.

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
| `admin_availability_toggle_enabled` | `true` | `true` | Expose independent online/active controls for vendors, vehicles, and drivers; existing web vendor online control remains available when off. |
| `admin_dashboard_v2_enabled` | `true` | `true` | Show the consolidated dashboard while retaining the existing dashboard path. |
| `area_availability_enabled` | `true` | `true` | Show availability grouped by service area. |
| `partner_application_otp_enabled` | `true` | `true` | Require phone OTP before collecting/submitting partner applications and allow verified applicants to upload documents without login. |
| `address_geocoding_enabled` | `true` | `true` | Resolve selected/current coordinates to a full formatted address. |
| `invoice_generation_enabled` | `false` | `false` until migration and end-to-end invoice checks are complete | Generate one itemized invoice per task after delivery and payment confirmation. |
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

`wallet_enabled` defaults to `false`. The backend gates customer wallet reads and
top-up routes in `backend/src/routes/customerExtended.ts` and rejects wallet
booking debits in `backend/src/routes/customer.ts`. The web workspace navigation,
wallet panel, and booking selector check the public flag; Flutter's customer
account and booking selector check the same flag. Razorpay webhook settlement
for wallet top-ups already in flight is intentionally left enabled.

Purely visual web design work (brand palette and landing-page improvements)
does not need a flag.

`manual_assignment_mode_enabled` defaults to `false` (automatic broadcast).
The admin can persistently switch it through `/admin/dispatch-settings`;
`configs.manual_assignment_mode_enabled`, when present, overrides the
environment default. The web switch is in
`src/screens/AdminBookingOperationsScreen.tsx`; Flutter's switch is in
`urban_tanker_app/lib/screens/admin/operations/orders_section.dart`. Both use
the existing admin-only settings API. New bookings only skip vendor broadcast
when the resolved setting is `true`. Once an admin assigns an order,
`backend/src/routes/adminExtended.ts` sends `booking.updated` to both the
customer and assigned vendor rooms so their order lists refresh immediately.

`admin_dashboard_v2_enabled` gates the admin summary API at
`backend/src/routes/adminExtended.ts`, the web overview at
`src/screens/WorkspaceContent.tsx`, and the Flutter additions to
`urban_tanker_app/lib/screens/admin/admin_pulse_screen.dart`. Turning it off
restores the previous dashboard experience. The summary groups active orders
by their existing statuses, counts submitted/in-review partner applications,
approved online vendors, approved active drivers, open dispatcher alerts, and
failed payment rows. Today's revenue is the sum of payments captured during
the current India-local day; stale orders are active bookings unchanged for
more than two hours.

`area_availability_enabled` gates
`GET /admin/availability-by-area` in `backend/src/routes/adminExtended.ts`, and
the area sections in the web and Flutter dashboards. Vehicles and drivers are
grouped through their owning vendor's `service_zone`. That column is free text,
not a canonical service-area identifier, so grouping trims whitespace and
merges case-only variants; production values should be standardized before
relying on area totals for dispatch decisions. Counts include only approved
resources explicitly marked online/active. The schema has no driver online
field, so the dashboard labels drivers as active rather than online.

`partner_application_otp_enabled` uses the existing guest challenge mechanism
through `POST /auth/partner/request-otp` and `POST /auth/partner/verify-otp`;
the backend requires a fresh, matching challenge in `POST /partner/applications`
and `POST /partner/documents/signed-url`.
The React `PartnerApplicationScreen` checks the flag before exposing the
application fields and uses the public upload route only after phone
verification. Admin downloads are served by the admin-only
`GET /admin/partner-applications/:id/documents` endpoint and the Flutter
Partners tab. Turning the flag off restores the prior application form and
disables the partner-specific anonymous upload route.
