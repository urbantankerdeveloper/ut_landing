import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { bookingSchema, clientPlatformFromHeader, clientPlatformSchema, coordinatesSchema, credentialsSchema, themeModeSchema } from './schemas.js'

const soon = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

describe('request schemas', () => {
  it('accepts only light, dark, or system theme modes', () => {
    expect(themeModeSchema.safeParse('dark').success).toBe(true)
    expect(themeModeSchema.safeParse('light').success).toBe(true)
    expect(themeModeSchema.safeParse('system').success).toBe(true)
    expect(themeModeSchema.safeParse('purple').success).toBe(false)
  })
  it('normalises unknown client platforms to web', () => {
    expect(clientPlatformSchema.parse('mobile')).toBe('mobile')
    expect(clientPlatformSchema.parse('web')).toBe('web')
    expect(clientPlatformSchema.parse(undefined)).toBe('web')
    expect(clientPlatformSchema.parse('desktop')).toBe('web')
  })
  it('reads the client platform header case-insensitively', () => {
    expect(clientPlatformFromHeader(' Mobile ')).toBe('mobile')
    expect(clientPlatformFromHeader(undefined)).toBe('web')
  })
  it('accepts a valid login payload', () => { expect(credentialsSchema.safeParse({ email: 'user@example.com', password: 'password123' }).success).toBe(true) })
  it('rejects a short password', () => { expect(credentialsSchema.safeParse({ email: 'user@example.com', password: 'short' }).success).toBe(false) })
  it('requires booking location and date', () => { expect(bookingSchema.safeParse({ serviceId: 'water', location: 'ECR', deliveryDate: soon(2) }).success).toBe(true); expect(bookingSchema.safeParse({ serviceId: 'water' }).success).toBe(false) })
  it('does not default a missing payment method, so the route can reject it', () => {
    const parsed = bookingSchema.safeParse({ serviceId: 'water', location: 'ECR', deliveryDate: soon(2) })
    expect(parsed.success && parsed.data.paymentMethod).toBeUndefined()
  })
  it('requires booking coordinates to be supplied as a pair', () => {
    expect(bookingSchema.safeParse({ serviceId: 'water', location: 'ECR', deliveryDate: soon(2), latitude: 12.9, longitude: 77.6 }).success).toBe(true)
    expect(bookingSchema.safeParse({ serviceId: 'water', location: 'ECR', deliveryDate: soon(2), latitude: 12.9 }).success).toBe(false)
  })
  it('accepts per-service details for one combined booking', () => {
    expect(bookingSchema.safeParse({
      serviceId: 'water',
      services: [
        { serviceId: 'water', capacity: '5000', details: 'Potable water' },
        { serviceId: 'cleaning', capacity: '2 tanks', details: 'Clean the rooftop tank' },
      ],
      location: 'ECR',
      deliveryDate: soon(2),
    }).success).toBe(true)
  })
  it('accepts repeated service items with one shared time slot', () => {
    expect(bookingSchema.safeParse({
      services: [
        { serviceId: 'water_tanker', capacity: '6 KL', waterType: 'Domestic water', tankerCount: '1', deliveryDate: soon(6), preferredTime: '07:00', location: 'ECR, Chennai' },
        { serviceId: 'water_tanker', capacity: '12 KL', waterType: 'Raw water', tankerCount: '2', deliveryDate: soon(6), preferredTime: '07:00', location: 'OMR, Chennai' },
      ],
      location: 'ECR, Chennai',
      deliveryDate: soon(6),
      preferredTime: '07:00',
      phone: '9876543210',
    }).success).toBe(true)
    expect(bookingSchema.safeParse({ serviceId: 'water_tanker', location: 'ECR, Chennai', deliveryDate: soon(6), preferredTime: '11:00' }).success).toBe(false)
  })
  it('limits tanker count to five per service item', () => {
    const booking = (tankerCount: string) => bookingSchema.safeParse({
      services: [{ serviceId: 'water_tanker', tankerCount, deliveryDate: soon(6) }],
      location: 'ECR, Chennai',
    }).success
    expect(booking('5')).toBe(true)
    expect(booking('6')).toBe(false)
  })
  it('accepts a separate delivery date for every service without a shared date', () => {
    expect(bookingSchema.safeParse({
      services: [
        { serviceId: 'water', capacity: '5000', details: 'Potable water', deliveryDate: soon(2) },
        { serviceId: 'cleaning', capacity: '2 tanks', details: 'Clean the rooftop tank', deliveryDate: soon(4) },
      ],
      location: 'ECR',
    }).success).toBe(true)
  })
  it('accepts one verified booking contact with a separate location for each service', () => {
    expect(bookingSchema.safeParse({
      services: [
        { serviceId: 'water', deliveryDate: soon(2), location: 'ECR, Chennai' },
        { serviceId: 'cleaning', deliveryDate: soon(4), location: 'OMR, Chennai' },
      ],
      location: 'ECR, Chennai',
      phone: '9876543210',
      phoneVerificationChallengeId: '00000000-0000-4000-8000-000000000001',
    }).success).toBe(true)
  })
  it('accepts distinct service locations without requiring duplicate phone values', () => {
    const parsed = bookingSchema.safeParse({
      services: [
        { serviceId: 'water', deliveryDate: soon(2), location: 'ECR, Chennai' },
        { serviceId: 'cleaning', deliveryDate: soon(4), location: 'OMR, Chennai' },
      ],
      location: 'ECR, Chennai',
      deliveryDate: soon(2),
      phone: '9876543210',
    })
    expect(parsed.success).toBe(true)
  })
  it('rejects multi-service bookings if a service has no date and no legacy shared date', () => {
    expect(bookingSchema.safeParse({
      services: [
        { serviceId: 'water', deliveryDate: soon(2) },
        { serviceId: 'cleaning' },
      ],
      location: 'ECR',
    }).success).toBe(false)
  })
  it('rejects a booking without a service', () => {
    expect(bookingSchema.safeParse({ location: 'ECR', deliveryDate: soon(2) }).success).toBe(false)
  })
  it('bounds geographic coordinates', () => {
    const schema = z.object(coordinatesSchema)
    expect(schema.safeParse({ latitude: 12.9, longitude: 77.6 }).success).toBe(true)
    expect(schema.safeParse({ latitude: 91, longitude: 0 }).success).toBe(false)
    expect(schema.safeParse({ latitude: 0, longitude: 181 }).success).toBe(false)
  })
})

describe('booking input bounds', () => {
  it('accepts only whole quantities of up to two digits', () => {
    const booking = (quantity: string) => bookingSchema.safeParse({ services: [{ serviceId: 'drinking_water', quantity, deliveryDate: soon(2) }], location: 'ECR, Chennai' }).success
    expect(booking('4')).toBe(true)
    expect(booking('0.001')).toBe(false)
    expect(booking('0.5')).toBe(false)
    expect(booking('100')).toBe(false)
  })
  it('rejects delivery dates that are in the past or not real calendar dates', () => {
    const booking = (deliveryDate: string) => bookingSchema.safeParse({ serviceId: 'water_tanker', location: 'ECR, Chennai', deliveryDate }).success
    expect(booking(soon(1))).toBe(true)
    expect(booking(soon(-1))).toBe(false)
    expect(booking('2026-02-30')).toBe(false)
    expect(booking('2026-13-01')).toBe(false)
  })
  it('bounds location and capacity lengths', () => {
    expect(bookingSchema.safeParse({ serviceId: 'water_tanker', location: 'x'.repeat(201), deliveryDate: soon(2) }).success).toBe(false)
    expect(bookingSchema.safeParse({ serviceId: 'water_tanker', location: 'ECR, Chennai', capacity: 'x'.repeat(31), deliveryDate: soon(2) }).success).toBe(false)
  })
})
