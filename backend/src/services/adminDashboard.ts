export const ACTIVE_BOOKING_STATUSES = [
  'pending_vendor',
  'vendor_assigned',
  'accepted',
  'en_route',
  'arrived',
] as const

type AvailabilityResource = {
  is_active?: boolean | null
  verification?: string | null
}

export type VendorAvailabilityRecord = {
  service_zone?: string | null
  is_online?: boolean | null
  verification?: string | null
  vehicles?: AvailabilityResource[] | null
  drivers?: AvailabilityResource[] | null
}

export type AreaAvailability = {
  area: string
  onlineVendors: number
  activeVehicles: number
  activeDrivers: number
}

export function indiaDayBounds(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value)
  const localMidnightUtc = Date.UTC(part('year'), part('month') - 1, part('day')) - 330 * 60_000
  return {
    from: new Date(localMidnightUtc).toISOString(),
    to: new Date(localMidnightUtc + 24 * 60 * 60_000).toISOString(),
  }
}

export function groupAvailabilityByArea(vendors: VendorAvailabilityRecord[]): AreaAvailability[] {
  const records = vendors.map((vendor) => {
    const area = (vendor.service_zone ?? '').trim().replace(/\s+/g, ' ') || 'Unassigned area'
    return { vendor, area }
  }).sort((left, right) =>
    left.area.localeCompare(right.area, 'en-IN', { sensitivity: 'base' }),
  )
  const grouped = new Map<string, AreaAvailability>()

  for (const { vendor, area } of records) {
    const key = area.toLocaleLowerCase('en-IN')
    const summary = grouped.get(key) ?? {
      area,
      onlineVendors: 0,
      activeVehicles: 0,
      activeDrivers: 0,
    }

    if (vendor.is_online === true && vendor.verification === 'approved') {
      summary.onlineVendors += 1
    }
    summary.activeVehicles += (vendor.vehicles ?? []).filter(
      (vehicle) => vehicle.is_active === true && vehicle.verification === 'approved',
    ).length
    summary.activeDrivers += (vendor.drivers ?? []).filter(
      (driver) => driver.is_active === true && driver.verification === 'approved',
    ).length

    grouped.set(key, summary)
  }

  return [...grouped.values()].sort((left, right) =>
    left.area.localeCompare(right.area, 'en-IN', { sensitivity: 'base' }),
  )
}
