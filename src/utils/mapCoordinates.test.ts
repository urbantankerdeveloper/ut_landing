import { describe, expect, it } from 'vitest'
import { calculateBearing } from './mapCoordinates'

describe('map coordinates', () => {
  it('calculates compass bearings for cardinal directions', () => {
    const origin = { lat: 0, lng: 0 }
    expect(calculateBearing(origin, { lat: 1, lng: 0 })).toBeCloseTo(0)
    expect(calculateBearing(origin, { lat: 0, lng: 1 })).toBeCloseTo(90)
    expect(calculateBearing(origin, { lat: -1, lng: 0 })).toBeCloseTo(180)
    expect(calculateBearing(origin, { lat: 0, lng: -1 })).toBeCloseTo(270)
  })
})
