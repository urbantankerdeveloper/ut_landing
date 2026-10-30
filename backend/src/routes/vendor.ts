import { Router } from 'express'
import { requireAuth, requireRole } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
const router = Router(); router.use(requireAuth, requireRole('vendor'))
type BookingServiceDetail = { serviceId: string; capacity?: string; waterType?: string; tankerCount?: string; serviceType?: string; quantity?: string; depth?: string; grade?: string; pump?: string; pickupLocation?: string; materialType?: string; details?: string; deliveryDate?: string; preferredTime?: string; location?: string }
type BookingRecord = { id: string; reference: string; service_code: string; service_details?: BookingServiceDetail[] | null; address_text: string; latitude?: number | null; longitude?: number | null; quoted_amount_paise?: number | null; status: string; vendor_id?: string | null; vehicle_id?: string | null; driver_id?: string | null; created_at: string; scheduled_for?: string | null }
type RelatedRecord = { id: string; name?: string; registration_number?: string }
type OrderOffer = { event_type: string; distanceKm?: number }
const statusMap: Record<string, 'Available' | 'Assigned' | 'Accepted' | 'En route' | 'Arrived' | 'Delivered' | 'Rejected' | 'Unavailable'> = { pending_vendor: 'Available', vendor_assigned: 'Assigned', accepted: 'Accepted', en_route: 'En route', arrived: 'Arrived', delivered: 'Delivered', cancelled: 'Rejected' }
function formatAmount(amountPaise?: number | null) { return `₹${(Number(amountPaise ?? 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` }
function normalizeOrder(order: BookingRecord, vendorId: string, offer: OrderOffer | undefined, services: Map<string, string>, vehicles: Map<string, string>, drivers: Map<string, string>) {
  const serviceDetails = order.service_details?.map((item) => ({
    service: services.get(item.serviceId) ?? item.serviceId,
    capacity: item.capacity,
    waterType: item.waterType,
    tankerCount: item.tankerCount,
    serviceType: item.serviceType,
    quantity: item.quantity,
    depth: item.depth,
    grade: item.grade,
    pump: item.pump,
    pickupLocation: item.pickupLocation,
    materialType: item.materialType,
    details: item.details,
    deliveryDate: item.deliveryDate,
    preferredTime: item.preferredTime,
    location: item.location,
  })) ?? []
  return {
    id: order.id,
    reference: order.reference,
    service: serviceDetails.map((item) => item.service).join(', ') || services.get(order.service_code) || order.service_code,
    serviceDetails,
    location: order.address_text,
    latitude: order.latitude,
    longitude: order.longitude,
    distance: offer?.distanceKm,
    amount: formatAmount(order.quoted_amount_paise),
    status: offer?.event_type === 'vendor_order_taken' || Boolean(order.vendor_id && order.vendor_id !== vendorId) ? 'Unavailable' : statusMap[order.status] ?? 'Available',
    statusMessage: offer?.event_type === 'vendor_order_taken' || Boolean(order.vendor_id && order.vendor_id !== vendorId) ? 'Already accepted by another vendor.' : undefined,
    vehicle: order.vehicle_id ? vehicles.get(order.vehicle_id) : undefined,
    driver: order.driver_id ? drivers.get(order.driver_id) : undefined,
    scheduledFor: order.scheduled_for,
    createdAt: order.created_at,
  }
}
async function loadVendorOrders(vendorId: string, offset = 0, pageSize?: number) {
  const { data: vendor, error: vendorError } = await supabase.from('vendors').select('owner_profile_id').eq('id', vendorId).single()
  if (vendorError) return { data: null, error: vendorError, hasMore: false }
  const [assignedResult, offersResult] = await Promise.all([
    supabase.from('bookings').select('id,reference,service_code,service_details,address_text,latitude,longitude,quoted_amount_paise,status,vendor_id,vehicle_id,driver_id,created_at,scheduled_for').eq('vendor_id', vendorId).order('created_at', { ascending: false }).limit(200),
    vendor.owner_profile_id ? supabase.from('notifications').select('event_type,payload,created_at').eq('recipient_id', vendor.owner_profile_id).in('event_type', ['vendor_order_created', 'vendor_order_taken']).order('created_at', { ascending: false }).limit(200) : Promise.resolve({ data: [], error: null }),
  ])
  if (assignedResult.error || offersResult.error) return { data: null, error: assignedResult.error ?? offersResult.error, hasMore: false }
  const offerByBooking = new Map<string, OrderOffer>()
  const offeredIds: string[] = []
  for (const notification of offersResult.data ?? []) {
    const payload = (notification.payload ?? {}) as { bookingId?: string; distanceKm?: number }
    if (!payload.bookingId || offerByBooking.has(payload.bookingId)) continue
    offeredIds.push(payload.bookingId)
    offerByBooking.set(payload.bookingId, { event_type: notification.event_type, distanceKm: payload.distanceKm })
  }
  const offeredResult = offeredIds.length
    ? await supabase.from('bookings').select('id,reference,service_code,service_details,address_text,latitude,longitude,quoted_amount_paise,status,vendor_id,vehicle_id,driver_id,created_at,scheduled_for').in('id', offeredIds)
    : { data: [], error: null }
  if (offeredResult.error) return { data: null, error: offeredResult.error, hasMore: false }
  const orderById = new Map<string, BookingRecord>()
  for (const order of (assignedResult.data ?? []) as BookingRecord[]) orderById.set(order.id, order)
  for (const order of (offeredResult.data ?? []) as BookingRecord[]) orderById.set(order.id, order)
  const allOrders = [...orderById.values()].sort((first, second) => second.created_at.localeCompare(first.created_at))
  const hasMore = Boolean(pageSize && allOrders.length > offset + pageSize)
  const orders = pageSize ? allOrders.slice(offset, offset + pageSize) : allOrders
  const serviceCodes = [...new Set(orders.flatMap((order) => [order.service_code, ...(order.service_details ?? []).map((item) => item.serviceId)]))]
  const vehicleIds = [...new Set(orders.map((order) => order.vehicle_id).filter((id): id is string => Boolean(id)))]
  const driverIds = [...new Set(orders.map((order) => order.driver_id).filter((id): id is string => Boolean(id)))]
  const [servicesResult, vehiclesResult, driversResult] = await Promise.all([
    supabase.from('service_catalog').select('code,name').in('code', serviceCodes),
    vehicleIds.length ? supabase.from('vehicles').select('id,registration_number').in('id', vehicleIds).eq('vendor_id', vendorId) : Promise.resolve({ data: [], error: null }),
    driverIds.length ? supabase.from('drivers').select('id,name').in('id', driverIds).eq('vendor_id', vendorId) : Promise.resolve({ data: [], error: null }),
  ])
  if (servicesResult.error || vehiclesResult.error || driversResult.error) return { data: null, error: servicesResult.error ?? vehiclesResult.error ?? driversResult.error, hasMore: false }
  const services = new Map((servicesResult.data ?? []).map((service) => [service.code, service.name]))
  const vehicles = new Map((vehiclesResult.data as RelatedRecord[] ?? []).map((vehicle) => [vehicle.id, vehicle.registration_number ?? vehicle.id]))
  const drivers = new Map((driversResult.data as RelatedRecord[] ?? []).map((driver) => [driver.id, driver.name ?? driver.id]))
  return { data: orders.map((order) => normalizeOrder(order, vendorId, offerByBooking.get(order.id), services, vehicles, drivers)), error: null, hasMore }
}
router.get('/dashboard', async (request, response) => { const { data: vendor } = await supabase.from('vendors').select('id').eq('owner_profile_id', request.authUser!.id).single(); if (!vendor) return response.status(404).json({ error: 'Vendor profile not found' }); const [ordersResult, vehiclesResult, driversResult] = await Promise.all([loadVendorOrders(vendor.id, 0, 100), supabase.from('vehicles').select('id,registration_number,capacity_litres,is_active,verification').eq('vendor_id', vendor.id).order('registration_number'), supabase.from('drivers').select('id,name,mobile_e164,is_active,verification').eq('vendor_id', vendor.id).order('name')]); const queryError = ordersResult.error ?? vehiclesResult.error ?? driversResult.error; if (queryError) return response.status(500).json({ error: queryError.message }); response.json({ orders: ordersResult.data ?? [], vehicles: vehiclesResult.data ?? [], drivers: driversResult.data ?? [] }) })
router.get('/orders', async (request, response) => {
  const { data: vendor } = await supabase.from('vendors').select('id').eq('owner_profile_id', request.authUser!.id).single()
  if (!vendor) return response.status(404).json({ error: 'Vendor profile not found' })
  const offset = Number(request.query.offset ?? 0)
  const pageSize = Number(request.query.pageSize ?? 100)
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return response.status(400).json({ error: 'Invalid order page' })
  const { data, error, hasMore } = await loadVendorOrders(vendor.id, offset, pageSize)
  if (error) return response.status(500).json({ error: error.message })
  response.json({ rows: data ?? [], nextOffset: hasMore ? offset + pageSize : null })
})
router.get('/vehicles', async (request, response) => { const { data: vendor } = await supabase.from('vendors').select('id').eq('owner_profile_id', request.authUser!.id).single(); if (!vendor) return response.status(404).json({ error: 'Vendor profile not found' }); const { data, error } = await supabase.from('vehicles').select('id,registration_number,capacity_litres,is_active,verification').eq('vendor_id', vendor.id).order('registration_number'); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.get('/drivers', async (request, response) => { const { data: vendor } = await supabase.from('vendors').select('id').eq('owner_profile_id', request.authUser!.id).single(); if (!vendor) return response.status(404).json({ error: 'Vendor profile not found' }); const { data, error } = await supabase.from('drivers').select('id,name,mobile_e164,is_active,verification').eq('vendor_id', vendor.id).order('name'); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
router.get('/services', async (request, response) => { const { data: vendor } = await supabase.from('vendors').select('id').eq('owner_profile_id', request.authUser!.id).single(); if (!vendor) return response.status(404).json({ error: 'Vendor profile not found' }); const { data, error } = await supabase.from('service_catalog').select('*').eq('is_active', true).order('name'); if (error) return response.status(500).json({ error: error.message }); const { data: availability, error: availabilityError } = await supabase.from('vendor_service_availability').select('service_code,is_enabled').eq('vendor_id', vendor.id); if (availabilityError) return response.status(500).json({ error: availabilityError.message }); const enabled = new Map((availability ?? []).map((item) => [item.service_code, item.is_enabled])); response.json((data ?? []).map((service) => ({ ...service, vendor_enabled: enabled.has(service.code) ? enabled.get(service.code) : true }))) })
router.get('/payouts', async (request, response) => { const { data: vendor } = await supabase.from('vendors').select('id').eq('owner_profile_id', request.authUser!.id).single(); if (!vendor) return response.status(404).json({ error: 'Vendor profile not found' }); const { data, error } = await supabase.from('vendor_payouts').select('*').eq('vendor_id', vendor.id).order('created_at', { ascending: false }); if (error) return response.status(500).json({ error: error.message }); response.json(data ?? []) })
export default router
