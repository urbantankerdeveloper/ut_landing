import { config as loadEnv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { corsOriginProblem } from './lib/corsOrigins.js'

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: resolve(backendDirectory, '.env.local') })
loadEnv({ path: resolve(backendDirectory, '.env') })

const optionalSecret = z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional())
const optionalEmail = z.preprocess((value) => value === '' ? undefined : value, z.string().email().optional())
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production'], { error: 'NODE_ENV must be set to development, test, or production (see backend/.env.example)' }),
  PORT: z.coerce.number().default(8080),
  LOG_LEVEL: z.enum(['error', 'warn', 'success', 'info', 'debug']).default('info'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173').transform((value) => value.replace(/\/+$/, '')),
  CORS_ORIGINS: z.string().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SUPABASE_DB_URL: z.string().url().optional(),
  DB_SSL_CA: optionalSecret,
  REDIS_URL: z.string().url().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.preprocess((value) => value === undefined ? undefined : value === 'true', z.boolean().default(true)),
  SMTP_USER: optionalEmail,
  SMTP_PASSWORD: optionalSecret,
  MAIL_FROM: optionalEmail,
  TWILIO_ACCOUNT_SID: optionalSecret,
  TWILIO_AUTH_TOKEN: optionalSecret,
  TWILIO_FROM_NUMBER: optionalSecret,
  SMS_PROVIDER: z.enum(['msg91', 'twilio']).default('msg91'),

  MSG91_AUTH_KEY: optionalSecret,
  MSG91_TEMPLATE_ID_USER_REGISTRATION_OTP: optionalSecret,
  MSG91_TEMPLATE_ID_BOOKING_VERIFICATION_OTP: optionalSecret,
  MSG91_TEMPLATE_ID_GUEST_BOOKING_CONFIRMATION: optionalSecret,
  MSG91_TEMPLATE_ID_VENDOR_ACCEPTANCE: optionalSecret,
  MSG91_TEMPLATE_ID_DELIVERY_CONFIRMATION: optionalSecret,
  MSG91_TEMPLATE_ID_DELIVERY_OTP: optionalSecret,
  USE_DEFAULT_VERIFICATION_CODE: z.preprocess((value) => value === undefined ? undefined : value === 'true', z.boolean().default(false)),
  REQUIRE_BOOKING_PHONE_VERIFICATION: z.preprocess((value) => value === undefined ? undefined : value === 'true', z.boolean().default(true)),
  DEFAULT_VERIFICATION_CODE: z.string().regex(/^\d{6}$/, 'DEFAULT_VERIFICATION_CODE must be a 6-digit code').default('123456'),
  RAZORPAY_KEY_ID: optionalSecret,
  RAZORPAY_KEY_SECRET: optionalSecret,
  RAZORPAY_WEBHOOK_SECRET: optionalSecret,
  VAPID_PUBLIC_KEY: optionalSecret,
  VAPID_PRIVATE_KEY: optionalSecret,
  ONESIGNAL_APP_ID: optionalSecret,
  ONESIGNAL_REST_API_KEY: optionalSecret,
  ANALYTICS_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  ANALYTICS_ANONYMIZE_AFTER_DAYS: z.coerce.number().int().positive().default(7),
  OTP_HMAC_SECRET: z.string().min(32, 'OTP_HMAC_SECRET must be at least 32 characters').optional(),
  // Keep-alive must stay above the load balancer's idle timeout, or reused connections get reset (502s).
  HTTP_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().positive().default(65_000),
  HTTP_HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(66_000),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  SLOW_REQUEST_MS: z.coerce.number().int().nonnegative().default(800),
  CATALOG_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(60),
})
// Blank values (for example SUPABASE_SECRET_KEY= in .env.example) mean "not set".
const environment = Object.fromEntries(Object.entries(process.env).map(([key, value]) => [key, value === '' ? undefined : value]))
const result = schema.safeParse(environment)
if (!result.success) {
  const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
  throw new Error(`Invalid backend configuration (${problems}). Copy backend/.env.example to backend/.env and fill in the values, or set them in the host environment.`)
}
const parsed = result.data
const serviceRoleKey = parsed.SUPABASE_SERVICE_ROLE_KEY ?? parsed.SUPABASE_SECRET_KEY
if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required. Copy backend/.env.example to backend/.env and fill in the values.')
if (parsed.NODE_ENV === 'production' && !parsed.FRONTEND_ORIGIN.startsWith('https://')) {
  throw new Error('FRONTEND_ORIGIN must use HTTPS in production. For local runs set NODE_ENV=development in backend/.env.local.')
}
if (parsed.NODE_ENV === 'production' && parsed.USE_DEFAULT_VERIFICATION_CODE) {
  throw new Error('USE_DEFAULT_VERIFICATION_CODE must be false in production. For local runs set NODE_ENV=development in backend/.env.local.')
}
if (parsed.NODE_ENV === 'production' && parsed.SUPABASE_DB_URL && !parsed.DB_SSL_CA) {
  throw new Error('DB_SSL_CA is required in production so the database TLS certificate is verified. For local runs set NODE_ENV=development in backend/.env.local.')
}
if (parsed.NODE_ENV === 'production' && parsed.REDIS_URL && !parsed.REDIS_URL.startsWith('rediss://')) {
  throw new Error('REDIS_URL must use the rediss:// (TLS) scheme in production.')
}
const corsOrigins = (parsed.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim().replace(/\/+$/, '')).filter(Boolean)
const corsProblem = corsOriginProblem(corsOrigins, parsed.NODE_ENV)
if (corsProblem) throw new Error(`${corsProblem}. Fix CORS_ORIGINS in the host environment.`)
const otpHmacSecret = parsed.OTP_HMAC_SECRET ?? (parsed.NODE_ENV === 'production' ? undefined : 'development-only-otp-secret-do-not-use-in-production')
if (!otpHmacSecret) throw new Error('OTP_HMAC_SECRET (32+ characters) is required in production.')
export const config = {
  ...parsed,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  OTP_HMAC_SECRET: otpHmacSecret,
  MAIL_FROM: parsed.MAIL_FROM ?? parsed.SMTP_USER,
  DB_SSL_CA: parsed.DB_SSL_CA?.replace(/\\n/g, '\n'),
  CORS_ORIGINS: corsOrigins,
}
