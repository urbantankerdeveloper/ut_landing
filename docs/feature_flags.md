# Feature flag plan

This is the rollout contract for the Urban Tanker meeting fixes. It is a
proposal only: Section 0 has not added a flag endpoint or changed application
behavior.

## Shared mechanism

- The backend will own one boolean map and expose it at `GET /api/config/flags`.
  The response contains public feature choices only; it must never include
  secrets or credentials.
- Backend environment variables will override code defaults, allowing the
  operator to change a flag without redeploying either client. A backend
  restart/redeploy may be needed when its host does not reload environment
  values dynamically.
- Web and Flutter will fetch this map and cache it briefly (target: 60 seconds).
  They will use the last fetched map during its cache lifetime and refresh it
  at startup/foreground. The clients must not treat a failed refresh as a
  successful flag change.
- Existing `GET /api/admin/feature-flags` is admin-authenticated and reads the
  database `configs` table. It is not a public runtime-configuration endpoint.
  The web `featureFlagStore` is local persisted state and is not a shared
  backend flag source.
- A false flag restores the current production behavior where the meeting
  request changes behavior. UI-only flags retain the existing screen as the
  fallback. Each server-side behavioral flag must also be enforced on the
  backend; hiding a client control alone is not enforcement.

## Planned flags

“On after validation” means the flag is to default to `true` when its feature
has passed the section's focused tests and end-to-end checks; until then the
current behavior remains active. Those rollout gates do not change the stated
target default.

| Flag | Target default | Scope |
| --- | --- | --- |
| `duplicate_phone_check_enabled` | `true` (after tests) | Reject use of an already verified phone during account phone verification. |
| `mpin_cooldown_enabled` | `true` | Keep a session locked during cooldown instead of signing out after failed MPIN attempts. |
| `multi_service_tasks_enabled` | `true` (after tests) | Create independent tasks grouped under one order. |
| `order_tracking_board_enabled` | `true` | Show status-grouped admin/vendor boards and customer progress. |
| `vendor_earnings_realtime_enabled` | `true` if a completion-time earnings change is needed | Refresh or create earnings data when delivery is completed. |
| `online_payment_enabled` | `true` after both platform checkouts are verified | Expose online checkout while retaining cash on delivery. |
| `manual_assignment_mode_enabled` | `false` | When enabled, stop automatic vendor broadcast and await admin assignment. |
| `admin_availability_toggle_enabled` | `true` | Expose online/active controls for vendors, vehicles, and drivers. |
| `admin_dashboard_v2_enabled` | `true` | Show the consolidated dashboard while retaining the existing dashboard path. |
| `area_availability_enabled` | `true` | Show availability grouped by service area. |
| `partner_application_otp_enabled` | `true` (after tests) | Require phone OTP verification before collecting/submitting the partner application. |
| `address_geocoding_enabled` | `true` after location validation | Resolve selected/current coordinates to a usable address label. |
| `invoice_generation_enabled` | `false` until trigger and invoice contents are agreed and verified | Generate and reconcile invoice records. |
| `wallet_enabled` | `false` | Keep wallet code/routes available but hide wallet UI and reject wallet operations. |

Purely visual web design work (brand palette and landing-page improvements)
does not need a flag.
