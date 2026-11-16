import { config } from '../config.js'
import { supabase } from '../supabase.js'
import { allocateServiceAmountsPaise, assertPayableAmount, istToday, isServiceInEffectiveWindow, PricingError, serviceItemPrices, sumServiceItemPrices, type PriceableServiceItem } from './pricingMath.js'

// Test mode (TEST_PRICING_ENABLED=true) charges each service line this flat amount with no GST.
export const TEST_PRICING_PER_SERVICE_PAISE = 100
export const GST_PERCENTAGE = config.TEST_PRICING_ENABLED ? 0 : config.APPLIED_GST_PERCENTAGE
export const GST_RATE = GST_PERCENTAGE / 100
// Null when test pricing is off, so clients only override their estimates when it is on.
export function testPricingPerServicePaise() {
  return config.TEST_PRICING_ENABLED ? TEST_PRICING_PER_SERVICE_PAISE : null
}

type ServiceQuote = {
  subtotalPaise: number
  gstPaise: number
  gstRate: number
  discountPaise: number
  totalPaise: number
  couponId: string | undefined
  serviceAmountsPaise?: number[]
  invoiceLineItems?: InvoiceLineSnapshot[]
}

export type InvoiceLineSnapshot = {
  serviceCode: string
  description: string
  quantity: number
  subtotalPaise: number
  taxPaise: number
  taxRate: number
  discountPaise: number
  totalPaise: number
}

function buildInvoiceLineItems(
  items: PriceableServiceItem[],
  services: { code: string; name?: string }[],
  taxPaise: number,
  taxRate: number,
  discountPaise: number,
  itemSubtotals: number[],
): InvoiceLineSnapshot[] {
  const taxByItem = taxPaise > 0
    ? allocateServiceAmountsPaise(taxPaise, itemSubtotals)
    : itemSubtotals.map(() => 0)
  const grossByItem = itemSubtotals.map((amount, index) => amount + taxByItem[index]!)
  const discountByItem = discountPaise > 0
    ? allocateServiceAmountsPaise(discountPaise, grossByItem)
    : itemSubtotals.map(() => 0)
  const serviceByCode = new Map(services.map((service) => [service.code, service]))
  return items.map((item, index) => {
    const serviceCode = typeof item === 'string' ? item : item.serviceId
    const service = serviceByCode.get(serviceCode)
    const detail = typeof item === 'string'
      ? []
      : [item.capacity, item.waterType, item.serviceType, item.grade, item.pump, item.materialType, item.depth]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    const quantity = typeof item === 'string'
      ? 1
      : Number((item.tankerCount ?? item.quantity ?? '1').trim())
    const itemSubtotalPaise = itemSubtotals[index]!
    const itemTaxPaise = taxByItem[index]!
    const itemDiscountPaise = discountByItem[index]!
    return {
      serviceCode,
      description: [service?.name ?? serviceCode, ...detail].join(' · '),
      quantity,
      subtotalPaise: itemSubtotalPaise,
      taxPaise: itemTaxPaise,
      taxRate,
      discountPaise: itemDiscountPaise,
      totalPaise: itemSubtotalPaise + itemTaxPaise - itemDiscountPaise,
    }
  })
}

// A customer with an active recurring subscription or an active membership pays no GST.
export async function customerHasGstWaiver(customerId: string) {
  const [subscription, membership] = await Promise.all([
    supabase.from('subscriptions').select('id').eq('customer_id', customerId).eq('status', 'active').limit(1).maybeSingle(),
    supabase.from('customer_memberships').select('id').eq('customer_id', customerId).eq('status', 'active').limit(1).maybeSingle(),
  ])
  if (subscription.error || membership.error) throw new Error('GST eligibility could not be checked')
  return Boolean(subscription.data || membership.data)
}

export async function quoteServices(items: PriceableServiceItem[], couponCode?: string, customerId?: string, includeServiceAmounts = false, includeInvoiceLineItems = false): Promise<ServiceQuote> {
  const serviceItems = items.map((item) => typeof item === 'string' ? { serviceId: item } : item)
  const codes = serviceItems.map((item) => item.serviceId.trim()).filter(Boolean)
  const { data: services, error: servicesError } = await supabase.from('service_catalog').select('code,name,base_price_paise,config').in('code', codes).eq('is_active', true)
  if (servicesError) throw new Error('Service prices could not be loaded')
  const today = istToday()
  const activeServices = (services ?? []).filter((service) => isServiceInEffectiveWindow(service.config, today))
  if (activeServices.length !== new Set(codes).size) throw new PricingError('One or more selected services are unavailable')
  const subtotalPaise = sumServiceItemPrices(serviceItems, activeServices)
  if (config.TEST_PRICING_ENABLED) {
    const testSubtotalPaise = TEST_PRICING_PER_SERVICE_PAISE * serviceItems.length
    const quote = { subtotalPaise: testSubtotalPaise, gstPaise: 0, gstRate: 0, discountPaise: 0, totalPaise: testSubtotalPaise, couponId: undefined }
    return {
      ...quote,
      ...(includeServiceAmounts ? { serviceAmountsPaise: serviceItems.map(() => TEST_PRICING_PER_SERVICE_PAISE) } : {}),
      ...(includeInvoiceLineItems ? {
        invoiceLineItems: buildInvoiceLineItems(
          serviceItems,
          activeServices,
          0,
          0,
          0,
          serviceItems.map(() => TEST_PRICING_PER_SERVICE_PAISE),
        ),
      } : {}),
    }
  }
  const gstWaived = customerId ? await customerHasGstWaiver(customerId) : false
  const appliedGstRate = gstWaived ? 0 : GST_RATE
  const gstPaise = Math.round(subtotalPaise * appliedGstRate)
  let discountPaise = 0
  let couponId: string | undefined
  if (couponCode?.trim()) {
    const { data: coupon, error: couponError } = await supabase.from('coupons').select('id,discount_type,discount_value,valid_until').eq('code', couponCode.trim().toUpperCase()).eq('is_active', true).or('valid_until.is.null,valid_until.gte.' + new Date().toISOString()).maybeSingle()
    if (couponError) throw new Error('Coupon could not be checked')
    if (!coupon || (coupon.valid_until && new Date(coupon.valid_until).getTime() <= Date.now())) throw new PricingError('Coupon is not available')
    if (customerId) {
      const { data: redemption, error: redemptionError } = await supabase.from('coupon_redemptions').select('coupon_id').eq('coupon_id', coupon.id).eq('customer_id', customerId).maybeSingle()
      if (redemptionError) throw new Error('Coupon could not be checked')
      if (redemption) throw new PricingError('This coupon has already been used on this account.')
    }
    couponId = coupon.id
    const value = Number(coupon.discount_value)
    discountPaise = coupon.discount_type === 'percentage' ? Math.round(subtotalPaise * value / 100) : Math.round(value * 100)
    discountPaise = Math.min(Math.max(discountPaise, 0), subtotalPaise + gstPaise)
  }
  const totalPaise = assertPayableAmount(Math.max(0, subtotalPaise + gstPaise - discountPaise))
  const quote = { subtotalPaise, gstPaise, gstRate: appliedGstRate, discountPaise, totalPaise, couponId }
  const itemSubtotals = includeServiceAmounts || includeInvoiceLineItems
    ? serviceItemPrices(serviceItems, activeServices)
    : []
  return {
    ...quote,
    ...(includeServiceAmounts ? { serviceAmountsPaise: allocateServiceAmountsPaise(totalPaise, itemSubtotals) } : {}),
    ...(includeInvoiceLineItems ? {
      invoiceLineItems: buildInvoiceLineItems(
        serviceItems,
        activeServices,
        gstPaise,
        appliedGstRate,
        discountPaise,
        itemSubtotals,
      ),
    } : {}),
  }
}
