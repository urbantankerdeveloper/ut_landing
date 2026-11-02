import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildVendorPayouts, isServiceInEffectiveWindow, sumServiceItemPrices } from './pricingMath.js'
import { quoteServices } from './pricing.js'

const mock = vi.hoisted(() => ({ tables: new Map<string, { data: unknown; error: unknown }>() }))
vi.mock('../supabase.js', () => {
  const builder = (table: string): Record<string, unknown> => {
    const chain: Record<string, unknown> = {}
    for (const method of ['select', 'in', 'eq', 'is', 'not', 'neq', 'gte', 'lte', 'or', 'order', 'limit']) chain[method] = () => chain
    chain.maybeSingle = async () => {
      const result = mock.tables.get(table) ?? { data: null, error: null }
      return { data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data, error: result.error }
    }
    chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => Promise.resolve(mock.tables.get(table) ?? { data: [], error: null }).then(onFulfilled, onRejected)
    return chain
  }
  return { supabase: { from: (table: string) => builder(table) } }
})

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

describe('quantity, capacity, depth and total bounds', () => {
  const services = [
    { code: 'drinking_water', base_price_paise: 5500 },
    { code: 'water_tanker', base_price_paise: 250000 },
    { code: 'borewell_service', base_price_paise: 100000 },
  ]
  it.each(['0.001', '0', '51', '2.5', 'abc'])('rejects quantity %s', (quantity) => {
    expect(() => sumServiceItemPrices([{ serviceId: 'drinking_water', quantity }], services)).toThrow('Quantity must be a whole number from 1 to 50.')
  })
  it('accepts a whole quantity of 50', () => {
    expect(sumServiceItemPrices([{ serviceId: 'drinking_water', quantity: '50' }], services)).toBe(275000)
  })
  it.each(['0', '500 KL', '1,000,000 litres'])('rejects tanker capacity %s outside the supported range', (capacity) => {
    expect(() => sumServiceItemPrices([{ serviceId: 'water_tanker', capacity }], services)).toThrow('Tanker capacity is outside the supported range.')
  })
  it.each(['0', '1001', '-5', 'deep'])('rejects borewell depth %s outside 1 to 1000 ft', (depth) => {
    expect(() => sumServiceItemPrices([{ serviceId: 'borewell_service', depth }], services)).toThrow('Depth must be between 1 and 1000 ft.')
  })
  it('ignores an empty depth and scales by a provided depth', () => {
    expect(sumServiceItemPrices([{ serviceId: 'borewell_service', depth: '' }], services)).toBe(100000)
    expect(sumServiceItemPrices([{ serviceId: 'borewell_service', depth: '300' }], services)).toBe(300000)
  })
  it('rejects a subtotal above 100,000,000 paise', () => {
    expect(() => sumServiceItemPrices([{ serviceId: 'water_tanker', tankerCount: '5' }], [{ code: 'water_tanker', base_price_paise: 30_000_000 }])).toThrow('The booking total is outside the payable range.')
  })
  it('rejects a subtotal that is not a safe integer', () => {
    expect(() => sumServiceItemPrices(['water_tanker'], [{ code: 'water_tanker', base_price_paise: Number.NaN }])).toThrow('outside the payable range')
  })
})

describe('effective pricing windows', () => {
  it('honours effective dates on both ends', () => {
    expect(isServiceInEffectiveWindow({ effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' }, '2026-11-02')).toBe(true)
    expect(isServiceInEffectiveWindow({ effectiveFrom: '2026-01-01', effectiveTo: '2026-10-31' }, '2026-11-02')).toBe(false)
    expect(isServiceInEffectiveWindow({ effectiveFrom: '2026-11-05' }, '2026-11-02')).toBe(false)
    expect(isServiceInEffectiveWindow(null, '2026-11-02')).toBe(true)
  })
})

describe('vendor settlement payouts', () => {
  const period = { from: '2026-10-01', to: '2026-10-31' }
  it('groups delivered bookings by vendor and records the booking ids', () => {
    const payouts = buildVendorPayouts([
      { id: 'b1', vendor_id: 'v1', quoted_amount_paise: 100001 },
      { id: 'b2', vendor_id: 'v1', quoted_amount_paise: 250000 },
      { id: 'b3', vendor_id: 'v2', quoted_amount_paise: 99999 },
      { id: 'b4', vendor_id: null, quoted_amount_paise: 50000 },
    ], 0.85, period)
    expect(payouts).toEqual([
      { vendor_id: 'v1', period_start: period.from, period_end: period.to, amount_paise: Math.round(100001 * 0.85) + Math.round(250000 * 0.85), booking_ids: ['b1', 'b2'] },
      { vendor_id: 'v2', period_start: period.from, period_end: period.to, amount_paise: Math.round(99999 * 0.85), booking_ids: ['b3'] },
    ])
  })
  it('sums each payout to the per-booking shares', () => {
    const bookings = [
      { id: 'b1', vendor_id: 'v1', quoted_amount_paise: 123457 },
      { id: 'b2', vendor_id: 'v2', quoted_amount_paise: 77777 },
      { id: 'b3', vendor_id: 'v1', quoted_amount_paise: 31313 },
    ]
    const total = buildVendorPayouts(bookings, 0.85, period).reduce((sum, payout) => sum + payout.amount_paise, 0)
    expect(total).toBe(bookings.reduce((sum, booking) => sum + Math.round(booking.quoted_amount_paise * 0.85), 0))
  })
  it('returns no payouts when nothing is unsettled', () => {
    expect(buildVendorPayouts([], 0.85, period)).toEqual([])
  })
})

describe('quoteServices', () => {
  const waterTanker = { code: 'water_tanker', base_price_paise: 250000, config: {} }
  function seed(tables: Record<string, { data: unknown }>) {
    mock.tables.clear()
    for (const [name, value] of Object.entries(tables)) mock.tables.set(name, { data: value.data, error: null })
  }
  beforeEach(() => mock.tables.clear())

  it('prices a flat coupon and returns the coupon id', async () => {
    seed({ service_catalog: { data: [waterTanker] }, coupons: { data: { id: 'c1', discount_type: 'flat', discount_value: 100, valid_until: null } } })
    await expect(quoteServices([{ serviceId: 'water_tanker' }], 'save100', 'customer-1')).resolves.toEqual({ subtotalPaise: 250000, gstPaise: 45000, discountPaise: 10000, totalPaise: 285000, couponId: 'c1' })
  })
  it('rejects a coupon past its expiry date', async () => {
    seed({ service_catalog: { data: [waterTanker] }, coupons: { data: { id: 'c1', discount_type: 'flat', discount_value: 100, valid_until: '2020-01-01T00:00:00Z' } } })
    await expect(quoteServices([{ serviceId: 'water_tanker' }], 'OLD')).rejects.toThrow('Coupon is not available')
  })
  it('rejects a second redemption of the same coupon by the same customer', async () => {
    seed({ service_catalog: { data: [waterTanker] }, coupons: { data: { id: 'c1', discount_type: 'flat', discount_value: 100, valid_until: null } }, coupon_redemptions: { data: { coupon_id: 'c1' } } })
    await expect(quoteServices([{ serviceId: 'water_tanker' }], 'SAVE100', 'customer-1')).rejects.toThrow('already been used')
  })
  it('rejects a service outside its effective window', async () => {
    seed({ service_catalog: { data: [{ ...waterTanker, config: { effectiveFrom: '2020-01-01', effectiveTo: '2020-12-31' } }] } })
    await expect(quoteServices([{ serviceId: 'water_tanker' }])).rejects.toThrow('One or more selected services are unavailable')
  })
  it('rejects a total that would be zero', async () => {
    seed({ service_catalog: { data: [waterTanker] }, coupons: { data: { id: 'c1', discount_type: 'percentage', discount_value: 118, valid_until: null } } })
    await expect(quoteServices([{ serviceId: 'water_tanker' }], 'FREE')).rejects.toThrow('outside the payable range')
  })
})