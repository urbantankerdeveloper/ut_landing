import { z } from 'zod'

export const adminOrderQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.string().min(2).optional(),
})

export const adminVendorCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(60),
  phone: z.string().regex(/^\d{10}$/),
  businessName: z.string().min(2),
  serviceZone: z.string().min(2),
})

export const adminCustomerCreateSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(60),
  phone: z.string().regex(/^\d{10}$/),
})

export const adminCouponSchema = z.object({
  code: z.string().min(2),
  label: z.string().min(2),
  discount: z.string().min(1),
  expires: z.string().date(),
  active: z.boolean(),
})

export const adminServiceSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
  description: z.string().optional(),
  basePricePaise: z.number().nonnegative(),
  isActive: z.boolean().default(true),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().optional(),
}).refine(
  (value) => !value.effectiveFrom || !value.effectiveTo ||
    value.effectiveFrom <= value.effectiveTo,
  { message: 'Effective date range is invalid' },
)

export const adminPayoutStatusSchema = z.object({
  status: z.enum(['pending', 'processing', 'paid', 'failed']),
})

export const adminPartnerReviewSchema = z.object({
  status: z.enum(['submitted', 'under_review', 'approved', 'rejected']),
  reviewNote: z.string().trim().max(2000).optional(),
})

export const adminReportSchema = z.object({
  type: z.string().min(1),
  from: z.string().date(),
  to: z.string().date(),
  status: z.string().optional(),
  service: z.string().optional(),
}).refine((value) => value.from <= value.to, {
  message: 'Report date range is invalid',
})

export const adminNotificationSchema = z.object({
  customerId: z.string().uuid(),
  title: z.string().min(2).max(120),
  detail: z.string().min(1).max(2000),
  eventType: z.string().min(2).max(80).default('admin_message'),
  bookingId: z.string().uuid().optional(),
})

export const adminAuditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  actorId: z.string().uuid().optional(),
  action: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
})

export const dispatcherAssignmentSchema = z.object({
  vendorId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
}).refine(
  (value) => Boolean(value.vendorId || value.vehicleId || value.driverId),
  { message: 'At least one assignment is required' },
)

export const dispatcherStatusSchema = z.object({
  status: z.enum([
    'pending_vendor',
    'vendor_assigned',
    'accepted',
    'en_route',
    'arrived',
    'delivered',
  ]),
})

export const dispatcherCancellationSchema = z.object({
  reason: z.string().trim().min(2).max(500),
})
