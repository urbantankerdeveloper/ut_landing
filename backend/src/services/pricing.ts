import { config } from '../config.js'
import { supabase } from '../supabase.js'
import { assertPayableAmount, istToday, isServiceInEffectiveWindow, PricingError, sumServiceItemPrices, type PriceableServiceItem } from './pricingMath.js'

export const GST_PERCENTAGE = config.APPLIED_GST_PERCENTAGE
export const GST_RATE = GST_PERCENTAGE / 100

// A customer with an active recurring subscription or an active membership pays no GST.
export async function customerHasGstWaiver(customerId: string) {
  const [subscription, membership] = await Promise.all([
    supabase.from('subscriptions').select('id').eq('customer_id', customerId).eq('status', 'active').limit(1).maybeSingle(),
    supabase.from('customer_memberships').select('id').eq('customer_id', customerId).eq('status', 'active').limit(1).maybeSingle(),
  ])
  if (subscription.error || membership.error) throw new Error('GST eligibility could not be checked')
  return Boolean(subscription.data || membership.data)
}

export async function quoteServices(items: PriceableServiceItem[], couponCode?: string, customerId?: string) {
  const serviceItems = items.map((item) => typeof item === 'string' ? { serviceId: item } : item)
  const codes = serviceItems.map((item) => item.serviceId.trim()).filter(Boolean)
  const { data: services, error: servicesError } = await supabase.from('service_catalog').select('code,base_price_paise,config').in('code', codes).eq('is_active', true)
  if (servicesError) throw new Error('Service prices could not be loaded')
  const today = istToday()
  const activeServices = (services ?? []).filter((service) => isServiceInEffectiveWindow(service.config, today))
  if (activeServices.length !== new Set(codes).size) throw new PricingError('One or more selected services are unavailable')
  const subtotalPaise = sumServiceItemPrices(serviceItems, activeServices)
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
  return { subtotalPaise, gstPaise, gstRate: appliedGstRate, discountPaise, totalPaise, couponId }
}
