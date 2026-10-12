import { config as loadEnv } from 'dotenv'
import { z } from 'zod'

loadEnv({ path: '.env.local' })
loadEnv()

const schema = z.object({ PORT: z.coerce.number().default(8080), FRONTEND_ORIGIN: z.string().default('http://localhost:5173'), SUPABASE_URL: z.string().url(), SUPABASE_SERVICE_ROLE_KEY: z.string().min(1), JWT_EXPIRES_IN: z.string().default('15m'), REFRESH_TOKEN_EXPIRES_IN: z.string().default('30d') })
export const config = schema.parse(process.env)
