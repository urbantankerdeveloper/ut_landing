import { describe, expect, it } from 'vitest'
import {
  salesPeriodWindows,
  salesRowsFromFulfilments,
  summarizeSales,
  type SalesOrder,
} from './salesReports.js'

describe('sales report periods', () => {
  const now = new Date('2026-11-27T06:00:00.000Z')

  it('uses the current India day and the immediately preceding period', () => {
    expect(salesPeriodWindows('day', now)).toMatchObject({
      current: {
        from: '2026-11-26T18:30:00.000Z',
        to: '2026-11-27T18:30:00.000Z',
      },
      previous: {
        from: '2026-11-25T18:30:00.000Z',
        to: '2026-11-26T18:30:00.000Z',
      },
      currentFromDate: '2026-11-27',
      currentToDate: '2026-11-27',
      previousFromDate: '2026-11-26',
      previousToDate: '2026-11-26',
    })
  })

  it('returns seven and thirty daily buckets for longer periods', () => {
    expect(salesPeriodWindows('week', now).days).toBe(7)
    expect(salesPeriodWindows('month', now).days).toBe(30)
  })
})

describe('summarizeSales', () => {
  it('totals quoted bookings into India-local daily and service buckets', () => {
    const rows: SalesOrder[] = [
      {
        service_code: 'water',
        quoted_amount_paise: 12500,
        created_at: '2026-11-26T19:00:00.000Z',
      },
      {
        service_code: 'water',
        quoted_amount_paise: 2500,
        created_at: '2026-11-27T03:00:00.000Z',
      },
      {
        service_code: 'sewage',
        quoted_amount_paise: 9000,
        created_at: '2026-11-27T06:00:00.000Z',
      },
    ]

    expect(summarizeSales(rows, '2026-11-27', 2)).toEqual({
      totalPaise: 24000,
      orderCount: 3,
      dailyTotalsPaise: [24000, 0],
      breakdown: [
        { serviceCode: 'water', orders: 2, amountPaise: 15000 },
        { serviceCode: 'sewage', orders: 1, amountPaise: 9000 },
      ],
    })
  })

  describe('salesRowsFromFulfilments', () => {
    it('uses item quotes and excludes legacy fulfilments already counted as bookings', () => {
      const rows = salesRowsFromFulfilments(
        [
          {
            id: 'fulfilment-1',
            legacy_booking_id: 'booking-1',
            created_at: '2026-11-27T06:00:00.000Z',
            order_fulfilment_items: [
              {
                order_items: {
                  locked_price_paise: 12500,
                  delivery_charge_paise: 500,
                  discount_paise: 1000,
                  service_types: { code: 'water' },
                },
              },
              {
                order_items: [{
                  locked_price_paise: 8000,
                  delivery_charge_paise: 0,
                  discount_paise: 0,
                  service_types: { code: 'sewage' },
                }],
              },
            ],
          },
          {
            id: 'fulfilment-2',
            created_at: '2026-11-27T06:00:00.000Z',
            order_fulfilment_items: [
              {
                order_items: {
                  locked_price_paise: 1000,
                  service_types: { code: 'water' },
                },
              },
              {
                order_items: {
                  locked_price_paise: 2000,
                  delivery_charge_paise: 200,
                  discount_paise: 100,
                  service_types: { code: 'sewage' },
                },
              },
            ],
          },
        ],
        new Set(['booking-1']),
      )

      expect(rows).toEqual([
        {
          id: 'fulfilment-2',
          legacyBookingId: undefined,
          service_code: 'water',
          quoted_amount_paise: 1000,
          created_at: '2026-11-27T06:00:00.000Z',
        },
        {
          id: 'fulfilment-2',
          legacyBookingId: undefined,
          service_code: 'sewage',
          quoted_amount_paise: 2100,
          created_at: '2026-11-27T06:00:00.000Z',
        },
      ])
    })
  })

  it('rejects invalid quote amounts instead of returning a success-shaped total', () => {
    expect(() => summarizeSales([
      {
        service_code: 'water',
        quoted_amount_paise: -1,
        created_at: '2026-11-27T00:00:00.000Z',
      },
    ], '2026-11-27', 1)).toThrow('Booking quote amount is invalid.')
  })
})
