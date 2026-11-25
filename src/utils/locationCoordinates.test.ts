import { describe, expect, it } from 'vitest'
import { parseOptionalCoordinates } from './locationCoordinates'

describe('parseOptionalCoordinates', () => {
  it('omits coordinates when both fields are empty', () => {
    expect(parseOptionalCoordinates('', '')).toEqual({})
  })

  it('parses a complete valid coordinate pair', () => {
    expect(parseOptionalCoordinates('13.0827', '80.2707')).toEqual({
      latitude: 13.0827,
      longitude: 80.2707,
    })
  })

  it('rejects partial and out-of-range coordinates', () => {
    expect(() => parseOptionalCoordinates('13.0827', '')).toThrow(
      'Enter both latitude and longitude.',
    )
    expect(() => parseOptionalCoordinates('91', '80')).toThrow(
      'Enter valid latitude and longitude values.',
    )
  })
})
