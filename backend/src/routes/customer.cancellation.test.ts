import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'

const state = vi.hoisted(() => ({
  transition: vi.fn(),
  notification: vi.fn(),
}))

vi.mock('../supabase.js', () => ({
  supabase: {
    from: () => {
      const builder = {
        select() {
          return this
        },
        eq() {
          return this
        },
        async maybeSingle() {
          return { data: { id: 'booking-1', status: 'pending_vendor' }, error: null }
        },
      }
      return builder
    },
  },
}))

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (
    request: { authUser?: unknown },
    _response: unknown,
    next: () => void,
  ) => {
    request.authUser = { id: 'customer-1' }
    next()
  },
}))

vi.mock('../services/bookingLifecycle.js', () => ({
  canCustomerCancelBooking: () => true,
  transitionBooking: state.transition,
}))

vi.mock('../services/bookingNotifications.js', () => ({
  notifyCustomerOfBooking: vi.fn(),
  notifyCustomerOfBookingStatus: state.notification,
}))

import customerExtendedRouter from './customerExtended.js'

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/customer', customerExtendedRouter)
  return app
}

beforeEach(() => {
  state.transition.mockReset()
  state.transition.mockResolvedValue({
    data: { id: 'booking-1', status: 'cancelled' },
    error: null,
  })
  state.notification.mockReset()
  config.featureFlags.AUTH_MOUNT_ONCE = false
})

describe('PATCH /orders/:orderId/status cancellation', () => {
  it('passes the supplied reason through the existing lifecycle transition', async () => {
    const response = await request(buildApp())
      .patch('/api/customer/orders/booking-1/status')
      .send({ status: 'cancelled', reason: 'I no longer need this delivery' })

    expect(response.status).toBe(200)
    expect(state.transition).toHaveBeenCalledWith({
      bookingId: 'booking-1',
      actorId: 'customer-1',
      status: 'cancelled',
      cancellationReason: 'I no longer need this delivery',
    })
  })

  it('keeps the existing cancellation reason for legacy clients', async () => {
    const response = await request(buildApp())
      .patch('/api/customer/orders/booking-1/status')
      .send({ status: 'cancelled' })

    expect(response.status).toBe(200)
    expect(state.transition).toHaveBeenCalledWith({
      bookingId: 'booking-1',
      actorId: 'customer-1',
      status: 'cancelled',
      cancellationReason: 'Cancelled by customer',
    })
  })

  it('rejects a reason outside the supported length', async () => {
    const response = await request(buildApp())
      .patch('/api/customer/orders/booking-1/status')
      .send({ status: 'cancelled', reason: ' ' })

    expect(response.status).toBe(400)
    expect(state.transition).not.toHaveBeenCalled()
  })
})
