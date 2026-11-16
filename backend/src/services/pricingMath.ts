export type OptionSurchargesPaise = Record<string, Record<string, number>>
export type PriceableServiceItem = string | {
  serviceId: string
  quantity?: string
  tankerCount?: string
  capacity?: string
  depth?: string
  waterType?: string
  serviceType?: string
  grade?: string
  pump?: string
  materialType?: string
}

export type ServicePrice = { code: string; base_price_paise: number; config?: { optionSurchargesPaise?: OptionSurchargesPaise | null } | null }

const tankerServices = new Set(['water_tanker', 'sewage_tanker', 'emergency_water', 'empty_tanker'])
const quantityServices = new Set(['drinking_water', 'tank_cleaning', 'rmc_mix'])
const pricedOptions = ['capacity', 'waterType', 'serviceType', 'grade', 'pump', 'materialType'] as const
const maxUnits = 50
const maxCapacityLitres = 100_000
const maxDepth = 1000
export const maxPayablePaise = 100_000_000
export const DEFAULT_VENDOR_SHARE_RATE = 0.85

export class PricingError extends Error {}

export function vendorAccrualPaise(quotedAmountPaise: number) {
  if (!Number.isSafeInteger(quotedAmountPaise) || quotedAmountPaise < 0) {
    throw new PricingError('The vendor accrual amount is invalid.')
  }
  return Math.round(quotedAmountPaise * DEFAULT_VENDOR_SHARE_RATE)
}

export function assertPayableAmount(amountPaise: number) {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > maxPayablePaise) throw new PricingError('The booking total is outside the payable range.')
  return amountPaise
}

export function istToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

export function isServiceInEffectiveWindow(config: { effectiveFrom?: string | null; effectiveTo?: string | null } | null | undefined, today: string) {
  return (config?.effectiveFrom ?? '0000-01-01') <= today && today <= (config?.effectiveTo ?? '9999-12-31')
}

function capacityFactor(serviceId: string, capacity?: string) {
  if (!['water_tanker', 'sewage_tanker', 'emergency_water', 'empty_tanker'].includes(serviceId)) return 1
  const match = capacity?.match(/^\s*([\d,.]+)\s*(kl|k l|litres?|l)?\s*$/i)
  if (!match) return 1
  const value = Number((match[1] ?? '0').replace(/,/g, ''))
  const litres = value * (match[2]?.toLowerCase().replace(/\s/g, '') === 'kl' ? 1000 : 1)
  if (!Number.isFinite(litres) || litres <= 0 || litres > maxCapacityLitres) throw new PricingError('Tanker capacity is outside the supported range.')
  const baseline = serviceId === 'empty_tanker' ? 6000 : 3000
  return litres / baseline
}

function depthFactor(serviceId: string, depth?: string) {
  const trimmed = depth?.trim()
  if (!trimmed) return 1
  const value = Number(trimmed)
  if (!Number.isFinite(value) || value < 1 || value > maxDepth) throw new PricingError('Depth must be between 1 and 1000 ft.')
  return serviceId === 'borewell_service' ? value / 100 : 1
}

function unitsFor(serviceId: string, item: Exclude<PriceableServiceItem, string>) {
  const value = (tankerServices.has(serviceId) ? item.tankerCount : quantityServices.has(serviceId) ? item.quantity : undefined)?.trim()
  if (!value) return 1
  const units = Number(value)
  if (!Number.isInteger(units) || units < 1 || units > maxUnits) throw new PricingError('Quantity must be a whole number from 1 to 50.')
  return units
}

export function serviceItemPrices(items: PriceableServiceItem[], services: ServicePrice[]) {
  const pricesByCode = new Map(services.map((service) => [service.code, Number(service.base_price_paise)]))
  const surchargesByCode = new Map(services.map((service) => [service.code, service.config?.optionSurchargesPaise ?? {}]))
  return items.map((item) => {
    const serviceId = typeof item === 'string' ? item : item.serviceId
    const units = typeof item === 'string' ? 1 : unitsFor(serviceId, item)
    const capacityMultiplier = typeof item === 'string' ? 1 : capacityFactor(serviceId, item.capacity)
    const depthMultiplier = typeof item === 'string' ? 1 : depthFactor(serviceId, item.depth)
    const optionSurcharges = typeof item === 'string' ? {} : surchargesByCode.get(serviceId) ?? {}
    const surchargePaise = typeof item === 'string' ? 0 : pricedOptions.reduce((optionTotal, field) => {
      const value = item[field]
      if (!value) return optionTotal
      const surcharge = Number(optionSurcharges[field]?.[value] ?? 0)
      return optionTotal + (Number.isFinite(surcharge) && surcharge > 0 ? surcharge : 0)
    }, 0)
    return Math.round(((pricesByCode.get(serviceId) ?? 0) * capacityMultiplier * depthMultiplier + surchargePaise) * units)
  })
}

export function sumServiceItemPrices(items: PriceableServiceItem[], services: ServicePrice[]) {
  return assertPayableAmount(serviceItemPrices(items, services).reduce((sum, price) => sum + price, 0))
}

export function allocateServiceAmountsPaise(totalPaise: number, weights: number[]) {
  if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0 || !weights.length) {
    throw new PricingError('The service amount allocation is invalid.')
  }
  const totalWeight = weights.reduce((sum, weight) => {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new PricingError('The service amount allocation is invalid.')
    }
    return sum + BigInt(weight)
  }, 0n)
  if (totalWeight <= 0n) throw new PricingError('The service amount allocation is invalid.')
  const total = BigInt(totalPaise)
  const allocations = weights.map((weight) => Number(total * BigInt(weight) / totalWeight))
  const remainders = weights.map((weight, index) => ({
    index,
    remainder: total * BigInt(weight) % totalWeight,
  }))
  const unallocated = totalPaise - allocations.reduce((sum, amount) => sum + amount, 0)
  remainders.sort((first, second) => first.remainder === second.remainder
    ? first.index - second.index
    : first.remainder > second.remainder ? -1 : 1)
  for (let index = 0; index < unallocated; index += 1) {
    const allocationIndex = remainders[index]!.index
    allocations[allocationIndex] = allocations[allocationIndex]! + 1
  }
  return allocations
}

export type SettlementBooking = { id: string; vendor_id: string | null; quoted_amount_paise?: number | string | null }
export type VendorPayoutInput = { vendor_id: string; period_start: string; period_end: string; amount_paise: number; booking_ids: string[] }

export function buildVendorPayouts(bookings: SettlementBooking[], vendorShareRate: number, period: { from: string; to: string }): VendorPayoutInput[] {
  const byVendor = new Map<string, VendorPayoutInput>()
  for (const booking of bookings) {
    if (!booking.vendor_id) continue
    const current = byVendor.get(booking.vendor_id) ?? { vendor_id: booking.vendor_id, period_start: period.from, period_end: period.to, amount_paise: 0, booking_ids: [] }
    current.amount_paise += Math.round(Number(booking.quoted_amount_paise ?? 0) * vendorShareRate)
    current.booking_ids.push(booking.id)
    byVendor.set(booking.vendor_id, current)
  }
  return [...byVendor.values()]
}
