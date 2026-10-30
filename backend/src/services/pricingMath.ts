export type PriceableServiceItem = string | { serviceId: string; quantity?: string; tankerCount?: string; capacity?: string; depth?: string }

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

export function sumServiceItemPrices(items: PriceableServiceItem[], services: { code: string; base_price_paise: number }[]) {
  const pricesByCode = new Map(services.map((service) => [service.code, Number(service.base_price_paise)]))
  return items.reduce((sum, item) => {
    const serviceId = typeof item === 'string' ? item : item.serviceId
    const units = typeof item === 'string' ? 1 : Number(item.tankerCount || item.quantity || 1)
    const capacityMultiplier = typeof item === 'string' ? 1 : capacityFactor(serviceId, item.capacity)
    const depthMultiplier = typeof item === 'string' ? 1 : depthFactor(serviceId, item.depth)
    const safeUnits = Number.isFinite(units) && units > 0 ? units : 1
    return sum + Math.round((pricesByCode.get(serviceId) ?? 0) * capacityMultiplier * depthMultiplier * safeUnits)
  }, 0)
}
