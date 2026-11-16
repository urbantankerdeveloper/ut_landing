import { describe, expect, it } from 'vitest'
import { groupAvailabilityByArea, indiaDayBounds } from './adminDashboard.js'

describe('admin dashboard aggregation', () => {
  it('uses India-local day boundaries for captured-payment revenue', () => {
    expect(indiaDayBounds(new Date('2026-11-16T18:00:00.000Z'))).toEqual({
      from: '2026-11-15T18:30:00.000Z',
      to: '2026-11-16T18:30:00.000Z',
    })
  })

  it('groups free-text area variants and counts only approved active resources', () => {
    expect(groupAvailabilityByArea([
      {
        service_zone: ' Chennai  North ',
        is_online: true,
        verification: 'approved',
        vehicles: [
          { is_active: true, verification: 'approved' },
          { is_active: true, verification: 'pending' },
        ],
        drivers: [{ is_active: true, verification: 'approved' }],
      },
      {
        service_zone: 'chennai north',
        is_online: false,
        verification: 'approved',
        vehicles: [{ is_active: true, verification: 'approved' }],
        drivers: [{ is_active: false, verification: 'approved' }],
      },
      {
        service_zone: 'Chennai North',
        is_online: true,
        verification: 'pending',
        vehicles: [],
        drivers: [],
      },
    ])).toEqual([
      {
        area: 'Chennai North',
        onlineVendors: 1,
        activeVehicles: 2,
        activeDrivers: 1,
      },
    ])
  })

  it('keeps resources with missing area data visible in an unassigned bucket', () => {
    expect(groupAvailabilityByArea([{
      service_zone: ' ',
      vehicles: [{ is_active: true, verification: 'approved' }],
    }])).toEqual([{
      area: 'Unassigned area',
      onlineVendors: 0,
      activeVehicles: 1,
      activeDrivers: 0,
    }])
  })
})
