import { z } from 'zod'
export const credentialsSchema = z.object({ email: z.string().email().optional(), username: z.string().min(3).optional(), password: z.string().min(8) }).refine((value) => value.email || value.username, { message: 'Email or username is required' })
export const coordinatesSchema = {
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
}
const bookingServiceSchema = z.object({
  serviceId: z.string().min(1),
  capacity: z.string().max(30).optional(),
  waterType: z.string().max(40).optional(),
  tankerCount: z.enum(['1', '2', '3', '4', '5']).optional(),
  serviceType: z.string().max(80).optional(),
  quantity: z.string().max(80).optional(),
  depth: z.string().max(80).optional(),
  grade: z.string().max(40).optional(),
  pump: z.enum(['No', 'Yes', 'To be confirmed']).optional(),
  pickupLocation: z.string().max(200).optional(),
  materialType: z.string().max(100).optional(),
  details: z.string().max(1000).optional(),
  deliveryDate: z.string().min(10).optional(),
  preferredTime: z.enum(['07:00', '10:00', '14:00', '18:00']).optional(),
  location: z.string().min(3).max(200).optional(),
  phone: z.string().regex(/^\d{10}$/).optional(),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
  phoneVerificationChallengeId: z.string().uuid().optional(),
})
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), { message: 'Service coordinates must be provided together' })
export const bookingSchema = z.object({
  idempotencyKey: z.string().uuid().optional(),
  serviceId: z.string().min(1).optional(),
  services: z.array(bookingServiceSchema).min(1).max(20).optional(),
  capacity: z.string().optional(),
  location: z.string().min(3),
  deliveryDate: z.string().min(10).optional(),
  preferredTime: z.enum(['07:00', '10:00', '14:00', '18:00']).optional(),
  notes: z.string().max(1000).optional(),
  couponCode: z.string().max(80).optional(),
  phone: z.string().regex(/^\d{10}$/).optional(),
  phoneVerificationChallengeId: z.string().uuid().optional(),
  paymentMethod: z.enum(['wallet', 'gateway', 'cod']).default('wallet'),
  latitude: z.number().finite().min(-90).max(90).optional(),
  longitude: z.number().finite().min(-180).max(180).optional(),
})
  .refine((value) => Boolean(value.services?.length || value.serviceId?.trim()), { message: 'At least one service is required' })
  .refine((value) => Boolean(value.deliveryDate || value.services?.every((service) => service.deliveryDate)), { message: 'A delivery date is required for every service' })
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), { message: 'Latitude and longitude must be provided together' })
