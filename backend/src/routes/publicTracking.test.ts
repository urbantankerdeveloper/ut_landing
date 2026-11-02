import { describe, expect, it } from 'vitest'
import { publicCoordinate, publicDriverName } from './publicTracking.js'

describe('publicDriverName', () => {
  it('shows only the first name while the delivery is active', () => {
    expect(publicDriverName('en_route', 'Ramesh  Kumar')).toBe('Ramesh')
    expect(publicDriverName('accepted', 'Asha')).toBe('Asha')
  })

  it('hides the driver before assignment and after the delivery is closed', () => {
    expect(publicDriverName('pending_vendor', 'Ramesh Kumar')).toBeNull()
    expect(publicDriverName('delivered', 'Ramesh Kumar')).toBeNull()
    expect(publicDriverName('cancelled', 'Ramesh Kumar')).toBeNull()
  })
})

describe('publicCoordinate', () => {
  it('keeps full precision before arrival', () => {
    expect(publicCoordinate(13.0827123, 'en_route')).toBe(13.0827123)
  })

  it('rounds to about 110 m after arrival', () => {
    expect(publicCoordinate(13.0827123, 'arrived')).toBe(13.083)
    expect(publicCoordinate(80.2707456, 'delivered')).toBe(80.271)
  })
})
