import { describe, expect, it } from 'vitest'
import { sumServiceItemPrices } from './pricingMath.js'

describe('service item pricing', () => {
  it('charges each repeated service item', () => {
    expect(sumServiceItemPrices(['water_tanker', 'water_tanker'], [
      { code: 'water_tanker', base_price_paise: 250000 },
    ])).toBe(500000)
  })

  it('sums prices across distinct items', () => {
    expect(sumServiceItemPrices(['water_tanker', 'tank_cleaning'], [
      { code: 'water_tanker', base_price_paise: 250000 },
      { code: 'tank_cleaning', base_price_paise: 180000 },
    ])).toBe(430000)
  })

  it('multiplies a service item by its tanker or product quantity', () => {
    expect(sumServiceItemPrices([
      { serviceId: 'water_tanker', tankerCount: '3' },
      { serviceId: 'drinking_water', quantity: '4' },
    ], [
      { code: 'water_tanker', base_price_paise: 250000 },
      { code: 'drinking_water', base_price_paise: 5500 },
    ])).toBe(772000)
  })
})