import { z } from 'zod'
export const credentialsSchema = z.object({ email: z.string().email().optional(), username: z.string().min(3).optional(), password: z.string().min(8) }).refine((value) => value.email || value.username, { message: 'Email or username is required' })
export const bookingSchema = z.object({ serviceId: z.string().min(1), capacity: z.string().optional(), location: z.string().min(3), deliveryDate: z.string().min(10), notes: z.string().max(1000).optional(), couponCode: z.string().max(80).optional() })
