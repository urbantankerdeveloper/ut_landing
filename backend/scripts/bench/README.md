# API benchmarks

Repeatable load scenarios for the Urban Tanker API, built on [autocannon](https://github.com/mcollina/autocannon).
They exist to produce the before/after numbers in `docs/performance_baseline.md` and `docs/performance_report.md`.

## Rules

- Run only against a **local or staging** instance with **seeded, non-production** data. The runner refuses non-local hosts unless `BENCH_ALLOW_REMOTE=true` is set.
- `customer-quote-preview` must target `POST /api/customer/orders/quote-preview`. Do **not** point it at `POST /api/customer/orders/quote`: that route places a booking and writes a coupon redemption.
- Login scenarios create sessions. Per-account login limits (`src/routes/auth.ts`) will return HTTP 429 quickly under load. The non-2xx column counts those, so read login numbers together with the error rate.
- Results go to `scripts/bench/results/` (git-ignored). Copy the summary into the docs, not the raw files.

## Run

```bash
cd backend
BENCH_BASE_URL=http://127.0.0.1:4000 \
BENCH_LABEL=baseline \
BENCH_CONNECTIONS=10 \
BENCH_DURATION=20 \
BENCH_CUSTOMER_EMAIL=... BENCH_CUSTOMER_PASSWORD=... BENCH_CUSTOMER_USERNAME=... \
BENCH_VENDOR_EMAIL=... BENCH_VENDOR_PASSWORD=... \
BENCH_ADMIN_EMAIL=... BENCH_ADMIN_PASSWORD=... \
BENCH_QUOTE_BODY='{"services":[{"serviceId":"<code>","capacity":"10000L","deliveryDate":"2030-01-01"}],"location":"Test address","paymentMethod":"cod"}' \
npm run bench

# only some scenarios
npm run bench -- --only=customer-orders,admin-orders
```

Credentials are read from the environment and are never printed. Role tokens are obtained by logging in once per role at the start of the run.

## Scenarios

| Scenario | Request | Needs |
|---|---|---|
| `login-email` | `POST /api/auth/login` with email | customer email + password |
| `login-username` | `POST /api/auth/login` with username | customer username + password |
| `customer-services` | `GET /api/customer/services` | none (public) |
| `customer-orders` | `GET /api/customer/orders` | customer login |
| `customer-quote-preview` | `POST /api/customer/orders/quote-preview` | customer login + `BENCH_QUOTE_BODY` |
| `vendor-dashboard` | `GET /api/vendor/dashboard` | vendor login |
| `admin-orders` | `GET /api/admin/orders?page=1&pageSize=25` | admin login |
| `admin-vendors` | `GET /api/admin/vendors` | admin login |
| `admin-customers` | `GET /api/admin/customers` | admin login |

A scenario whose inputs are missing is listed as skipped, not guessed.

## Output

Each run prints a Markdown table and writes `results/<label>-<timestamp>.json` with: RPS, average, p50, p97.5, p99 latency (ms), non-2xx count, socket errors, timeouts, error rate, and bytes per response.

Notes:
- autocannon 8 reports p50, p97.5 and p99 but not p95. p97.5 is reported as the upper-tail column. If p95 is required, it must come from server-side timing (Phase 1 adds `Server-Timing`).
- DB calls per request cannot be measured from the client. Phase 1 adds a server-side counter; until then the baseline reports client-side numbers only.
