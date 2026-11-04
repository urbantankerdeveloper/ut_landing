export type BannerOptions = { port: number; logLevel: string; frontendOrigin: string }

const keyRoutes = [
  'GET    /health                           liveness check',
  'GET    /health/ready                     readiness check (database)',
  'POST   /api/auth/signup                  create account, sends email code',
  'POST   /api/auth/email/verify-otp        verify the email code',
  'POST   /api/auth/guest/request-otp       booking OTP (phone and/or email)',
  'POST   /api/auth/guest/verify-phone      verify a booking OTP',
]

export function startupBanner({ port, logLevel, frontendOrigin }: BannerOptions) {
  const base = `http://localhost:${port}`
  return [
    '',
    '============================================================',
    '  Urban Tanker API (development)',
    '============================================================',
    `  API base      ${base}/api`,
    `  Socket.IO     ${base}`,
    `  Frontend      ${frontendOrigin}`,
    `  Log level     ${logLevel}   (error | warn | success | info | debug)`,
    '',
    '  Key endpoints',
    ...keyRoutes.map((route) => `    ${route}`),
    '',
    '  Log colours: SUCCESS = 2xx/3xx, WARN = 4xx, ERROR = 5xx and failures.',
    '  Set LOG_LEVEL=debug for the most detail. Full guide: npm run help',
    '============================================================',
    '',
  ].join('\n')
}

export function helpGuide() {
  return [
    'Urban Tanker API: developer help',
    '',
    'RUN',
    '  npm run dev        start the API with hot reload (checks the database first)',
    '  npm run db:check   verify the database connection and schema',
    '  npm test           run the backend test suite',
    '  npm run lint       type check (tsc --noEmit)',
    '  npm run help       print this guide',
    '',
    'CONSOLE LOG LEVELS (set LOG_LEVEL in backend/.env.local)',
    '  error     failures that need attention (5xx, database, Redis, webhooks)',
    '  warn      recoverable problems and 4xx responses (SMS or email failed, slow request)',
    '  success   completed actions and 2xx/3xx responses',
    '  info      lifecycle events (startup, shutdown)',
    '  debug     extra detail, not emitted by default',
    '  Default is info, which shows error, warn, success and info.',
    '',
    'LOG FORMAT',
    '  development   colored, one line per event:',
    '                12:00:01.234 SUCCESS http.request requestId=abc method=GET path=/api/health status=200 durationMs=4.2',
    '  other envs    one JSON object per line: {"time","level","event",...}',
    '  NO_COLOR=1    turns off colors in development',
    '',
    'EVERY LINE HAS',
    '  event       dotted name such as http.request, sms_failed, payment.amount_mismatch',
    '  requestId   matches the x-request-id response header, so you can trace one call',
    '',
    'HTTP LOGGING',
    '  http.request   every API response (method, path, status, durationMs)',
    '  slow_request   responses slower than SLOW_REQUEST_MS (default 800)',
    '  http.error     an unhandled route error, with the status code returned',
    '  Tracking tokens in /api/public/tracking/:token are masked as :token.',
    '',
    'TROUBLESHOOTING',
    '  Missing SMS or email codes: check the sms_failed and smtp lines, or run npm run smtp:test',
    '  Database errors: run npm run db:check',
    '  Realtime errors: look for realtime.* events',
    '  Rate limiting: look for rate_limit.* events; set REDIS_URL for multiple instances',
    '',
  ].join('\n')
}
