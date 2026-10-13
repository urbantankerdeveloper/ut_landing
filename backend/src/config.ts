import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

loadEnv({ path: '.env.local' })
loadEnv()

const schema = z.object({ PORT: z.coerce.number().default(8080), FRONTEND_ORIGIN: z.string().default('http://localhost:5173'), SUPABASE_URL: z.string().url(), SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(), SUPABASE_SECRET_KEY: z.string().min(1).optional(), SUPABASE_DB_URL: z.string().url().optional(), DB_POOL_MAX: z.coerce.number().int().positive().default(10), ADMIN_REGISTRATION_KEY: z.string().min(1).optional(), JWT_EXPIRES_IN: z.string().default('15m'), REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d') })
const parsed = schema.parse(process.env)
const serviceRoleKey = parsed.SUPABASE_SERVICE_ROLE_KEY ?? parsed.SUPABASE_SECRET_KEY
if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY is required')
export const config = { ...parsed, SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey }
