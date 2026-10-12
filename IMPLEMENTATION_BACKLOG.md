# Urban Tanker 33-Item Implementation Backlog

Execution order: Customer -> Vendor -> Admin -> Shared.

Status meanings: `DONE` means implemented in the frontend foundation; `IN PROGRESS` means partially wired; `PENDING` means it needs implementation or external service configuration.

## Customer

1. `IN PROGRESS` Real customer authentication and role restoration. Use Supabase Auth sessions and refresh-token recovery.
2. `IN PROGRESS` Multi-service booking wizard. The UI supports multiple services and review/payment steps; backend persistence is wired through `/orders`.
3. `IN PROGRESS` Payment checkout and verification. Frontend payment order/verification hooks exist; Razorpay widget and server signature verification remain.
4. `IN PROGRESS` Live tracking and geolocation. Tracking query/polling exists; map rendering and vendor location streaming remain.
5. `PENDING` Booking lifecycle mutations. Add reschedule, cancellation, OTP confirmation, delivery proof, and rating mutations.
6. `IN PROGRESS` Customer account data. Profile, addresses, subscriptions, invoices, and support query hooks exist; remaining screens need mutation wiring.
7. `IN PROGRESS` Wallet, invoices, membership, contracts, and offers. UI exists; top-up, quotation, coupon validation, and persistence need backend wiring.
8. `PENDING` Customer notification center. Add realtime/push delivery, read state persistence, and notification preferences.

## Vendor

9. `IN PROGRESS` Vendor authentication and dashboard API. Vendor endpoints and role checks exist; production profile data and permissions need completion.
10. `IN PROGRESS` Nearby order inbox. Query, radius filter, optimistic accept/reject, loading, retry, and offline queue support exist.
11. `PENDING` Vendor assignment mutations. Persist vehicle/driver assignment and reassignment through Supabase transactions.
12. `IN PROGRESS` Delivery lifecycle. Accepted, en route, arrived, and delivered UI exists; server-side transition rules and realtime updates remain.
13. `IN PROGRESS` OTP and proof flow. UI validation exists; secure server verification and storage upload progress/retry remain.
14. `IN PROGRESS` Fleet, driver, service, and attendance management. Forms and panels exist; API persistence, document expiry, and approval workflows remain.
15. `IN PROGRESS` Earnings, payout, complaints, and notifications. UI and endpoint adapters exist partially; live query/mutation integration remains.
16. `IN PROGRESS` Vendor offline synchronization. Local queue and reconnect flush exist for order mutations; extend to all mutations with conflict handling.

## Admin

17. `IN PROGRESS` Admin authentication, role permissions, and workspace restoration. Auth middleware and role guards exist; permission-level controls remain.
18. `IN PROGRESS` Admin live dispatch board. UI and assignment dialog exist; realtime order/vendor/vehicle data and reassignment persistence remain.
19. `IN PROGRESS` Booking/order operations. Admin table and detail actions exist; status, assignment, cancellation, and audit mutations remain.
20. `IN PROGRESS` Vendor, driver, vehicle, and customer CRUD. Frontend CRUD surfaces and API adapters exist partially; connect all mutations and approvals.
21. `IN PROGRESS` Service catalogue and dynamic pricing. Pricing form exists; pricing rules, validation, effective dates, and customer quotation integration remain.
22. `IN PROGRESS` Coupons, subscriptions, and yearly contracts. Coupon CRUD UI exists; subscription plan and contract APIs remain.
23. `IN PROGRESS` Finance, payments, refunds, and vendor payouts. Metrics and dialogs exist; reconciliation, refund, payout, and webhook integration remain.
24. `IN PROGRESS` Reports, complaints, enquiries, alerts, and audit logs. Report UI/PDF/CSV and alert surfaces exist; live data and audit persistence remain.

## Shared Platform

25. `IN PROGRESS` Supabase database and Row Level Security. Initial migration and policies exist; production review and complete policy coverage remain.
26. `IN PROGRESS` Express API foundation. Auth, Customer, Vendor, and Admin routes exist; complete domain route coverage remains.
27. `IN PROGRESS` API reliability. Typed client, auth headers, refresh retry, query caching, and error boundaries exist; consistent retry/error telemetry remains.
28. `IN PROGRESS` Realtime WebSocket integration. Reconnect-capable client exists; mount it into Vendor/Admin/Customer query invalidation and event handlers.
29. `IN PROGRESS` File storage. Photo/proof fields exist in UI; Supabase Storage signed uploads, progress, cancellation, and cleanup remain.
30. `IN PROGRESS` Email, SMS OTP, WhatsApp, and reminder delivery. Backend configuration placeholders exist; provider adapters, templates, queues, and retry policies remain.
31. `IN PROGRESS` PWA/offline/background sync. Service worker, cache versioning, and vendor mutation queue exist; IndexedDB outbox and Background Sync remain.
32. `PENDING` Automated quality gates. Add Vitest unit tests, React component tests, MSW API tests, axe accessibility tests, and Playwright E2E flows.
33. `PENDING` Production operations. Add analytics provider, audit telemetry, CSP/security headers, observability, bundle splitting, Sass `@use` migration, deployment checks, and runbooks.

## Completion Rule

An item is complete only when its UI behavior, API contract, loading/error/empty states, permissions, tests, and deployment configuration are verified. External credentials and Supabase project configuration must be supplied before provider-dependent items can be marked complete.
