import { describe, expect, it } from 'vitest'
import {
  adminAuditQuerySchema,
  adminCouponSchema,
  adminCustomerCreateSchema,
  dispatcherAssignmentSchema,
  dispatcherCancellationSchema,
  dispatcherStatusSchema,
  adminNotificationSchema,
  adminOrderQuerySchema,
  adminPartnerReviewSchema,
  adminPayoutStatusSchema,
  adminReportSchema,
  adminServiceSchema,
  adminVendorCreateSchema,
} from './adminContracts.js'

describe('Admin API contracts', () => {
  it('accepts paginated order and audit filters', () => {
    expect(adminOrderQuerySchema.parse({
      page: '2',
      pageSize: '25',
      status: 'delivered',
    })).toMatchObject({ page: 2, pageSize: 25, status: 'delivered' })
    expect(adminAuditQuerySchema.parse({
      page: '1',
      actorId: '11111111-1111-4111-8111-111111111111',
      action: 'vendor.updated',
      entityType: 'vendor',
    }).page).toBe(1)
  })

  it('rejects invalid vendor and customer creation payloads', () => {
    expect(adminVendorCreateSchema.safeParse({
      email: 'vendor@example.com',
      password: 'password123',
      name: 'Vendor Owner',
      phone: '9876543210',
      businessName: 'Tanker Fleet',
      serviceZone: 'South',
    }).success).toBe(true)
    expect(adminVendorCreateSchema.safeParse({
      email: 'not-an-email',
      password: 'short',
      name: 'V',
      phone: '123',
      businessName: 'F',
      serviceZone: '',
    }).success).toBe(false)
    expect(adminCustomerCreateSchema.safeParse({
      email: 'customer@example.com',
      password: 'password123',
      name: 'Customer',
      phone: '9876543210',
    }).success).toBe(true)
  })

  it('enforces coupon expiry and service effective-date semantics', () => {
    expect(adminCouponSchema.safeParse({
      code: 'SAVE10',
      label: 'Save ten',
      discount: '10%',
      expires: '2026-12-31',
      active: true,
    }).success).toBe(true)
    expect(adminCouponSchema.safeParse({
      code: 'SAVE10',
      label: 'Save ten',
      discount: '10%',
      expires: 'not-a-date',
      active: true,
    }).success).toBe(false)
    expect(adminServiceSchema.safeParse({
      code: 'water',
      name: 'Water delivery',
      basePricePaise: 10000,
      effectiveFrom: '2026-12-31',
      effectiveTo: '2026-01-01',
    }).success).toBe(false)
  })

  it('limits payout, partner, notification, and report states', () => {
    expect(adminPayoutStatusSchema.safeParse({ status: 'processing' }).success).toBe(true)
    expect(adminPayoutStatusSchema.safeParse({ status: 'refunded' }).success).toBe(false)
    expect(adminPartnerReviewSchema.safeParse({
      status: 'under_review',
      reviewNote: 'Documents are being checked',
    }).success).toBe(true)
    expect(adminNotificationSchema.safeParse({
      customerId: '11111111-1111-4111-8111-111111111111',
      title: 'Booking update',
      detail: 'Your booking was updated.',
    }).success).toBe(true)
    expect(adminReportSchema.safeParse({
      type: 'revenue',
      from: '2026-10-21',
      to: '2026-10-20',
    }).success).toBe(false)
  })

  it('validates dispatcher assignment, status, and cancellation payloads', () => {
    expect(dispatcherAssignmentSchema.safeParse({
      vendorId: '11111111-1111-4111-8111-111111111111',
    }).success).toBe(true)
    expect(dispatcherAssignmentSchema.safeParse({}).success).toBe(false)
    expect(dispatcherStatusSchema.safeParse({ status: 'en_route' }).success).toBe(true)
    expect(dispatcherStatusSchema.safeParse({ status: 'failed' }).success).toBe(false)
    expect(dispatcherCancellationSchema.safeParse({
      reason: 'Customer requested cancellation',
    }).success).toBe(true)
    expect(dispatcherCancellationSchema.safeParse({ reason: 'x' }).success).toBe(false)
  })
})
