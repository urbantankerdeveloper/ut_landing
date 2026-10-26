import { config as loadEnv } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
loadEnv({ path: resolve(backendDirectory, '.env.local') })
loadEnv({ path: resolve(backendDirectory, '.env') })

const optionalSecret = z.preprocess((value) => value === '' ? undefined : value, z.string().min(1).optional())
const optionalEmail = z.preprocess((value) => value === '' ? undefined : value, z.string().email().optional())
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(8080),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SUPABASE_DB_URL: z.string().url().optional(),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  ADMIN_REGISTRATION_KEY: z.string().min(1).optional(),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d'),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.preprocess((value) => value === undefined ? undefined : value === 'true', z.boolean().default(true)),
  SMTP_USER: optionalEmail,
  SMTP_PASSWORD: optionalSecret,
  MAIL_FROM: optionalEmail,
  TWILIO_ACCOUNT_SID: optionalSecret,
  TWILIO_AUTH_TOKEN: optionalSecret,
  TWILIO_FROM_NUMBER: optionalSecret,
  USE_DEFAULT_VERIFICATION_CODE: z.preprocess((value) => value === undefined ? undefined : value === 'true', z.boolean().default(false)),
  DEFAULT_VERIFICATION_CODE: z.string().regex(/^\d{6}$/, 'DEFAULT_VERIFICATION_CODE must be a 6-digit code').default('123456'),
  RAZORPAY_KEY_ID: optionalSecret,
  RAZORPAY_KEY_SECRET: optionalSecret,
  VAPID_PUBLIC_KEY: optionalSecret,
  VAPID_PRIVATE_KEY: optionalSecret,
  ONESIGNAL_APP_ID: optionalSecret,
  ONESIGNAL_REST_API_KEY: optionalSecret,
  ANALYTICS_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  ANALYTICS_ANONYMIZE_AFTER_DAYS: z.coerce.number().int().positive().default(7),
})
const parsed = schema.parse(process.env)
const serviceRoleKey = parsed.SUPABASE_SERVICE_ROLE_KEY ?? parsed.SUPABASE_SECRET_KEY
if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required')
if (parsed.NODE_ENV === 'production' && !parsed.FRONTEND_ORIGIN.startsWith('https://')) {
  throw new Error('FRONTEND_ORIGIN must use HTTPS in production')
}
export const config = {
  ...parsed,
  SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
  MAIL_FROM: parsed.MAIL_FROM ?? parsed.SMTP_USER,
}
