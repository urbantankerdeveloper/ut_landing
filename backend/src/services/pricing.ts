import { supabase } from '../supabase.js'
import { sumServiceItemPrices, type PriceableServiceItem } from './pricingMath.js'

export const GST_RATE = 0.18

export async function quoteServices(items: PriceableServiceItem[], couponCode?: string) {
  const serviceItems = items.map((item) => typeof item === 'string' ? { serviceId: item } : item)
  const codes = serviceItems.map((item) => item.serviceId.trim()).filter(Boolean)
  const { data: services, error: servicesError } = await supabase.from('service_catalog').select('code,base_price_paise,config').in('code', codes).eq('is_active', true)
  if (servicesError) throw new Error(servicesError.message)
  if (!services || services.length !== new Set(codes).size) throw new Error('One or more selected services are unavailable')
  const subtotalPaise = sumServiceItemPrices(serviceItems, services)
  const gstPaise = Math.round(subtotalPaise * GST_RATE)
  let discountPaise = 0
  if (couponCode?.trim()) {
    const { data: coupon } = await supabase.from('coupons').select('discount_type,discount_value').eq('code', couponCode.trim().toUpperCase()).eq('is_active', true).maybeSingle()
    if (!coupon) throw new Error('Coupon is not available')
    const value = Number(coupon.discount_value)
    discountPaise = coupon.discount_type === 'percentage' ? Math.round(subtotalPaise * value / 100) : Math.round(value * 100)
    discountPaise = Math.min(Math.max(discountPaise, 0), subtotalPaise + gstPaise)
  }
  return { subtotalPaise, gstPaise, discountPaise, totalPaise: Math.max(0, subtotalPaise + gstPaise - discountPaise) }
}
