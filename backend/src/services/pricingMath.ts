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

function capacityFactor(serviceId: string, capacity?: string) {
  if (!['water_tanker', 'sewage_tanker', 'emergency_water', 'empty_tanker'].includes(serviceId)) return 1
  const match = capacity?.match(/^\s*([\d,.]+)\s*(kl|k l|litres?|l)?\s*$/i)
  if (!match) return 1
  const value = Number((match[1] ?? '0').replace(/,/g, ''))
  const litres = value * (match[2]?.toLowerCase().replace(/\s/g, '') === 'kl' ? 1000 : 1)
  const baseline = serviceId === 'empty_tanker' ? 6000 : 3000
  return Number.isFinite(litres) && litres > 0 ? litres / baseline : 1
}

function depthFactor(serviceId: string, depth?: string) {
  const value = Number(depth)
  return serviceId === 'borewell_service' && Number.isFinite(value) && value > 0 ? value / 100 : 1
}

export function sumServiceItemPrices(items: PriceableServiceItem[], services: ServicePrice[]) {
  const pricesByCode = new Map(services.map((service) => [service.code, Number(service.base_price_paise)]))
  const surchargesByCode = new Map(services.map((service) => [service.code, service.config?.optionSurchargesPaise ?? {}]))
  return items.reduce((sum, item) => {
    const serviceId = typeof item === 'string' ? item : item.serviceId
    const unitValue = typeof item === 'string' ? undefined : tankerServices.has(serviceId) ? item.tankerCount : quantityServices.has(serviceId) ? item.quantity : undefined
    const units = Number(unitValue || 1)
    const capacityMultiplier = typeof item === 'string' ? 1 : capacityFactor(serviceId, item.capacity)
    const depthMultiplier = typeof item === 'string' ? 1 : depthFactor(serviceId, item.depth)
    const safeUnits = Number.isFinite(units) && units > 0 ? units : 1
    const optionSurcharges = typeof item === 'string' ? {} : surchargesByCode.get(serviceId) ?? {}
    const surchargePaise = typeof item === 'string' ? 0 : pricedOptions.reduce((optionTotal, field) => {
      const value = item[field]
      if (!value) return optionTotal
      const surcharge = Number(optionSurcharges[field]?.[value] ?? 0)
      return optionTotal + (Number.isFinite(surcharge) && surcharge > 0 ? surcharge : 0)
    }, 0)
    return sum + Math.round(((pricesByCode.get(serviceId) ?? 0) * capacityMultiplier * depthMultiplier + surchargePaise) * safeUnits)
  }, 0)
}
