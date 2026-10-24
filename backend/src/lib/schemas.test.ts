import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { bookingSchema, coordinatesSchema, credentialsSchema } from './schemas.js'

describe('request schemas', () => {
  it('accepts a valid login payload', () => { expect(credentialsSchema.safeParse({ email: 'user@example.com', password: 'password123' }).success).toBe(true) })
  it('rejects a short password', () => { expect(credentialsSchema.safeParse({ email: 'user@example.com', password: 'short' }).success).toBe(false) })
  it('requires booking location and date', () => { expect(bookingSchema.safeParse({ serviceId: 'water', location: 'ECR', deliveryDate: '2026-10-20' }).success).toBe(true); expect(bookingSchema.safeParse({ serviceId: 'water' }).success).toBe(false) })
  it('requires booking coordinates to be supplied as a pair', () => {
    expect(bookingSchema.safeParse({ serviceId: 'water', location: 'ECR', deliveryDate: '2026-10-20', latitude: 12.9, longitude: 77.6 }).success).toBe(true)
    expect(bookingSchema.safeParse({ serviceId: 'water', location: 'ECR', deliveryDate: '2026-10-20', latitude: 12.9 }).success).toBe(false)
  })
  it('accepts per-service details for one combined booking', () => {
    expect(bookingSchema.safeParse({
      serviceId: 'water',
      services: [
        { serviceId: 'water', capacity: '5000', details: 'Potable water' },
        { serviceId: 'cleaning', capacity: '2 tanks', details: 'Clean the rooftop tank' },
      ],
      location: 'ECR',
      deliveryDate: '2026-10-20',
    }).success).toBe(true)
  })
  it('rejects a booking without a service', () => {
    expect(bookingSchema.safeParse({ location: 'ECR', deliveryDate: '2026-10-20' }).success).toBe(false)
  })
  it('bounds geographic coordinates', () => {
    const schema = z.object(coordinatesSchema)
    expect(schema.safeParse({ latitude: 12.9, longitude: 77.6 }).success).toBe(true)
    expect(schema.safeParse({ latitude: 91, longitude: 0 }).success).toBe(false)
    expect(schema.safeParse({ latitude: 0, longitude: 181 }).success).toBe(false)
  })
})
