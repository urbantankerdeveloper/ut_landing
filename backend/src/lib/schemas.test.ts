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
  it('accepts repeated service items with one shared time slot', () => {
    expect(bookingSchema.safeParse({
      services: [
        { serviceId: 'water_tanker', capacity: '6 KL', waterType: 'Domestic water', tankerCount: '1', deliveryDate: '2026-10-30', preferredTime: '07:00', location: 'ECR, Chennai' },
        { serviceId: 'water_tanker', capacity: '12 KL', waterType: 'Raw water', tankerCount: '2', deliveryDate: '2026-10-30', preferredTime: '07:00', location: 'OMR, Chennai' },
      ],
      location: 'ECR, Chennai',
      deliveryDate: '2026-10-30',
      preferredTime: '07:00',
      phone: '9876543210',
    }).success).toBe(true)
    expect(bookingSchema.safeParse({ serviceId: 'water_tanker', location: 'ECR, Chennai', deliveryDate: '2026-10-30', preferredTime: '11:00' }).success).toBe(false)
  })
  it('limits tanker count to five per service item', () => {
    const booking = (tankerCount: string) => bookingSchema.safeParse({
      services: [{ serviceId: 'water_tanker', tankerCount, deliveryDate: '2026-10-30' }],
      location: 'ECR, Chennai',
    }).success
    expect(booking('5')).toBe(true)
    expect(booking('6')).toBe(false)
  })
  it('accepts a separate delivery date for every service without a shared date', () => {
    expect(bookingSchema.safeParse({
      services: [
        { serviceId: 'water', capacity: '5000', details: 'Potable water', deliveryDate: '2026-10-20' },
        { serviceId: 'cleaning', capacity: '2 tanks', details: 'Clean the rooftop tank', deliveryDate: '2026-10-22' },
      ],
      location: 'ECR',
    }).success).toBe(true)
  })
  it('accepts one verified booking contact with a separate location for each service', () => {
    expect(bookingSchema.safeParse({
      services: [
        { serviceId: 'water', deliveryDate: '2026-10-20', location: 'ECR, Chennai' },
        { serviceId: 'cleaning', deliveryDate: '2026-10-22', location: 'OMR, Chennai' },
      ],
      location: 'ECR, Chennai',
      phone: '9876543210',
      phoneVerificationChallengeId: '00000000-0000-4000-8000-000000000001',
    }).success).toBe(true)
  })
  it('accepts distinct service locations without requiring duplicate phone values', () => {
    const parsed = bookingSchema.safeParse({
      services: [
        { serviceId: 'water', deliveryDate: '2026-10-20', location: 'ECR, Chennai' },
        { serviceId: 'cleaning', deliveryDate: '2026-10-22', location: 'OMR, Chennai' },
      ],
      location: 'ECR, Chennai',
      deliveryDate: '2026-10-20',
      phone: '9876543210',
    })
    expect(parsed.success).toBe(true)
  })
  it('rejects multi-service bookings if a service has no date and no legacy shared date', () => {
    expect(bookingSchema.safeParse({
      services: [
        { serviceId: 'water', deliveryDate: '2026-10-20' },
        { serviceId: 'cleaning' },
      ],
      location: 'ECR',
    }).success).toBe(false)
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
