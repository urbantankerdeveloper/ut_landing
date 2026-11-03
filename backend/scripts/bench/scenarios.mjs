// Benchmark scenarios for the Urban Tanker API.
// Every scenario is read-only except the two login scenarios (they create a session row, not business data).
// Routes are mounted under /api, see src/server.ts. Paths and bodies must match the live routes.

const json = { 'content-type': 'application/json' }

export const SCENARIOS = [
  {
    name: 'login-email',
    needs: ['BENCH_CUSTOMER_EMAIL', 'BENCH_CUSTOMER_PASSWORD'],
    request: (env) => ({
      method: 'POST',
      path: '/api/auth/login',
      headers: { ...json, 'x-client-platform': 'mobile' },
      body: JSON.stringify({ email: env.BENCH_CUSTOMER_EMAIL, password: env.BENCH_CUSTOMER_PASSWORD }),
    }),
  },
  {
    name: 'login-username',
    needs: ['BENCH_CUSTOMER_USERNAME', 'BENCH_CUSTOMER_PASSWORD'],
    request: (env) => ({
      method: 'POST',
      path: '/api/auth/login',
      headers: { ...json, 'x-client-platform': 'mobile' },
      body: JSON.stringify({ username: env.BENCH_CUSTOMER_USERNAME, password: env.BENCH_CUSTOMER_PASSWORD }),
    }),
  },
  {
    name: 'customer-services',
    needs: [],
    request: () => ({ method: 'GET', path: '/api/customer/services' }),
  },
  {
    name: 'customer-orders',
    role: 'customer',
    needs: [],
    request: (_env, token) => ({ method: 'GET', path: '/api/customer/orders', headers: { authorization: `Bearer ${token}` } }),
  },
  {
    // Read-only quote. Do NOT point this at POST /api/customer/orders/quote: that route creates a booking.
    name: 'customer-quote-preview',
    role: 'customer',
    needs: ['BENCH_QUOTE_BODY'],
    request: (env, token) => ({
      method: 'POST',
      path: '/api/customer/orders/quote-preview',
      headers: { ...json, authorization: `Bearer ${token}` },
      body: env.BENCH_QUOTE_BODY,
    }),
  },
  {
    name: 'vendor-dashboard',
    role: 'vendor',
    needs: [],
    request: (_env, token) => ({ method: 'GET', path: '/api/vendor/dashboard', headers: { authorization: `Bearer ${token}` } }),
  },
  {
    name: 'admin-orders',
    role: 'admin',
    needs: [],
    request: (_env, token) => ({ method: 'GET', path: '/api/admin/orders?page=1&pageSize=25', headers: { authorization: `Bearer ${token}` } }),
  },
  {
    name: 'admin-vendors',
    role: 'admin',
    needs: [],
    request: (_env, token) => ({ method: 'GET', path: '/api/admin/vendors', headers: { authorization: `Bearer ${token}` } }),
  },
  {
    name: 'admin-customers',
    role: 'admin',
    needs: [],
    request: (_env, token) => ({ method: 'GET', path: '/api/admin/customers', headers: { authorization: `Bearer ${token}` } }),
  },
]
