import { Suspense, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { lazyWithRetry } from '../utils/lazyWithRetry'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, Check, CreditCard, Crosshair, MapPin, Phone, Plus, Trash2, Wallet } from 'lucide-react'
import { useAppNavigation } from '../routing/useAppNavigation'
import { useCreateCustomerAddress, useCreateCustomerBooking, useCustomerAddresses, useCustomerOffers, useCustomerPhoneVerification, useCustomerPricing, useCustomerServices } from '../hooks/useCustomerData'
import { useCouponValidation, useRazorpayPayment } from '../hooks/useFrontendFeatures'
import { CheckoutError } from '../utils/razorpayCheckout'
import { PaymentReceiptCard } from '../components/PaymentReceiptCard'
import { useAuthStore } from '../stores/authStore'
import { customerApi, type BookingPaymentMethod, type BookingServiceDetails, type CustomerBooking, type SavedAddress } from '../api/customer'
import { customerDemoDataEnabled } from '../constants/demo'
import { trackEvent } from '../services/analytics'
import type { LatLngLiteral } from 'leaflet'
import { isChennaiDeliveryAddress, lookupDeliveryPoint } from '../services/geocoding'
import { BOOKING_DRAFT_KEY, REPEAT_BOOKING_KEY } from '../constants/bookingDraft'
import { BookingServiceItem, type BookingServiceDraft, type BookingServiceEntry, type BookingServiceField, type BookingServiceFieldErrors } from '../components/booking/BookingServiceItem'
import { BookingHero, BookingProgress, BookingSection, BookingSummary, type BookingSummaryItem } from '../components/booking/BookingPageSections'
import { bookingContent as c } from '../content/booking'

const LocationPickerModal = lazyWithRetry(() => import('../components/LocationPickerModal').then((module) => ({ default: module.LocationPickerModal })))

type Step = 'details' | 'review' | 'payment' | 'success'

type CouponRecord = { discount_type?: string; discount_value?: number | string; discount?: number | string }
type ServiceFieldErrors = BookingServiceFieldErrors & { deliveryDate?: string; location?: string }
type ServiceDraft = BookingServiceDraft & { deliveryDate: string; location: string; latitude?: number; longitude?: number }
const bookingFormSchema = z.object({
  selectedServices: z.array(z.string()).min(1, c.validation.selectService),
  capacity: z.string().optional(),
  phone: z.string().regex(/^\d{10}$/, c.validation.phone),
  notes: z.string().max(500, c.validation.accessNotesMax).optional(),
  paymentMethod: z.enum(['wallet', 'gateway', 'cod'], { error: 'Choose a payment method before booking.' }),
  couponCode: z.string().optional(),
  guestName: z.string().trim().max(60, c.validation.guestNameMax).optional(),
})
type BookingFormValues = z.infer<typeof bookingFormSchema>
type BookingDraft = {
  idempotencyKey?: string
  selectedServices: string[]
  serviceEntries?: BookingServiceEntry[]
  serviceItemsInitialized?: boolean
  serviceDetails: Record<string, ServiceDraft>
  capacity: string
  step: Step
  details: { location?: string; deliveryDate?: string; notes: string }
  locationAddress?: string
  coordinates?: { latitude: number; longitude: number } | null
  locationStatus?: string | null
  paymentMethod?: BookingPaymentMethod
  couponCode: string
  couponDiscount: number
  phone?: string
  guestName: string
  customerName?: string
  sharedDate?: string
  preferredTime?: string
  addressLabel?: string
  addressCity?: string
  addressPincode?: string
  region?: string
  savedAddressId?: string
  saveAddress?: boolean
  phoneChallenges?: Record<string, string>
  guestChallengeId?: string | null
  bookingId: string | null
  quotedTotal: number | null
}

function emptyServiceDraft(): ServiceDraft {
  return { capacity: '', waterType: 'Domestic water', tankerCount: '1', serviceType: '', quantity: '1', depth: '', grade: 'M10', pump: 'No', pickupLocation: '', materialType: '', notes: '', deliveryDate: '', location: '' }
}

function serviceDraftFor(serviceId: string): ServiceDraft {
  const draft = emptyServiceDraft()
  if (serviceId === 'water_tanker') return { ...draft, capacity: '3 KL', serviceType: 'Domestic water' }
  if (serviceId === 'sewage_tanker') return { ...draft, capacity: '3 KL', serviceType: 'Septic tank cleaning' }
  if (serviceId === 'drinking_water') return { ...draft, serviceType: '20 L water cans' }
  if (serviceId === 'emergency_water') return { ...draft, capacity: '3 KL', serviceType: 'Emergency water' }
  if (serviceId === 'tank_cleaning') return { ...draft, serviceType: 'Overhead tank' }
  if (serviceId === 'borewell_service') return { ...draft, serviceType: 'New drilling' }
  if (serviceId === 'empty_tanker') return { ...draft, capacity: '6 KL' }
  return draft
}

function serviceItemErrors(serviceId: string, values: ServiceDraft): ServiceFieldErrors {
  const errors: ServiceFieldErrors = {}
  if (serviceId === 'water_tanker') {
    if (!values.capacity) errors.capacity = c.validation.capacity
    if (!values.waterType) errors.waterType = c.validation.waterType
    if (!values.tankerCount || Number(values.tankerCount) < 1 || Number(values.tankerCount) > 5) errors.tankerCount = c.validation.tankerCount
  } else if (['sewage_tanker', 'emergency_water'].includes(serviceId)) {
    if (!values.serviceType) errors.serviceType = c.validation.serviceType
    if (!values.capacity) errors.capacity = c.validation.capacity
    if (!values.tankerCount || Number(values.tankerCount) < 1 || Number(values.tankerCount) > 5) errors.tankerCount = c.validation.tankerCount
  } else if (['drinking_water', 'tank_cleaning'].includes(serviceId)) {
    if (!values.serviceType) errors.serviceType = c.validation.serviceType
    if (!values.quantity || Number(values.quantity) < 1) errors.quantity = c.validation.quantity
  } else if (serviceId === 'borewell_service') {
    if (!values.serviceType) errors.serviceType = c.validation.borewellService
  } else if (serviceId === 'rmc_mix') {
    if (!values.grade) errors.grade = c.validation.grade
    if (!values.quantity || Number(values.quantity) < 1) errors.quantity = c.validation.concreteQuantity
    if (!values.pump) errors.pump = c.validation.pump
  } else if (serviceId === 'empty_tanker') {
    if (!values.capacity) errors.capacity = c.validation.capacity
    if (!values.tankerCount || Number(values.tankerCount) < 1 || Number(values.tankerCount) > 5) errors.tankerCount = c.validation.tankerCount
    if (!values.pickupLocation.trim()) errors.pickupLocation = c.validation.pickupAddress
    if (!values.materialType.trim()) errors.materialType = c.validation.materialType
  } else if (values.notes.trim().length < 3) {
    errors.notes = c.validation.serviceNotesMin
  }
  if (values.notes.length > 1000) errors.notes = c.validation.serviceNotesMax
  return errors
}

function loadBookingDraft(): Partial<BookingDraft> {
  try {
    const query = new URLSearchParams(window.location.search)
    const repeatedBooking = sessionStorage.getItem(REPEAT_BOOKING_KEY)
    if (repeatedBooking) {
      const booking = JSON.parse(repeatedBooking) as CustomerBooking
      if (Array.isArray(booking.services) && booking.services.length > 0) {
        const serviceEntries = booking.services.map((service, index) => ({ id: `${service.serviceId}-${index + 1}`, serviceId: service.serviceId }))
        const serviceDetails = Object.fromEntries(booking.services.map((service, index) => [
          serviceEntries[index].id,
          { ...emptyServiceDraft(), capacity: service.capacity ?? '', waterType: service.waterType ?? serviceDraftFor(service.serviceId).waterType, tankerCount: service.tankerCount ?? '1', serviceType: service.serviceType ?? serviceDraftFor(service.serviceId).serviceType, quantity: service.quantity ?? '1', depth: service.depth ?? '', grade: service.grade ?? 'M10', pump: service.pump ?? 'No', pickupLocation: service.pickupLocation ?? '', materialType: service.materialType ?? '', notes: service.details ?? '', deliveryDate: service.deliveryDate ?? booking.scheduledAt?.slice(0, 10) ?? '', location: service.location ?? booking.location ?? '', latitude: service.latitude ?? booking.latitude, longitude: service.longitude ?? booking.longitude},
        ]))
        return {
          selectedServices: serviceEntries.map((entry) => entry.serviceId),
          serviceEntries,
          serviceDetails,
          capacity: booking.services[0]?.capacity ?? '',
          step: 'details',
          details: { location: '', notes: booking.notes ?? '' },
          locationAddress: booking.location ?? booking.services[0]?.location ?? '',
          phone: booking.phone?.replace(/\D/g, '').slice(-10) ?? '',
          paymentMethod: booking.paymentMethod ?? 'wallet',
          couponCode: '',
          couponDiscount: 0,
          guestName: '',
          sharedDate: booking.services[0]?.deliveryDate ?? currentDateInputValue(),
          preferredTime: booking.services[0]?.preferredTime ?? '07:00',
          phoneChallenges: {},
          bookingId: null,
          quotedTotal: null,
        }
      }
    }
    const stored = sessionStorage.getItem(BOOKING_DRAFT_KEY)
    if (!stored) {
      const aliases: Record<string, string> = { water: 'water_tanker', sewage: 'sewage_tanker', drinking: 'drinking_water', cleaning: 'tank_cleaning', borewell: 'borewell_service', rmc: 'rmc_mix', empty: 'empty_tanker', emergency: 'emergency_water' }
      const requestedService = query.get('service') ?? ''
      const serviceId = aliases[requestedService] ?? requestedService
      return {
        selectedServices: serviceId ? [serviceId] : [],
        serviceEntries: serviceId ? [{ id: 'query-entry-1', serviceId }] : [],
        serviceDetails: serviceId ? { 'query-entry-1': serviceDraftFor(serviceId) } : {},
        couponCode: query.get('coupon') ?? '',
        sharedDate: query.get('date') ?? currentDateInputValue(),
        preferredTime: '07:00',
        savedAddressId: query.get('address') ?? '',
      }
    }
    const parsed = JSON.parse(stored) as Partial<BookingDraft>
    if (parsed.step === 'success') return {}
    const savedServiceDetails = parsed.serviceDetails ?? {}
    const serviceEntries = parsed.serviceEntries ?? (parsed.selectedServices ?? []).map((serviceId, index) => ({ id: `${serviceId}-${index + 1}`, serviceId }))
    return {
      ...parsed,
      serviceEntries,
      serviceDetails: Object.fromEntries(serviceEntries.map((entry) => {
        const service = savedServiceDetails[entry.id] ?? savedServiceDetails[entry.serviceId]
        return [entry.id, {
          ...emptyServiceDraft(),
          capacity: service?.capacity ?? '',
          waterType: service?.waterType ?? 'Domestic water',
          tankerCount: service?.tankerCount ?? '1',
          serviceType: service?.serviceType ?? '',
          quantity: service?.quantity ?? '1',
          depth: service?.depth ?? '',
          grade: service?.grade ?? 'M10',
          pump: service?.pump ?? 'No',
          pickupLocation: service?.pickupLocation ?? '',
          materialType: service?.materialType ?? '',
          notes: service?.notes ?? '',
          deliveryDate: service?.deliveryDate ?? parsed.details?.deliveryDate ?? '',
          location: service?.location ?? parsed.details?.location ?? parsed.locationAddress ?? '',
          latitude: service?.latitude ?? parsed.coordinates?.latitude,
          longitude: service?.longitude ?? parsed.coordinates?.longitude,
        }]
      })),
      sharedDate: parsed.sharedDate ?? parsed.details?.deliveryDate ?? currentDateInputValue(),
      preferredTime: parsed.preferredTime ?? '07:00',
      phoneChallenges: parsed.phoneChallenges ?? (parsed.guestChallengeId && parsed.phone
        ? { [parsed.phone.replace(/\D/g, '').slice(-10)]: parsed.guestChallengeId }
        : {}),
    }
  } catch {
    return {}
  }
}

function calculateDiscount(coupon: CouponRecord, subtotal: number) {
  const value = Number(coupon.discount_value ?? coupon.discount ?? 0)
  if (!Number.isFinite(value) || value <= 0) return 0
  const isPercentage = ['percentage', 'percent', '%'].includes(String(coupon.discount_type ?? '').toLowerCase())
  return Math.min(isPercentage ? Math.round(subtotal * value / 100) : Math.round(value), subtotal)
}

function estimatedServiceAmount(item: BookingServiceDetails, service: { price: number; optionSurchargesPaise?: Record<string, Record<string, number>> } | undefined, testAmountRupees: number | null = null) {
  if (testAmountRupees !== null) return testAmountRupees
  const basePrice = service?.price ?? 0
  const capacityMatch = item.capacity?.match(/^\s*([\d,.]+)\s*(kl|k l|litres?|l)?\s*$/i)
  const capacityValue = capacityMatch ? Number(capacityMatch[1].replace(/,/g, '')) : 0
  const capacityUnit = capacityMatch?.[2]?.toLowerCase().replace(/\s/g, '')
  const capacityLitres = capacityValue * (capacityUnit === 'kl' ? 1000 : 1)
  const baselineLitres = item.serviceId === 'empty_tanker' ? 6000 : 3000
  const capacityFactor = ['water_tanker', 'sewage_tanker', 'emergency_water', 'empty_tanker'].includes(item.serviceId) && capacityLitres > 0
    ? capacityLitres / baselineLitres
    : 1
  const depth = Number(item.depth)
  const depthFactor = item.serviceId === 'borewell_service' && Number.isFinite(depth) && depth > 0 ? depth / 100 : 1
  const tankerServices = ['water_tanker', 'sewage_tanker', 'emergency_water', 'empty_tanker']
  const quantityServices = ['drinking_water', 'tank_cleaning', 'rmc_mix']
  const units = Number(tankerServices.includes(item.serviceId) ? item.tankerCount : quantityServices.includes(item.serviceId) ? item.quantity : 1) || 1
  const optionSurchargesPaise = service?.optionSurchargesPaise ?? {}
  const surchargePaise = (['capacity', 'waterType', 'serviceType', 'grade', 'pump', 'materialType'] as const).reduce((sum, field) => {
    const selected = item[field]
    const surcharge = selected ? Number(optionSurchargesPaise[field]?.[selected] ?? 0) : 0
    return sum + (Number.isFinite(surcharge) && surcharge > 0 ? surcharge / 100 : 0)
  }, 0)
  return Math.round((basePrice * capacityFactor * depthFactor + surchargePaise) * units)
}

function formatOfferDiscount(offer: CouponRecord) {
  const value = Number(offer.discount_value ?? offer.discount ?? 0)
  if (!Number.isFinite(value) || value <= 0) return c.offers.specialOffer
  return ['percentage', 'percent', '%'].includes(String(offer.discount_type ?? '').toLowerCase())
    ? c.offers.percentOff(value)
    : c.offers.flatOff(value.toLocaleString('en-IN'))
}

function currentDateInputValue() {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

function uniqueAddressParts(parts: string[]) {
  const seen = new Set<string>()
  const [address, region, city, ...remaining] = parts
  const partsWithoutRepeatedCity = [address, region, ...(region?.toLowerCase().includes('chennai') ? [] : [city]), ...remaining].filter(Boolean)
  return partsWithoutRepeatedCity.flatMap((part) => part.split(',').map((token) => token.trim()).filter((token) => {
    const key = token.toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })).join(', ')
}

function createServiceEntryId() {
  return `item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isValidDeliveryDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < currentDateInputValue()) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const DRAFT_PERSIST_DELAY_MS = 300

export default function BookingScreen() {
  const [draft] = useState(loadBookingDraft)
  const { navigate } = useAppNavigation()
  const createBooking = useCreateCustomerBooking()
  const servicesQuery = useCustomerServices()
  const razorpay = useRazorpayPayment()
  const [paymentFailure, setPaymentFailure] = useState<CheckoutError | null>(null)
  const couponValidation = useCouponValidation()
  const user = useAuthStore((state) => state.user)
  const isRegisteredCustomer = Boolean(user && !user.username.startsWith('guest_'))
  const pricingQuery = useCustomerPricing(isRegisteredCustomer)
  const gstPercentage = pricingQuery.data?.gstPercentage
  const gstRate = pricingQuery.data?.gstRate
  const gstWaived = pricingQuery.data?.gstWaived === true
  // Set only when the backend runs in test pricing mode (TEST_PRICING_ENABLED), so every line shows the test amount.
  const testAmountRupees = pricingQuery.data?.testPricingPerServicePaise == null ? null : pricingQuery.data.testPricingPerServicePaise / 100
  const phoneVerificationQuery = useCustomerPhoneVerification(isRegisteredCustomer)
  const addressesQuery = useCustomerAddresses(isRegisteredCustomer)
  const createAddress = useCreateCustomerAddress()
  const signIn = useAuthStore((state) => state.signIn)
  const offersQuery = useCustomerOffers()
  const serviceCatalog = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data])
  const options = useMemo(() => serviceCatalog.map((service) => ({ code: service.code, label: service.name, price: service.base_price_paise / 100, optionSurchargesPaise: service.config?.optionSurchargesPaise })), [serviceCatalog])
  const { control, register, handleSubmit, setValue, getValues, watch, formState: { errors } } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    mode: 'onChange',
    defaultValues: {
      selectedServices: draft.selectedServices ?? [],
      capacity: draft.capacity ?? '',
      phone: draft.phone ?? '',
      notes: draft.details?.notes ?? '',
      paymentMethod: draft.paymentMethod,
      couponCode: draft.couponCode ?? '',
      guestName: draft.guestName ?? user?.name ?? '',
    },
  })
  const phone = useWatch({ control, name: 'phone' }) ?? ''
  const paymentMethod = useWatch({ control, name: 'paymentMethod' })
  const capacity = getValues('capacity') ?? '5000'
  const details = { notes: getValues('notes') ?? '' }
  const couponCode = getValues('couponCode') ?? ''
  const guestName = getValues('guestName') ?? ''
  const [serviceEntries, setServiceEntries] = useState<BookingServiceEntry[]>(draft.serviceEntries ?? (draft.selectedServices ?? []).map((serviceId, index) => ({ id: `item-${index + 1}`, serviceId })))
  const pendingServiceFocusId = useRef<string | null>(null)
  const [hasInitializedServiceEntries, setHasInitializedServiceEntries] = useState(draft.serviceItemsInitialized ?? Boolean(draft.serviceEntries?.length || draft.selectedServices?.length))
  const [confirmRemoveAll, setConfirmRemoveAll] = useState(false)
  const [serviceToAdd, setServiceToAdd] = useState(draft.selectedServices?.[0] ?? '')
  const [step, setStep] = useState<Step>(draft.step ?? 'details')
  const [serviceDetails, setServiceDetails] = useState(draft.serviceDetails ?? {})
  const [sharedDate, setSharedDate] = useState(draft.sharedDate ?? currentDateInputValue())
  const [preferredTime, setPreferredTime] = useState(draft.preferredTime ?? '07:00')
  const [sharedLocation, setSharedLocation] = useState(draft.locationAddress ?? draft.details?.location ?? '')
  const [region, setRegion] = useState(draft.region ?? 'South Chennai')
  const [addressLabel, setAddressLabel] = useState(draft.addressLabel ?? '')
  const [addressCity, setAddressCity] = useState(draft.addressCity ?? 'Chennai')
  const [addressPincode, setAddressPincode] = useState(draft.addressPincode ?? '')
  const [saveAddressForFuture, setSaveAddressForFuture] = useState(draft.saveAddress ?? false)
  const [savedAddressId, setSavedAddressId] = useState(draft.savedAddressId ?? new URLSearchParams(window.location.search).get('address') ?? '')
  const [sharedCoordinates, setSharedCoordinates] = useState<LatLngLiteral | null>(draft.coordinates ? { lat: draft.coordinates.latitude, lng: draft.coordinates.longitude } : null)
  const [reviewConsent, setReviewConsent] = useState(false)
  const [serviceFieldErrors, setServiceFieldErrors] = useState<Record<string, ServiceFieldErrors>>({})
  const [locationModalOpen, setLocationModalOpen] = useState(false)
  const [locationStatus, setLocationStatus] = useState<Record<string, string>>({})
  const [locationToasts, setLocationToasts] = useState<Record<string, string>>({})
  const [locationEligibility, setLocationEligibility] = useState<Record<string, boolean>>({})
  const [couponDiscount, setCouponDiscount] = useState(draft.couponDiscount ?? 0)
  const [couponMessage, setCouponMessage] = useState<string | null>(null)
  const [phoneChallenges, setPhoneChallenges] = useState<Record<string, string>>(draft.phoneChallenges ?? {})
  const [otpChallenges, setOtpChallenges] = useState<Record<string, string>>({})
  const [otpValues, setOtpValues] = useState<Record<string, string>>({})
  const [otpMessages, setOtpMessages] = useState<Record<string, string>>({})
  const [otpPendingPhone, setOtpPendingPhone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [bookingId, setBookingId] = useState<string | null>(draft.bookingId ?? null)
  const [quotedTotal, setQuotedTotal] = useState<number | null>(draft.quotedTotal ?? null)
  const [idempotencyKey] = useState(() => draft.idempotencyKey ?? crypto.randomUUID())
  const selectedServices = useMemo(() => serviceEntries.map((entry) => entry.serviceId), [serviceEntries])
  const activeServiceEntries = useMemo(() => serviceEntries.filter((entry) => options.some((option) => option.code === entry.serviceId)), [serviceEntries, options])
  const availableServiceOptions = useMemo(() => options.filter((option) => !activeServiceEntries.some((entry) => entry.serviceId === option.code)), [activeServiceEntries, options])
  const addServiceLabel = activeServiceEntries.length ? c.selectServices.addAnotherService : c.selectServices.addService
  const selectedServiceToAdd = availableServiceOptions.some((option) => option.code === serviceToAdd)
    ? serviceToAdd
    : availableServiceOptions[0]?.code ?? ''
  const activeServices = activeServiceEntries.map((entry) => entry.serviceId)
  const servicesForQuote = activeServices.length ? activeServices : [options[0]?.code].filter((code): code is string => Boolean(code))
  const sharedDeliveryAddress = uniqueAddressParts([sharedLocation, region, addressCity, addressPincode])
  const serviceItems: BookingServiceDetails[] = activeServiceEntries.map((entry) => ({
    serviceId: entry.serviceId,
    capacity: serviceDetails[entry.id]?.capacity ?? '',
    waterType: serviceDetails[entry.id]?.waterType,
    tankerCount: serviceDetails[entry.id]?.tankerCount,
    serviceType: serviceDetails[entry.id]?.serviceType,
    quantity: serviceDetails[entry.id]?.quantity,
    depth: serviceDetails[entry.id]?.depth,
    grade: serviceDetails[entry.id]?.grade,
    pump: serviceDetails[entry.id]?.pump,
    pickupLocation: serviceDetails[entry.id]?.pickupLocation,
    materialType: serviceDetails[entry.id]?.materialType,
    details: serviceDetails[entry.id]?.notes?.trim() ?? '',
    deliveryDate: sharedDate,
    preferredTime,
    location: sharedDeliveryAddress,
    latitude: sharedCoordinates?.lat,
    longitude: sharedCoordinates?.lng,
  }))

  const subtotal = serviceItems.reduce((sum, item) => {
    const serviceOption = options.find((option) => option.code === item.serviceId)
    return sum + estimatedServiceAmount(item, serviceOption, testAmountRupees)
  }, 0)
  const gst = gstRate === undefined ? undefined : Math.round(subtotal * gstRate)
  const total = Math.max(0, subtotal + (gst ?? 0) - couponDiscount)
  const canReviewRequest = gstRate !== undefined
    && activeServiceEntries.length > 0
    && activeServiceEntries.length === serviceEntries.length
    && isValidDeliveryDate(sharedDate)
    && sharedLocation.trim().length >= 3
    && sharedDeliveryAddress.length <= 240
    && activeServiceEntries.every((entry) => {
      const values = serviceDetails[entry.id]
      const isChennai = locationEligibility[entry.id] === true || isChennaiDeliveryAddress(sharedLocation)
      return Boolean(values && !Object.keys(serviceItemErrors(entry.serviceId, values)).length && values.capacity.trim().length <= 100 && isChennai)
    })
    && /^\d{10}$/.test(phone.replace(/\D/g, '').slice(-10))
    && isPhoneVerified(phone)

  useEffect(() => {
    if (step === 'success') {
      sessionStorage.removeItem(BOOKING_DRAFT_KEY)
      return
    }
    const timer = window.setTimeout(() => {
      const bookingDraft: BookingDraft = { idempotencyKey, selectedServices, serviceEntries, serviceItemsInitialized: hasInitializedServiceEntries, serviceDetails, capacity, step, details: { notes: getValues('notes') ?? '' }, locationAddress: sharedLocation, coordinates: sharedCoordinates ? { latitude: sharedCoordinates.lat, longitude: sharedCoordinates.lng } : null, region, addressLabel, addressCity, addressPincode, saveAddress: saveAddressForFuture, savedAddressId, sharedDate, preferredTime, phone, paymentMethod, couponCode, couponDiscount, guestName, phoneChallenges, bookingId, quotedTotal }
      sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(bookingDraft))
    }, DRAFT_PERSIST_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [idempotencyKey, selectedServices, serviceEntries, hasInitializedServiceEntries, serviceDetails, capacity, step, getValues, sharedLocation, sharedCoordinates, sharedDate, region, addressLabel, addressCity, addressPincode, saveAddressForFuture, savedAddressId, preferredTime, phone, paymentMethod, couponCode, couponDiscount, guestName, phoneChallenges, bookingId, quotedTotal])
  useEffect(() => {
    let timer: number | undefined
    const subscription = watch((values) => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        try {
          const stored = sessionStorage.getItem(BOOKING_DRAFT_KEY)
          if (!stored) return
          const saved = JSON.parse(stored) as Partial<BookingDraft>
          sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify({ ...saved, idempotencyKey, phone: values.phone, capacity: values.capacity, paymentMethod: values.paymentMethod, couponCode: values.couponCode, guestName: values.guestName, details: { ...saved.details, notes: values.notes } }))
        } catch { /* Draft persistence must not interrupt typing. */ }
      }, DRAFT_PERSIST_DELAY_MS)
    })
    return () => { window.clearTimeout(timer); subscription.unsubscribe() }
  }, [watch, idempotencyKey])
  useEffect(() => {
    sessionStorage.removeItem(REPEAT_BOOKING_KEY)
  }, [])
  useEffect(() => {
    setValue('selectedServices', serviceEntries.map((entry) => entry.serviceId), { shouldValidate: true })
  }, [serviceEntries, setValue])
  useEffect(() => {
    const entryId = pendingServiceFocusId.current
    if (!entryId) return
    pendingServiceFocusId.current = null
    const item = Array.from(document.querySelectorAll<HTMLElement>('.booking-line[data-entry-id]')).find((element) => element.dataset.entryId === entryId)
    if (!item) return
    item.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
    item.querySelector<HTMLSelectElement>('select')?.focus({ preventScroll: true })
  }, [serviceEntries])
  useEffect(() => {
    if (hasInitializedServiceEntries || !options.length) return
    setHasInitializedServiceEntries(true)
    const aliases: Record<string, string> = { water: 'water_tanker', sewage: 'sewage_tanker', drinking: 'drinking_water', cleaning: 'tank_cleaning', borewell: 'borewell_service', rmc: 'rmc_mix', empty: 'empty_tanker', emergency: 'emergency_water' }
    const requestedService = new URLSearchParams(window.location.search).get('service') ?? ''
    const requestedCode = aliases[requestedService] ?? requestedService
    const serviceId = options.some((option) => option.code === requestedCode) ? requestedCode : options[0].code
    const entry = { id: createServiceEntryId(), serviceId }
    setServiceToAdd(serviceId)
    setServiceEntries([entry])
    setServiceDetails((current) => ({ ...current, [entry.id]: serviceDraftFor(serviceId) }))
    const coupon = new URLSearchParams(window.location.search).get('coupon')
    if (coupon && !getValues('couponCode')) setValue('couponCode', coupon)
  }, [hasInitializedServiceEntries, options, getValues, setValue])
  useEffect(() => {
    if (!phone && phoneVerificationQuery.data?.verified && phoneVerificationQuery.data.phone) {
      setValue('phone', phoneVerificationQuery.data.phone, { shouldValidate: true })
    }
  }, [phone, phoneVerificationQuery.data, setValue])

  function addServiceEntry(serviceId = selectedServiceToAdd) {
    if (!serviceId || !availableServiceOptions.some((option) => option.code === serviceId)) return
    const entry = { id: createServiceEntryId(), serviceId }
    pendingServiceFocusId.current = entry.id
    setServiceEntries((current) => [...current, entry])
    setServiceDetails((current) => ({ ...current, [entry.id]: serviceDraftFor(serviceId) }))
    setServiceToAdd(serviceId)
    setError(null)
  }
  const changeServiceEntry = useCallback((entryId: string, serviceId: string) => {
    if (!options.some((option) => option.code === serviceId)) return
    setServiceEntries((current) => current.map((entry) => entry.id === entryId ? { ...entry, serviceId } : entry))
    setServiceDetails((current) => ({ ...current, [entryId]: serviceDraftFor(serviceId) }))
    setServiceFieldErrors((current) => { const next = { ...current }; delete next[entryId]; return next })
    setError(null)
  }, [options])
  const removeServiceEntry = useCallback((entryId: string) => {
    if (serviceEntries.length <= 1) { setError(c.errors.keepOneService); return }
    setServiceEntries((current) => current.filter((entry) => entry.id !== entryId))
    setServiceDetails((current) => { const next = { ...current }; delete next[entryId]; return next })
    setServiceFieldErrors((current) => { const next = { ...current }; delete next[entryId]; return next })
    setLocationEligibility((current) => { const next = { ...current }; delete next[entryId]; return next })
    setLocationStatus((current) => { const next = { ...current }; delete next[entryId]; return next })
    setLocationToasts((current) => { const next = { ...current }; delete next[entryId]; return next })
    setError(null)
  }, [serviceEntries.length])
  function removeAllServiceEntries() {
    setServiceEntries([])
    setServiceDetails({})
    setServiceFieldErrors({})
    setLocationEligibility({})
    setLocationStatus({})
    setLocationToasts({})
    setValue('selectedServices', [], { shouldValidate: true })
    setHasInitializedServiceEntries(true)
    setConfirmRemoveAll(false)
    setError(null)
  }
  const updateServiceDetails = useCallback((service: string, field: BookingServiceField | 'deliveryDate' | 'location', value: string) => {
    setServiceDetails((current) => ({ ...current, [service]: { ...emptyServiceDraft(), ...current[service], latitude: field === 'location' ? undefined : current[service]?.latitude, longitude: field === 'location' ? undefined : current[service]?.longitude, [field]: value } }))
    if (field === 'location') {
      setLocationEligibility((current) => { const next = { ...current }; delete next[service]; return next })
      setLocationToasts((current) => { const next = { ...current }; delete next[service]; return next })
      setLocationStatus((current) => { const next = { ...current }; delete next[service]; return next })
    }
    setServiceFieldErrors((current) => { const errors = current[service]; if (!errors?.[field]) return current; const next = { ...current, [service]: { ...errors } }; delete next[service][field]; if (!Object.keys(next[service]).length) delete next[service]; return next })
  }, [])
  function updateSharedLocation(value: string) {
    setSharedLocation(value)
    setSharedCoordinates(null)
    setLocationEligibility((current) => ({ ...current, ...Object.fromEntries(serviceEntries.map((entry) => [entry.id, false])) }))
    setLocationToasts((current) => ({ ...current, shared: '' }))
  }
  function selectSavedAddress(addressId: string) {
    setSavedAddressId(addressId)
    if (!addressId) { updateSharedLocation(''); setSaveAddressForFuture(false); return }
    const address: SavedAddress | undefined = addressesQuery.data?.find((item) => item.id === addressId)
    if (!address) return
    setSharedLocation(address.address)
    setAddressLabel(address.label)
    setAddressCity(address.city)
    setAddressPincode(address.pincode)
    setSharedCoordinates(address.latitude !== undefined && address.longitude !== undefined ? { lat: address.latitude, lng: address.longitude } : null)
    const completeAddress = [address.address, address.city, address.pincode].filter(Boolean).join(', ')
    setLocationEligibility((current) => ({ ...current, ...Object.fromEntries(serviceEntries.map((entry) => [entry.id, isChennaiDeliveryAddress(completeAddress)])) }))
    setServiceDetails((current) => ({ ...current, ...Object.fromEntries(serviceEntries.map((entry) => [entry.id, { ...emptyServiceDraft(), ...current[entry.id], location: completeAddress, latitude: address.latitude, longitude: address.longitude }])) }))
    setSaveAddressForFuture(false)
  }
  const applySavedAddressFromQuery = useEffectEvent((addressId: string) => selectSavedAddress(addressId))
  useEffect(() => {
    if (savedAddressId && addressesQuery.data && !sharedLocation) applySavedAddressFromQuery(savedAddressId)
  }, [addressesQuery.data, savedAddressId, sharedLocation])
  function validateDeliveryAddress(service: string, address: string) {
    if (address.trim().length < 3) return false
    setLocationToasts((current) => { const next = { ...current }; delete next[service]; return next })
    if (!isChennaiDeliveryAddress(address.trim())) {
      const message = c.location.outsideChennai
      setLocationEligibility((current) => ({ ...current, [service]: false }))
      setLocationStatus((current) => { const next = { ...current }; delete next[service]; return next })
      setLocationToasts((current) => ({ ...current, [service]: message }))
      setServiceFieldErrors((current) => ({ ...current, [service]: { ...current[service], location: c.location.chooseInsideChennai } }))
      return false
    }
    setLocationEligibility((current) => ({ ...current, [service]: true }))
    setLocationStatus((current) => { const next = { ...current }; delete next[service]; return next })
    setServiceFieldErrors((current) => { const next = { ...current }; if (next[service]) { delete next[service].location; if (!Object.keys(next[service]).length) delete next[service] }; return next })
    return true
  }
  function updateMapLocation(_service: string, point: LatLngLiteral, approximateName?: string) {
    if (approximateName) updateSharedLocation(approximateName.includes('Chennai') ? approximateName : `${approximateName}, Chennai`)
    setSharedCoordinates(point)
    setServiceDetails((current) => ({ ...current, ...Object.fromEntries(serviceEntries.map((entry) => [entry.id, { ...emptyServiceDraft(), ...current[entry.id], latitude: point.lat, longitude: point.lng }])) }))
    setLocationEligibility((current) => ({ ...current, ...Object.fromEntries(serviceEntries.map((entry) => [entry.id, true])) }))
    setLocationToasts((current) => ({ ...current, shared: '' }))
    setLocationStatus((current) => ({ ...current, shared: c.location.areaSelected }))
  }
  async function updateDetectedLocation(service: string, point: LatLngLiteral) {
    setLocationStatus((current) => ({ ...current, [service]: c.location.findingNearbyArea }))
    try {
      const result = await lookupDeliveryPoint(point)
      if (!result.isInChennai) {
        setLocationStatus((current) => { const next = { ...current }; delete next[service]; return next })
        setLocationEligibility((current) => ({ ...current, [service]: false }))
        setLocationToasts((current) => ({ ...current, [service]: c.location.outsideChennai }))
        return
      }
      updateMapLocation(service, point, result.approximateName)
      setLocationStatus((current) => ({ ...current, [service]: c.location.currentLocationDetected }))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setLocationStatus((current) => { const next = { ...current }; delete next[service]; return next })
      console.warn(JSON.stringify({ event: 'location.reverse_geocode_failed', error: error instanceof Error ? error.message : 'Unknown error' }))
    }
  }
  function detectLocation(service: string) {
    if (!navigator.geolocation) { setLocationStatus((current) => ({ ...current, [service]: c.location.unsupported })); return }
    setLocationStatus((current) => ({ ...current, [service]: c.location.detectingLocation }))
    navigator.geolocation.getCurrentPosition((position) => { void updateDetectedLocation(service, { lat: position.coords.latitude, lng: position.coords.longitude }) }, (positionError) => { setLocationStatus((current) => ({ ...current, [service]: positionError.code === positionError.PERMISSION_DENIED ? c.location.permissionDenied : c.location.unavailable })) }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 })
  }
  function isPhoneVerified(phoneValue: string) {
    const normalized = phoneValue.replace(/\D/g, '').slice(-10)
    const guestPhone = user?.username.startsWith('guest_') ? user.username.slice('guest_'.length).replace(/\D/g, '').slice(-10) : ''
    const savedVerifiedPhone = phoneVerificationQuery.data?.verified ? phoneVerificationQuery.data.phone.replace(/\D/g, '').slice(-10) : ''
    return Boolean(normalized && (phoneChallenges[normalized] !== undefined || guestPhone === normalized || savedVerifiedPhone === normalized))
  }
  function review(values: BookingFormValues) {
    const today = currentDateInputValue()
    const fieldErrors: Record<string, ServiceFieldErrors> = {}
    const normalizedPhone = values.phone.replace(/\D/g, '').slice(-10)
    for (const entry of activeServiceEntries) {
      const values = serviceDetails[entry.id] ?? emptyServiceDraft()
      const errors = serviceItemErrors(entry.serviceId, values)
      if (!isValidDeliveryDate(sharedDate)) errors.deliveryDate = sharedDate < today ? c.validation.deliveryDatePast : c.validation.deliveryDateInvalid
      if (Object.keys(errors).length) fieldErrors[entry.id] = errors
    }
    const outsideChennai = activeServiceEntries.map((entry) => {
      if (fieldErrors[entry.id]?.location || locationEligibility[entry.id] === true) return false
      return !validateDeliveryAddress(entry.id, sharedLocation)
    })
    activeServiceEntries.forEach((entry, index) => {
      if (!outsideChennai[index]) return
      fieldErrors[entry.id] = { ...fieldErrors[entry.id], location: c.location.chooseInsideChennai }
    })
    setServiceFieldErrors(fieldErrors)
    if (Object.keys(fieldErrors).length) {
      setError(c.errors.correctServiceDetails)
      return
    }
    if (!isPhoneVerified(normalizedPhone)) {
      setError(c.errors.verifyPhoneBeforeContinuing)
      return
    }
    if (!(values.guestName ?? '').trim()) {
      setError(c.errors.customerNameRequired)
      return
    }
    if (saveAddressForFuture && isRegisteredCustomer && !savedAddressId && (!addressLabel.trim() || addressCity.trim().length < 2 || !/^\d{4,12}$/.test(addressPincode.trim()))) {
      setError(c.errors.addressDetailsRequired)
      return
    }
    trackEvent('booking.started', { service: servicesForQuote.join(','), capacity: Number(values.capacity) || 0 })
    setError(null)
    setReviewConsent(false)
    setStep('review')
  }
  async function applyCoupon(selectedCode = getValues('couponCode') ?? '') { const code = selectedCode.trim().toUpperCase(); if (!code) { setCouponMessage(c.coupon.enterCode); return }; setValue('couponCode', code); setCouponMessage(null); try { const result = await couponValidation.mutateAsync({ code, serviceCode: selectedServices[0], amount: subtotal }); const discount = calculateDiscount(result.coupon as CouponRecord, subtotal); if (!result.valid || !discount) { setCouponDiscount(0); setCouponMessage(c.coupon.notValid); return }; setCouponDiscount(discount); setCouponMessage(c.coupon.applied(discount.toLocaleString('en-IN'))) } catch (validationError) { setCouponDiscount(0); setCouponMessage(validationError instanceof Error ? validationError.message : c.coupon.validationFailed) } }
  async function requestGuestOtp() {
    const normalizedPhone = getValues('phone').replace(/\D/g, '').slice(-10)
    if (!/^\d{10}$/.test(normalizedPhone)) { setOtpMessages((current) => ({ ...current, [normalizedPhone]: c.validation.phone })); return }
    setOtpPendingPhone(normalizedPhone)
    setOtpMessages((current) => ({ ...current, [normalizedPhone]: '' }))
    try {
      const result = await customerApi.requestGuestOtp(normalizedPhone)
      setOtpChallenges((current) => ({ ...current, [normalizedPhone]: result.challengeId }))
      setOtpValues((current) => ({ ...current, [normalizedPhone]: '' }))
      setOtpMessages((current) => ({ ...current, [normalizedPhone]: c.otp.codeSent }))
    } catch (otpError) {
      setOtpMessages((current) => ({ ...current, [normalizedPhone]: otpError instanceof Error ? otpError.message : c.otp.sendFailed }))
    } finally { setOtpPendingPhone(null) }
  }
  async function verifyGuestOtp() {
    const normalizedPhone = getValues('phone').replace(/\D/g, '').slice(-10)
    const challengeId = otpChallenges[normalizedPhone]
    const otp = otpValues[normalizedPhone] ?? ''
    if (!challengeId || !/^\d{6}$/.test(otp)) { setOtpMessages((current) => ({ ...current, [normalizedPhone]: c.otp.codeRequired })); return }
    setOtpPendingPhone(normalizedPhone)
    setOtpMessages((current) => ({ ...current, [normalizedPhone]: '' }))
    try {
      const currentAuth = useAuthStore.getState()
      if (currentAuth.user || currentAuth.accessToken) {
        await customerApi.verifyContactPhoneOtp({ challengeId, phone: normalizedPhone, otp })
      } else {
        const session = await customerApi.verifyGuestOtp({ challengeId, phone: normalizedPhone, otp, name: guestName.trim() || undefined })
        signIn(session.user, session.accessToken)
      }
      setPhoneChallenges((current) => ({ ...current, [normalizedPhone]: challengeId }))
      setOtpMessages((current) => ({ ...current, [normalizedPhone]: c.otp.verified }))
    } catch (otpError) {
      setOtpMessages((current) => ({ ...current, [normalizedPhone]: otpError instanceof Error ? otpError.message : c.otp.verifyFailed }))
    } finally { setOtpPendingPhone(null) }
  }
  async function confirmBooking() {
    setIsSubmitting(true)
    setError(null)
    setPaymentFailure(null)
    try {
      const primaryService = serviceItems[0]
      if (!primaryService) throw new Error(c.errors.selectServiceBeforeConfirm)
      const normalizedPhone = phone.replace(/\D/g, '').slice(-10)
      if (!/^\d{10}$/.test(normalizedPhone) || !isPhoneVerified(normalizedPhone)) throw new Error(c.errors.verifyPhoneBeforeConfirm)
      const primaryDeliveryDate = primaryService.deliveryDate
      if (!primaryDeliveryDate) throw new Error(c.errors.deliveryDateRequired)
      if (saveAddressForFuture && isRegisteredCustomer && !savedAddressId && !customerDemoDataEnabled) {
        await createAddress.mutateAsync({ label: addressLabel.trim(), address: sharedLocation.trim(), city: addressCity.trim(), pincode: addressPincode.trim(), latitude: sharedCoordinates?.lat, longitude: sharedCoordinates?.lng })
        setSaveAddressForFuture(false)
      }
      let currentBookingId = bookingId
      let payableTotal = quotedTotal ?? total
      if (!customerDemoDataEnabled && !currentBookingId) {
        const booking = await createBooking.mutateAsync({
          idempotencyKey,
          serviceId: primaryService.serviceId,
          services: serviceItems,
          capacity: primaryService.capacity ?? capacity,
          location: primaryService.location ?? sharedDeliveryAddress,
          deliveryDate: primaryDeliveryDate,
          preferredTime,
          notes: details.notes,
          couponCode,
          phone: normalizedPhone,
          phoneVerificationChallengeId: phoneChallenges[normalizedPhone],
          latitude: sharedCoordinates?.lat,
          longitude: sharedCoordinates?.lng,
          paymentMethod,
        })
        currentBookingId = booking.id
        payableTotal = Number(booking.quotedAmountPaise ?? 0) / 100 || total
        setQuotedTotal(payableTotal)
        setBookingId(currentBookingId)
        trackEvent('booking.created', { service: servicesForQuote.join(','), capacity: Number(capacity) || 0, paymentMethod, bookingId: currentBookingId, locationDetected: Boolean(primaryService.latitude) })
      }
      if (!customerDemoDataEnabled && paymentMethod === 'gateway' && currentBookingId) await razorpay.pay(payableTotal, currentBookingId, { name: user?.name ?? (guestName || 'Urban Tanker customer'), email: user?.username, phone: `+91${normalizedPhone}` })
      sessionStorage.removeItem(BOOKING_DRAFT_KEY)
      setStep('success')
    } catch (paymentError) {
      if (paymentError instanceof CheckoutError) setPaymentFailure(paymentError)
      else setError(paymentError instanceof Error ? paymentError.message : c.errors.bookingFailed)
    } finally { setIsSubmitting(false) }
  }

  // Only cancelled or failed checkouts can fall back to COD. A verification failure may already be paid, so it must not.
  async function retryVerification() {
    if (!paymentFailure?.pending) return
    setIsSubmitting(true)
    setError(null)
    try {
      await razorpay.verifyPending(paymentFailure.pending)
      setPaymentFailure(null)
      sessionStorage.removeItem(BOOKING_DRAFT_KEY)
      setStep('success')
    } catch (verifyError) {
      if (verifyError instanceof CheckoutError) setPaymentFailure(verifyError)
      else setError(verifyError instanceof Error ? verifyError.message : c.errors.bookingFailed)
    } finally { setIsSubmitting(false) }
  }

  async function payOnDeliveryInstead() {
    if (!bookingId) return
    setIsSubmitting(true)
    setError(null)
    try {
      await customerApi.switchBookingToCashOnDelivery(bookingId)
      setValue('paymentMethod', 'cod')
      setPaymentFailure(null)
      sessionStorage.removeItem(BOOKING_DRAFT_KEY)
      setStep('success')
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : c.errors.bookingFailed)
    } finally { setIsSubmitting(false) }
  }

  const paymentFailureMessage = paymentFailure?.kind === 'cancelled' ? c.errors.paymentCancelled : paymentFailure?.kind === 'failed' ? c.errors.paymentFailed : c.errors.paymentVerifyFailed

  const summaryItems: BookingSummaryItem[] = serviceItems.map((item, index) => {
    const serviceName = options.find((option) => option.code === item.serviceId)?.label ?? item.serviceId
    const duplicateCount = serviceItems.slice(0, index).filter((other) => other.serviceId === item.serviceId).length
    const details = [item.serviceType, item.waterType, item.capacity, item.tankerCount ? c.serviceSummary.tankers(item.tankerCount) : '', item.quantity, item.depth ? c.serviceSummary.depth(item.depth) : '', item.grade].filter(Boolean).join(c.serviceSummary.separator) || c.serviceSummary.emptyDetail
    const serviceOption = options.find((option) => option.code === item.serviceId)
    const unitPrice = serviceOption?.price ?? 0
    const estimatePending = unitPrice <= 0
    return { id: activeServiceEntries[index]?.id ?? `${item.serviceId}-${index}`, label: duplicateCount ? c.serviceSummary.duplicateLabel(serviceName, duplicateCount + 1) : serviceName, detail: details, amount: estimatedServiceAmount(item, serviceOption, testAmountRupees), estimatePending }
  })

  if (step === 'success') return <section className="booking-screen"><BookingHero onBack={() => navigate('home')} /><div className="booking-new-shell"><div className="surface booking-success"><span className="success-mark">✓</span><p className="eyebrow">{c.success.eyebrow}</p><h2>{c.success.heading}</h2><p>{c.success.referenceLead} <strong>{bookingId ?? c.success.referenceFallback}</strong> {c.success.referenceTrail}</p>{bookingId && !customerDemoDataEnabled && paymentMethod === 'gateway' && <PaymentReceiptCard bookingId={bookingId} />}<div className="action-row"><button className="button button-primary" type="button" onClick={() => navigate('home')}>{c.success.returnHome} <ArrowRight size={15} /></button></div></div></div></section>

  if (step === 'review' || step === 'payment') return <section className="booking-screen">
    <BookingHero onBack={() => navigate('home')} />
    <div className="booking-new-shell"><BookingProgress activeStep={step === 'review' ? 2 : 3} /><div className="booking-new-grid">
      <div className="booking-form">
        <BookingSection number={step === 'review' ? '✓' : '03'} title={step === 'review' ? c.sections.review.title : c.sections.payment.title} description={step === 'review' ? c.sections.review.description : c.sections.payment.description}>
          <dl className="detail-grid"><div><dt>{c.review.deliverTo}</dt><dd>{sharedDeliveryAddress}</dd></div><div><dt>{c.review.contact}</dt><dd>{c.review.contactValue(guestName, phone)}</dd></div><div><dt>{c.review.schedule}</dt><dd>{c.review.scheduleValue(sharedDate, preferredTime)}</dd></div><div><dt>{c.review.additionalRequirements}</dt><dd>{details.notes || c.review.none}</dd></div></dl>
          {serviceItems.map((item, index) => {
            const name = options.find((option) => option.code === item.serviceId)?.label ?? item.serviceId
            const duplicateCount = serviceItems.slice(0, index).filter((other) => other.serviceId === item.serviceId).length
            const unitPrice = options.find((option) => option.code === item.serviceId)?.price ?? 0
            const estimatePending = unitPrice <= 0
            return <div className="review-item" key={activeServiceEntries[index]?.id ?? index}><h3>{duplicateCount ? c.serviceSummary.duplicateLabel(name, duplicateCount + 1) : name}</h3><p>{[item.serviceType, item.waterType, item.capacity, item.tankerCount ? c.serviceSummary.tankers(item.tankerCount) : '', item.depth ? c.serviceSummary.depth(item.depth) : '', item.quantity, item.grade, item.pump, item.pickupLocation, item.materialType, item.details].filter(Boolean).join(c.serviceSummary.separator)}</p><p>{estimatePending ? c.serviceSummary.quotePending : c.review.estimatedLine(estimatedServiceAmount(item, options.find((option) => option.code === item.serviceId), testAmountRupees).toLocaleString('en-IN'), sharedDate, sharedLocation)}</p></div>
          })}
          {step === 'review' && <>
            <label className="check-line booking-consent"><input type="checkbox" checked={reviewConsent} onChange={(event) => setReviewConsent(event.target.checked)} /> {c.review.consent}</label>
            <button className="button button-primary booking-review-button" type="button" disabled={!reviewConsent} onClick={() => setStep('payment')}>{c.review.continueToPayment} <ArrowRight size={16} /></button>
          </>}
          {step === 'payment' && <>
            <div className="guest-verification"><p className="eyebrow">{c.verification.eyebrow}</p><p className="verification-success">{c.payment.verifiedNote}</p></div>
            {couponMessage && <p className={couponDiscount ? 'coupon-success' : 'coupon-error'} role="status">{couponMessage}</p>}
            <div className="booking-price-summary"><div><span>{c.payment.services}</span><b>{c.payment.inr(subtotal.toLocaleString('en-IN'))}</b></div><div><span>{gstWaived ? c.payment.gstWaived : c.payment.gst(gstPercentage)}</span><b>{gst === undefined ? '—' : c.payment.inr(gst.toLocaleString('en-IN'))}</b></div>{couponDiscount > 0 && <div><span>{c.payment.couponDiscount}</span><b>{c.payment.couponDiscountAmount(couponDiscount.toLocaleString('en-IN'))}</b></div>}<div className="booking-price-total"><span>{c.payment.total}</span><b>{c.payment.inr(total.toLocaleString('en-IN'))}</b></div></div>
            <div className="payment-choice-list">
              <label className={paymentMethod === 'wallet' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'wallet'} onChange={() => setValue('paymentMethod', 'wallet')} /><Wallet size={18} /><span><b>{c.payment.methods[0].title}</b><small>{c.payment.methods[0].detail}</small></span></label>
              <label className={paymentMethod === 'gateway' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'gateway'} onChange={() => setValue('paymentMethod', 'gateway')} /><CreditCard size={18} /><span><b>{c.payment.methods[1].title}</b><small>{c.payment.methods[1].detail}</small></span></label>
              <label className={paymentMethod === 'cod' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'cod'} onChange={() => setValue('paymentMethod', 'cod')} /><Wallet size={18} /><span><b>{c.payment.methods[2].title}</b><small>{c.payment.methods[2].detail}</small></span></label>
              {errors.paymentMethod?.message && <small className="booking-field-error" role="alert">{errors.paymentMethod.message}</small>}
              {paymentFailure ? <div className="payment-recovery" role="alert">
                <p>{paymentFailureMessage}</p>
                <div className="action-row">
                  {paymentFailure.kind === 'verification'
                    ? <button className="button button-primary" type="button" disabled={isSubmitting} onClick={() => void retryVerification()}>{c.payment.retryConfirmation}</button>
                    : <>
                        <button className="button button-primary" type="button" disabled={isSubmitting} onClick={() => { setPaymentFailure(null); void confirmBooking() }}>{c.payment.tryAgain}</button>
                        <button className="button button-quiet" type="button" disabled={isSubmitting} onClick={() => void payOnDeliveryInstead()}>{c.payment.payOnDelivery}</button>
                      </>}
                </div>
              </div> : <button className="button button-primary button-large" disabled={isSubmitting || gstRate === undefined} onClick={() => void confirmBooking()}>{isSubmitting ? c.payment.processing : c.payment.confirmBooking(total.toLocaleString('en-IN'))} <Check size={16} /></button>}
            </div>
          </>}
          {error && <p className="login-error" role="alert">{error}</p>}
        </BookingSection>
        <button className="back-link" type="button" onClick={() => setStep(step === 'payment' ? 'review' : 'details')}><ArrowLeft size={14} /> {c.payment.back}</button>
      </div>
      <BookingSummary items={summaryItems} total={total} />
    </div></div>
  </section>

  return <section className="booking-screen">
    <BookingHero onBack={() => navigate('home')} />
    <div className="booking-new-shell"><BookingProgress activeStep={1} />
      <form noValidate className="booking-new-grid" onSubmit={handleSubmit(review, (invalid) => setError(invalid.selectedServices?.message ?? invalid.phone?.message ?? invalid.notes?.message ?? c.submit.fallbackError))}>
        <div className="booking-form">
          <BookingSection number="01" title={c.sections.services.title} description={c.sections.services.description}>
            {activeServiceEntries.map((entry, index) => <BookingServiceItem key={entry.id} entry={entry} index={index} options={options} value={serviceDetails[entry.id] ?? serviceDraftFor(entry.serviceId)} errors={serviceFieldErrors[entry.id]} onServiceChange={changeServiceEntry} onFieldChange={updateServiceDetails} onRemove={removeServiceEntry} />)}
            {!activeServiceEntries.length && <p className="booking-no-services" role="status">{c.selectServices.noServicesSelected}</p>}
            <div className="booking-add-service"><label className="field">{addServiceLabel}<select value={selectedServiceToAdd} onChange={(event) => setServiceToAdd(event.target.value)} disabled={!availableServiceOptions.length}><option value="" disabled>{options.length ? c.selectServices.allServicesAdded : c.selectServices.noServicesAvailable}</option>{availableServiceOptions.map((option) => <option value={option.code} key={option.code}>{option.label}</option>)}</select></label><button className="button button-quiet" type="button" disabled={!availableServiceOptions.length} onClick={() => addServiceEntry()}><Plus size={16} /> {addServiceLabel}</button>{serviceEntries.length > 0 && <button className="button button-quiet booking-remove-all" type="button" onClick={() => setConfirmRemoveAll(true)}><Trash2 size={15} /> {c.selectServices.removeAllServices}</button>}</div>
            {confirmRemoveAll && <div className="booking-remove-all-confirm" role="group" aria-label={c.selectServices.confirmRemoveAllLabel}><span>{c.selectServices.removeAllConfirm(serviceEntries.length)}</span><button className="button button-quiet" type="button" onClick={() => setConfirmRemoveAll(false)}>{c.selectServices.keepItems}</button><button className="button button-danger" type="button" onClick={removeAllServiceEntries}>{c.selectServices.removeAll}</button></div>}
          </BookingSection>

          <BookingSection number="02" title={c.sections.contact.title} description={c.sections.contact.description}>
            <label className="field">{c.contact.customerName}<input {...register('guestName')} required minLength={2} maxLength={60} placeholder={c.contact.customerNamePlaceholder} /></label>
            <Controller control={control} name="phone" render={({ field }) => <label className="field">{c.contact.mobileNumber}<span className="input-with-icon"><Phone size={16} /><input {...field} value={field.value ?? ''} aria-invalid={Boolean(errors.phone)} onChange={(event) => { field.onChange(event.target.value.replace(/\D/g, '').slice(0, 10)); setError(null) }} inputMode="numeric" type="tel" required placeholder={c.contact.mobileNumberPlaceholder} /></span>{errors.phone?.message && <small className="booking-field-error" role="alert">{errors.phone.message}</small>}</label>} />
            {isRegisteredCustomer && <label className="field">{c.contact.savedAddress}<select value={savedAddressId} onChange={(event) => selectSavedAddress(event.target.value)}><option value="">{c.contact.newAddressOption}</option>{(addressesQuery.data ?? []).map((address) => <option value={address.id} key={address.id}>{c.contact.savedAddressOption(address.label, address.address)}</option>)}</select></label>}
            {isRegisteredCustomer && addressesQuery.isLoading && <p className="booking-address-status" role="status">{c.contact.savedAddressesLoading}</p>}
            {isRegisteredCustomer && addressesQuery.isError && <p className="booking-address-status" role="alert">{c.contact.savedAddressesError}</p>}
            {savedAddressId && <p className="saved-location-preview">{c.contact.savedAddressPreview(sharedLocation, addressCity, addressPincode)}</p>}
            {!savedAddressId && <div className="booking-manual-location">
              <div className="split-fields"><label className="field">{c.contact.serviceRegion}<select value={region} onChange={(event) => setRegion(event.target.value)}>{c.contact.regions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><label className="field">{c.contact.addressLabel}<input value={addressLabel} onChange={(event) => setAddressLabel(event.target.value)} placeholder={c.contact.addressLabelPlaceholder} /></label></div>
              <label className="field">{c.contact.fullAddress}<textarea rows={3} required value={sharedLocation} onBlur={() => activeServiceEntries.forEach((entry) => validateDeliveryAddress(entry.id, sharedLocation))} onChange={(event) => updateSharedLocation(event.target.value)} placeholder={c.contact.fullAddressPlaceholder} /></label>
              <div className="booking-location-tools"><button className="button button-quiet" type="button" title={c.contact.chooseOnMapLabel} onClick={() => setLocationModalOpen(true)}><MapPin size={17} /> <span>{c.contact.chooseOnMap}</span></button><button className="button button-quiet" type="button" aria-label={c.contact.useCurrentLocation} title={c.contact.useCurrentLocation} onClick={() => detectLocation('shared')}><Crosshair size={17} /> <span>{c.contact.useCurrentLocation}</span></button></div>
              {(locationToasts.shared || locationToasts[activeServiceEntries[0]?.id ?? '']) && <p className="booking-location-toast" role="alert">{locationToasts.shared || locationToasts[activeServiceEntries[0]?.id ?? '']}</p>}
              {locationStatus.shared && <p className="booking-address-status" role="status">{locationStatus.shared}</p>}
              {isRegisteredCustomer && <label className="check-line"><input type="checkbox" checked={saveAddressForFuture} onChange={(event) => setSaveAddressForFuture(event.target.checked)} /> {c.contact.saveAddressForFuture}</label>}
              {saveAddressForFuture && <div className="split-fields booking-save-address-fields"><label className="field">{c.contact.city}<input value={addressCity} onChange={(event) => setAddressCity(event.target.value)} required /></label><label className="field">{c.contact.pincode}<input value={addressPincode} onChange={(event) => setAddressPincode(event.target.value.replace(/\D/g, '').slice(0, 12))} inputMode="numeric" maxLength={12} required /></label></div>}
            </div>}
            <div className="guest-verification">
              <p className="eyebrow">{c.verification.eyebrow}</p>
              {isPhoneVerified(phone) ? <p className="verification-success">{c.verification.verifiedShared}</p> : <>
                {user && phoneVerificationQuery.isError && <p className="booking-field-error" role="alert">{c.verification.savedNumberCheckFailed}</p>}
                <p>{c.verification.verifyPrompt}</p>
                <div className="guest-otp-row"><input value={otpValues[phone.replace(/\D/g, '').slice(-10)] ?? ''} onChange={(event) => setOtpValues((current) => ({ ...current, [phone.replace(/\D/g, '').slice(-10)]: event.target.value.replace(/\D/g, '').slice(0, 6) }))} inputMode="numeric" placeholder={c.verification.codePlaceholder} aria-label={c.verification.codeLabel} /><button className="button button-quiet" type="button" title={c.verification.sendOrResendLabel} onClick={() => void requestGuestOtp()} disabled={otpPendingPhone !== null}><Phone size={16} /><span>{otpChallenges[phone.replace(/\D/g, '').slice(-10)] ? c.verification.resendCode : c.verification.sendCode}</span></button><button className="button button-quiet" type="button" aria-label={c.verification.verifyCodeLabel} title={c.verification.verifyCodeLabel} onClick={() => void verifyGuestOtp()} disabled={otpPendingPhone !== null || !otpChallenges[phone.replace(/\D/g, '').slice(-10)]}><Check size={16} /><span>{c.verification.verify}</span></button></div>
                {otpMessages[phone.replace(/\D/g, '').slice(-10)] && <p className="verification-message" role="status">{otpMessages[phone.replace(/\D/g, '').slice(-10)]}</p>}
              </>}
            </div>
          </BookingSection>

          <BookingSection number="03" title={c.sections.slot.title} description={c.sections.slot.description}>
            <div className="split-fields"><label className="field">{c.slot.requiredDate}<input type="date" min={currentDateInputValue()} required value={sharedDate} onChange={(event) => setSharedDate(event.target.value)} /></label><label className="field">{c.slot.preferredTime}<select value={preferredTime} onChange={(event) => setPreferredTime(event.target.value)}>{c.slot.timeSlots.map((slot) => <option key={slot.value} value={slot.value}>{slot.label}</option>)}</select></label></div>
            <label className="field">{c.slot.additionalRequirements}<textarea {...register('notes')} rows={3} placeholder={c.slot.additionalRequirementsPlaceholder} /></label>
            <div className="booking-coupon-row"><label className="field">{c.slot.haveCoupon}<input {...register('couponCode')} onChange={(event) => setValue('couponCode', event.target.value.toUpperCase())} placeholder={c.slot.couponPlaceholder} /></label><button className="button button-quiet" type="button" onClick={() => void applyCoupon()} disabled={couponValidation.isPending}>{couponValidation.isPending ? c.slot.checkingCoupon : c.slot.applyCoupon}</button><p className="coupon-feedback" role="status">{couponMessage ?? ''}</p></div>
            <div className="booking-coupon-carousel"><div className="coupon-carousel-heading"><span>{c.slot.availableCoupons}</span></div><div className="booking-coupon-list">{(offersQuery.data ?? []).map((offer) => <button type="button" className={`booking-coupon-card ${couponCode === offer.code ? 'is-selected' : ''}`} key={offer.code} onClick={() => void applyCoupon(offer.code)}><strong>{offer.code}</strong><span>{formatOfferDiscount(offer)}</span><small>{offer.title}{offer.valid_until ? c.slot.validThrough(new Date(offer.valid_until).toLocaleDateString()) : c.slot.noExpiry}</small></button>)}</div></div>
          </BookingSection>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="button button-primary booking-review-button" type="submit" disabled={!canReviewRequest}>{c.submit.reviewButton} <ArrowRight size={16} /></button>
          {!canReviewRequest && <p className="booking-review-hint" role="status">{c.submit.reviewHint}</p>}
        </div>
        <BookingSummary items={summaryItems} total={total} />
      </form>
    </div>
    {locationModalOpen && <Suspense fallback={<div className="surface booking-map-loading" role="status">{c.location.loadingMap}</div>}><LocationPickerModal value={sharedCoordinates} onChange={(point, name) => updateMapLocation('shared', point, name)} onClose={() => setLocationModalOpen(false)} /></Suspense>}
  </section>
}
