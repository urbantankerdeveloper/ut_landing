import { lazy, Suspense, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, CreditCard, Crosshair, MapPin, Phone, Plus, Trash2, Wallet } from 'lucide-react'
import { useNavigationStore } from '../stores/navigationStore'
import { useCreateCustomerAddress, useCreateCustomerBooking, useCustomerAddresses, useCustomerOffers, useCustomerPhoneVerification, useCustomerServices } from '../hooks/useCustomerData'
import { useCouponValidation, useRazorpayPayment } from '../hooks/useFrontendFeatures'
import { useAuthStore } from '../stores/authStore'
import { customerApi, type BookingPaymentMethod, type BookingServiceDetails, type CustomerBooking, type SavedAddress } from '../api/customer'
import { customerDemoDataEnabled } from '../constants/demo'
import { trackEvent } from '../services/analytics'
import type { LatLngLiteral } from 'leaflet'
import { isChennaiDeliveryAddress, lookupDeliveryPoint } from '../services/geocoding'
import { BOOKING_DRAFT_KEY, REPEAT_BOOKING_KEY } from '../constants/bookingDraft'
import { BookingServiceItem, type BookingServiceDraft, type BookingServiceEntry, type BookingServiceField, type BookingServiceFieldErrors } from '../components/booking/BookingServiceItem'
import { BookingHero, BookingProgress, BookingSection, BookingSummary, type BookingSummaryItem } from '../components/booking/BookingPageSections'

const LocationPickerModal = lazy(() => import('../components/LocationPickerModal').then((module) => ({ default: module.LocationPickerModal })))

const GST_RATE = 0.18
type Step = 'details' | 'review' | 'payment' | 'success'

type CouponRecord = { discount_type?: string; discount_value?: number | string; discount?: number | string }
type ServiceFieldErrors = BookingServiceFieldErrors & { deliveryDate?: string; location?: string }
type ServiceDraft = BookingServiceDraft & { deliveryDate: string; location: string; latitude?: number; longitude?: number }
const bookingFormSchema = z.object({
  selectedServices: z.array(z.string()).min(1, 'Select at least one service.'),
  capacity: z.string().optional(),
  phone: z.string().regex(/^\d{10}$/, 'Enter a valid 10-digit mobile number.'),
  notes: z.string().max(500, 'Access notes must be 500 characters or fewer.').optional(),
  paymentMethod: z.enum(['wallet', 'gateway', 'cod']),
  couponCode: z.string().optional(),
  guestName: z.string().trim().max(60, 'Name must be 60 characters or fewer.').optional(),
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
  paymentMethod: BookingPaymentMethod
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
    if (!values.capacity) errors.capacity = 'Choose a tanker capacity.'
    if (!values.waterType) errors.waterType = 'Choose a water type.'
    if (!values.tankerCount || Number(values.tankerCount) < 1 || Number(values.tankerCount) > 5) errors.tankerCount = 'Enter 1 to 5 tankers.'
  } else if (['sewage_tanker', 'emergency_water'].includes(serviceId)) {
    if (!values.serviceType) errors.serviceType = 'Choose a service type.'
    if (!values.capacity) errors.capacity = 'Choose a tanker capacity.'
    if (!values.tankerCount || Number(values.tankerCount) < 1 || Number(values.tankerCount) > 5) errors.tankerCount = 'Enter 1 to 5 tankers.'
  } else if (['drinking_water', 'tank_cleaning'].includes(serviceId)) {
    if (!values.serviceType) errors.serviceType = 'Choose a service type.'
    if (!values.quantity || Number(values.quantity) < 1) errors.quantity = 'Enter a quantity greater than zero.'
  } else if (serviceId === 'borewell_service') {
    if (!values.serviceType) errors.serviceType = 'Choose a borewell service.'
  } else if (serviceId === 'rmc_mix') {
    if (!values.grade) errors.grade = 'Choose a concrete grade.'
    if (!values.quantity || Number(values.quantity) < 1) errors.quantity = 'Enter a concrete quantity greater than zero.'
    if (!values.pump) errors.pump = 'Choose a pump requirement.'
  } else if (serviceId === 'empty_tanker') {
    if (!values.capacity) errors.capacity = 'Choose a tanker capacity.'
    if (!values.tankerCount || Number(values.tankerCount) < 1 || Number(values.tankerCount) > 5) errors.tankerCount = 'Enter 1 to 5 tankers.'
    if (!values.pickupLocation.trim()) errors.pickupLocation = 'Enter a pickup address.'
    if (!values.materialType.trim()) errors.materialType = 'Enter the material to transport.'
  } else if (values.notes.trim().length < 3) {
    errors.notes = 'Describe this service in at least 3 characters.'
  }
  if (values.notes.length > 1000) errors.notes = 'Service details must be 1,000 characters or fewer.'
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

function estimatedServiceAmount(item: BookingServiceDetails, basePrice: number) {
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
  const units = Number(item.tankerCount || item.quantity) || 1
  return Math.round(basePrice * capacityFactor * depthFactor * units)
}

function formatOfferDiscount(offer: CouponRecord) {
  const value = Number(offer.discount_value ?? offer.discount ?? 0)
  if (!Number.isFinite(value) || value <= 0) return 'Special offer'
  return ['percentage', 'percent', '%'].includes(String(offer.discount_type ?? '').toLowerCase())
    ? `${value}% off`
    : `INR ${value.toLocaleString('en-IN')} off`
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

export default function BookingScreen() {
  const draft = loadBookingDraft()
  const navigate = useNavigationStore((state) => state.navigate)
  const createBooking = useCreateCustomerBooking()
  const servicesQuery = useCustomerServices()
  const razorpay = useRazorpayPayment()
  const couponValidation = useCouponValidation()
  const user = useAuthStore((state) => state.user)
  const isRegisteredCustomer = Boolean(user && !user.username.startsWith('guest_'))
  const phoneVerificationQuery = useCustomerPhoneVerification(isRegisteredCustomer)
  const addressesQuery = useCustomerAddresses(isRegisteredCustomer)
  const createAddress = useCreateCustomerAddress()
  const signIn = useAuthStore((state) => state.signIn)
  const offersQuery = useCustomerOffers()
  const serviceCatalog = useMemo(() => servicesQuery.data ?? [], [servicesQuery.data])
  const options = useMemo(() => serviceCatalog.map((service) => ({ code: service.code, label: service.name, price: service.base_price_paise / 100 })), [serviceCatalog])
  const { control, register, handleSubmit, setValue, getValues, watch, formState: { errors } } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    mode: 'onChange',
    defaultValues: {
      selectedServices: draft.selectedServices ?? [],
      capacity: draft.capacity ?? '',
      phone: draft.phone ?? '',
      notes: draft.details?.notes ?? '',
      paymentMethod: draft.paymentMethod ?? 'wallet',
      couponCode: draft.couponCode ?? '',
      guestName: draft.guestName ?? user?.name ?? '',
    },
  })
  const phone = useWatch({ control, name: 'phone' }) ?? ''
  const paymentMethod = useWatch({ control, name: 'paymentMethod' }) ?? 'wallet'
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
  const [idempotencyKey] = useState(draft.idempotencyKey ?? crypto.randomUUID())
  const selectedServices = useMemo(() => serviceEntries.map((entry) => entry.serviceId), [serviceEntries])
  const activeServiceEntries = useMemo(() => serviceEntries.filter((entry) => options.some((option) => option.code === entry.serviceId)), [serviceEntries, options])
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
    const unitPrice = options.find((option) => option.code === item.serviceId)?.price ?? 0
    return sum + estimatedServiceAmount(item, unitPrice)
  }, 0)
  const gst = Math.round(subtotal * GST_RATE)
  const total = Math.max(0, subtotal + gst - couponDiscount)
  const canReviewRequest = activeServiceEntries.length > 0
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
    const bookingDraft: BookingDraft = { idempotencyKey, selectedServices, serviceEntries, serviceItemsInitialized: hasInitializedServiceEntries, serviceDetails, capacity, step, details: { notes: getValues('notes') ?? '', location: sharedLocation, deliveryDate: sharedDate }, locationAddress: sharedLocation, coordinates: sharedCoordinates ? { latitude: sharedCoordinates.lat, longitude: sharedCoordinates.lng } : null, region, addressLabel, addressCity, addressPincode, saveAddress: saveAddressForFuture, savedAddressId, sharedDate, preferredTime, phone, paymentMethod, couponCode, couponDiscount, guestName, phoneChallenges, bookingId, quotedTotal }
    sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(bookingDraft))
  }, [idempotencyKey, selectedServices, serviceEntries, hasInitializedServiceEntries, serviceDetails, capacity, step, getValues, sharedLocation, sharedCoordinates, sharedDate, region, addressLabel, addressCity, addressPincode, saveAddressForFuture, savedAddressId, preferredTime, phone, paymentMethod, couponCode, couponDiscount, guestName, phoneChallenges, bookingId, quotedTotal])
  useEffect(() => {
    const subscription = watch((values) => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(BOOKING_DRAFT_KEY) ?? '{}') as Partial<BookingDraft>
        sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify({ ...saved, idempotencyKey, phone: values.phone, capacity: values.capacity, paymentMethod: values.paymentMethod, couponCode: values.couponCode, guestName: values.guestName, details: { ...saved.details, notes: values.notes } }))
      } catch { /* Draft persistence must not interrupt typing. */ }
    })
    return () => subscription.unsubscribe()
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

  function addServiceEntry(serviceId = serviceToAdd || options[0]?.code) {
    if (!serviceId || !options.some((option) => option.code === serviceId)) return
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
    if (serviceEntries.length <= 1) { setError('Keep at least one service in your booking.'); return }
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
      const message = 'We currently deliver only within Chennai. Please choose another location inside Chennai.'
      setLocationEligibility((current) => ({ ...current, [service]: false }))
      setLocationStatus((current) => { const next = { ...current }; delete next[service]; return next })
      setLocationToasts((current) => ({ ...current, [service]: message }))
      setServiceFieldErrors((current) => ({ ...current, [service]: { ...current[service], location: 'Choose a delivery location inside Chennai.' } }))
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
    setLocationStatus((current) => ({ ...current, shared: 'Delivery area selected and will be shared securely with the assigned fleet.' }))
  }
  async function updateDetectedLocation(service: string, point: LatLngLiteral) {
    setLocationStatus((current) => ({ ...current, [service]: 'Finding nearby area…' }))
    try {
      const result = await lookupDeliveryPoint(point)
      if (!result.isInChennai) {
        setLocationStatus((current) => { const next = { ...current }; delete next[service]; return next })
        setLocationEligibility((current) => ({ ...current, [service]: false }))
        setLocationToasts((current) => ({ ...current, [service]: 'We currently deliver only within Chennai. Please choose another location inside Chennai.' }))
        return
      }
      updateMapLocation(service, point, result.approximateName)
      setLocationStatus((current) => ({ ...current, [service]: 'Current location detected and will be shared securely with the assigned fleet.' }))
    } catch (error) {
      setLocationStatus((current) => { const next = { ...current }; delete next[service]; return next })
      setLocationEligibility((current) => ({ ...current, [service]: false }))
      setLocationToasts((current) => ({ ...current, [service]: 'We could not verify this location. Please choose another location inside Chennai.' }))
      console.warn(JSON.stringify({ event: 'location.reverse_geocode_failed', error: error instanceof Error ? error.message : 'Unknown error' }))
    }
  }
  function detectLocation(service: string) {
    if (!navigator.geolocation) { setLocationStatus((current) => ({ ...current, [service]: 'Location detection is not supported by this browser.' })); return }
    setLocationStatus((current) => ({ ...current, [service]: 'Detecting your current location…' }))
    navigator.geolocation.getCurrentPosition((position) => { void updateDetectedLocation(service, { lat: position.coords.latitude, lng: position.coords.longitude }) }, (positionError) => { setLocationStatus((current) => ({ ...current, [service]: positionError.code === positionError.PERMISSION_DENIED ? 'Location permission was not granted. Enter the delivery address instead.' : 'Location could not be detected. Enter the delivery address instead.' })) }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 })
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
      if (!isValidDeliveryDate(sharedDate)) errors.deliveryDate = sharedDate < today ? 'Choose today or a future date.' : 'Choose a valid delivery date.'
      if (Object.keys(errors).length) fieldErrors[entry.id] = errors
    }
    const outsideChennai = activeServiceEntries.map((entry) => {
      if (fieldErrors[entry.id]?.location || locationEligibility[entry.id] === true) return false
      return !validateDeliveryAddress(entry.id, sharedLocation)
    })
    activeServiceEntries.forEach((entry, index) => {
      if (!outsideChennai[index]) return
      fieldErrors[entry.id] = { ...fieldErrors[entry.id], location: 'Choose a delivery location inside Chennai.' }
    })
    setServiceFieldErrors(fieldErrors)
    if (Object.keys(fieldErrors).length) {
      setError('Please correct the highlighted service details.')
      return
    }
    if (!isPhoneVerified(normalizedPhone)) {
      setError('Verify the shared mobile number with OTP before continuing.')
      return
    }
    if (!(values.guestName ?? '').trim()) {
      setError('Enter the customer or company name.')
      return
    }
    if (saveAddressForFuture && isRegisteredCustomer && !savedAddressId && (!addressLabel.trim() || addressCity.trim().length < 2 || !/^\d{4,12}$/.test(addressPincode.trim()))) {
      setError('Add an address label, city, and valid pincode to save this address.')
      return
    }
    trackEvent('booking.started', { service: servicesForQuote.join(','), capacity: Number(values.capacity) || 0 })
    setError(null)
    setReviewConsent(false)
    setStep('review')
  }
  async function applyCoupon(selectedCode = getValues('couponCode') ?? '') { const code = selectedCode.trim().toUpperCase(); if (!code) { setCouponMessage('Enter a coupon code.'); return }; setValue('couponCode', code); setCouponMessage(null); try { const result = await couponValidation.mutateAsync({ code, serviceCode: selectedServices[0], amount: subtotal }); const discount = calculateDiscount(result.coupon as CouponRecord, subtotal); if (!result.valid || !discount) { setCouponDiscount(0); setCouponMessage('Coupon is not valid for this booking.'); return }; setCouponDiscount(discount); setCouponMessage(`Coupon applied. You saved INR ${discount.toLocaleString('en-IN')}.`) } catch (validationError) { setCouponDiscount(0); setCouponMessage(validationError instanceof Error ? validationError.message : 'Coupon could not be validated.') } }
  async function requestGuestOtp() {
    const normalizedPhone = getValues('phone').replace(/\D/g, '').slice(-10)
    if (!/^\d{10}$/.test(normalizedPhone)) { setOtpMessages((current) => ({ ...current, [normalizedPhone]: 'Enter a valid 10-digit mobile number.' })); return }
    setOtpPendingPhone(normalizedPhone)
    setOtpMessages((current) => ({ ...current, [normalizedPhone]: '' }))
    try {
      const result = await customerApi.requestGuestOtp(normalizedPhone)
      setOtpChallenges((current) => ({ ...current, [normalizedPhone]: result.challengeId }))
      setOtpValues((current) => ({ ...current, [normalizedPhone]: '' }))
      setOtpMessages((current) => ({ ...current, [normalizedPhone]: 'Verification code sent. It expires in 10 minutes.' }))
    } catch (otpError) {
      setOtpMessages((current) => ({ ...current, [normalizedPhone]: otpError instanceof Error ? otpError.message : 'We could not send the verification code.' }))
    } finally { setOtpPendingPhone(null) }
  }
  async function verifyGuestOtp() {
    const normalizedPhone = getValues('phone').replace(/\D/g, '').slice(-10)
    const challengeId = otpChallenges[normalizedPhone]
    const otp = otpValues[normalizedPhone] ?? ''
    if (!challengeId || !/^\d{6}$/.test(otp)) { setOtpMessages((current) => ({ ...current, [normalizedPhone]: 'Enter the 6-digit verification code.' })); return }
    setOtpPendingPhone(normalizedPhone)
    setOtpMessages((current) => ({ ...current, [normalizedPhone]: '' }))
    try {
      const currentAuth = useAuthStore.getState()
      if (currentAuth.user || currentAuth.accessToken) {
        await customerApi.verifyContactPhoneOtp({ challengeId, phone: normalizedPhone, otp })
      } else {
        const session = await customerApi.verifyGuestOtp({ challengeId, phone: normalizedPhone, otp, name: guestName.trim() || undefined })
        signIn(session.user, session.accessToken, session.refreshToken)
      }
      setPhoneChallenges((current) => ({ ...current, [normalizedPhone]: challengeId }))
      setOtpMessages((current) => ({ ...current, [normalizedPhone]: 'Mobile number verified. This number can be used for each selected service.' }))
    } catch (otpError) {
      setOtpMessages((current) => ({ ...current, [normalizedPhone]: otpError instanceof Error ? otpError.message : 'The verification code could not be confirmed.' }))
    } finally { setOtpPendingPhone(null) }
  }
  async function confirmBooking() {
    setIsSubmitting(true)
    setError(null)
    try {
      const primaryService = serviceItems[0]
      if (!primaryService) throw new Error('Select at least one available service before confirming.')
      const normalizedPhone = phone.replace(/\D/g, '').slice(-10)
      if (!/^\d{10}$/.test(normalizedPhone) || !isPhoneVerified(normalizedPhone)) throw new Error('Verify the shared mobile number before confirming.')
      const primaryDeliveryDate = primaryService.deliveryDate
      if (!primaryDeliveryDate) throw new Error('Choose a preferred delivery date for each selected service.')
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
      setError(paymentError instanceof Error && paymentError.message === 'Payment cancelled' ? 'Payment cancelled. You can retry when you are ready.' : paymentError instanceof Error ? paymentError.message : 'We could not complete this booking. Check your connection and try again.')
    } finally { setIsSubmitting(false) }
  }

  const summaryItems: BookingSummaryItem[] = serviceItems.map((item, index) => {
    const serviceName = options.find((option) => option.code === item.serviceId)?.label ?? item.serviceId
    const duplicateCount = serviceItems.slice(0, index).filter((other) => other.serviceId === item.serviceId).length
    const details = [item.serviceType, item.waterType, item.capacity, item.tankerCount ? `${item.tankerCount} tankers` : '', item.quantity, item.depth ? `${item.depth} ft` : '', item.grade].filter(Boolean).join(' · ') || 'Site review'
    const unitPrice = options.find((option) => option.code === item.serviceId)?.price ?? 0
    const estimatePending = unitPrice <= 0
    return { id: activeServiceEntries[index]?.id ?? `${item.serviceId}-${index}`, label: duplicateCount ? `${serviceName} ${duplicateCount + 1}` : serviceName, detail: details, amount: estimatedServiceAmount(item, unitPrice), estimatePending }
  })

  if (step === 'success') return <section className="booking-screen"><BookingHero onBack={() => navigate('home')} /><div className="booking-new-shell"><div className="surface booking-success"><span className="success-mark">✓</span><p className="eyebrow">REQUEST CREATED</p><h2>Your combined booking is ready.</h2><p>Reference <strong>{bookingId ?? 'confirmed'}</strong> contains all selected service requests.</p><div className="action-row"><button className="button button-primary" type="button" onClick={() => navigate('home')}>Return home <ArrowRight size={15} /></button></div></div></div></section>

  if (step === 'review' || step === 'payment') return <section className="booking-screen">
    <BookingHero onBack={() => navigate('home')} />
    <div className="booking-new-shell"><BookingProgress activeStep={step === 'review' ? 2 : 3} /><div className="booking-new-grid">
      <div className="booking-form">
        <BookingSection number={step === 'review' ? '✓' : '03'} title={step === 'review' ? 'Review your combined booking' : 'Choose how to pay.'} description={step === 'review' ? 'Confirm every service before creating the request.' : 'Your payment is protected and linked to this booking.'}>
          <dl className="detail-grid"><div><dt>Deliver to</dt><dd>{sharedDeliveryAddress}</dd></div><div><dt>Contact</dt><dd>{guestName} · {phone}</dd></div><div><dt>Schedule</dt><dd>{sharedDate} · {preferredTime}</dd></div><div><dt>Additional requirements</dt><dd>{details.notes || 'None'}</dd></div></dl>
          {serviceItems.map((item, index) => {
            const name = options.find((option) => option.code === item.serviceId)?.label ?? item.serviceId
            const duplicateCount = serviceItems.slice(0, index).filter((other) => other.serviceId === item.serviceId).length
            const unitPrice = options.find((option) => option.code === item.serviceId)?.price ?? 0
            const estimatePending = unitPrice <= 0
            return <div className="review-item" key={activeServiceEntries[index]?.id ?? index}><h3>{duplicateCount ? `${name} ${duplicateCount + 1}` : name}</h3><p>{[item.serviceType, item.waterType, item.capacity, item.tankerCount ? `${item.tankerCount} tankers` : '', item.depth ? `${item.depth} ft` : '', item.quantity, item.grade, item.pump, item.pickupLocation, item.materialType, item.details].filter(Boolean).join(' · ')}</p><p>{estimatePending ? 'Quote pending' : `Estimated ${estimatedServiceAmount(item, unitPrice).toLocaleString('en-IN')} INR · ${sharedDate} · ${sharedLocation}`}</p></div>
          })}
          {step === 'review' && <>
            <label className="check-line booking-consent"><input type="checkbox" checked={reviewConsent} onChange={(event) => setReviewConsent(event.target.checked)} /> I confirm these requirements. Final vehicle availability, compatibility and project estimates may require vendor or admin review.</label>
            <button className="button button-primary booking-review-button" type="button" disabled={!reviewConsent} onClick={() => setStep('payment')}>Continue to payment <ArrowRight size={16} /></button>
          </>}
          {step === 'payment' && <>
            <div className="guest-verification"><p className="eyebrow">MOBILE VERIFICATION</p><p className="verification-success">This shared number is verified and will receive booking updates and delivery OTPs.</p></div>
            {couponMessage && <p className={couponDiscount ? 'coupon-success' : 'coupon-error'} role="status">{couponMessage}</p>}
            <div className="booking-price-summary"><div><span>Services</span><b>INR {subtotal.toLocaleString('en-IN')}</b></div><div><span>GST (18%)</span><b>INR {gst.toLocaleString('en-IN')}</b></div>{couponDiscount > 0 && <div><span>Coupon discount</span><b>- INR {couponDiscount.toLocaleString('en-IN')}</b></div>}<div className="booking-price-total"><span>Total</span><b>INR {total.toLocaleString('en-IN')}</b></div></div>
            <div className="payment-choice-list">
              <label className={paymentMethod === 'wallet' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'wallet'} onChange={() => setValue('paymentMethod', 'wallet')} /><Wallet size={18} /><span><b>Urban Tanker wallet</b><small>Use available balance</small></span></label>
              <label className={paymentMethod === 'gateway' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'gateway'} onChange={() => setValue('paymentMethod', 'gateway')} /><CreditCard size={18} /><span><b>Card or UPI</b><small>Secure payment gateway</small></span></label>
              <label className={paymentMethod === 'cod' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'cod'} onChange={() => setValue('paymentMethod', 'cod')} /><Wallet size={18} /><span><b>Cash on delivery</b><small>Pay the driver when your service is completed</small></span></label>
              <button className="button button-primary button-large" disabled={isSubmitting} onClick={() => void confirmBooking()}>{isSubmitting ? 'Processing...' : `Confirm booking · INR ${total.toLocaleString('en-IN')}`} <Check size={16} /></button>
            </div>
          </>}
          {error && <p className="login-error" role="alert">{error}</p>}
        </BookingSection>
        <button className="back-link" type="button" onClick={() => setStep(step === 'payment' ? 'review' : 'details')}><ArrowLeft size={14} /> Back</button>
      </div>
      <BookingSummary items={summaryItems} total={total} />
    </div></div>
  </section>

  return <section className="booking-screen">
    <BookingHero onBack={() => navigate('home')} />
    <div className="booking-new-shell"><BookingProgress activeStep={1} />
      <form noValidate className="booking-new-grid" onSubmit={handleSubmit(review, (invalid) => setError(invalid.selectedServices?.message ?? invalid.phone?.message ?? invalid.notes?.message ?? 'Please complete the required fields.'))}>
        <div className="booking-form">
          <BookingSection number="01" title="Select your services" description="Add one or more requirements to the same booking slot.">
            {activeServiceEntries.map((entry, index) => <BookingServiceItem key={entry.id} entry={entry} index={index} options={options} value={serviceDetails[entry.id] ?? serviceDraftFor(entry.serviceId)} errors={serviceFieldErrors[entry.id]} onServiceChange={changeServiceEntry} onFieldChange={updateServiceDetails} onRemove={removeServiceEntry} />)}
            {!activeServiceEntries.length && <p className="booking-no-services" role="status">Select at least one service to enter delivery and contact details.</p>}
            <div className="booking-add-service"><label className="field">Add another service<select value={serviceToAdd || options[0]?.code || ''} onChange={(event) => setServiceToAdd(event.target.value)}>{options.map((option) => <option value={option.code} key={option.code}>{option.label}</option>)}</select></label><button className="button button-quiet" type="button" disabled={!options.length} onClick={() => addServiceEntry()}><Plus size={16} /> Add another service</button>{serviceEntries.length > 0 && <button className="button button-quiet booking-remove-all" type="button" onClick={() => setConfirmRemoveAll(true)}><Trash2 size={15} /> Remove all services</button>}</div>
            {confirmRemoveAll && <div className="booking-remove-all-confirm" role="group" aria-label="Confirm removing all services"><span>Remove all {serviceEntries.length} service items?</span><button className="button button-quiet" type="button" onClick={() => setConfirmRemoveAll(false)}>Keep items</button><button className="button button-danger" type="button" onClick={removeAllServiceEntries}>Remove all</button></div>}
          </BookingSection>

          <BookingSection number="02" title="Contact & delivery location" description="These details apply to every service in this booking.">
            <label className="field">Customer / company name<input {...register('guestName')} required minLength={2} maxLength={60} placeholder="Your name or company" /></label>
            <Controller control={control} name="phone" render={({ field }) => <label className="field">Mobile number<span className="input-with-icon"><Phone size={16} /><input {...field} value={field.value ?? ''} aria-invalid={Boolean(errors.phone)} onChange={(event) => { field.onChange(event.target.value.replace(/\D/g, '').slice(0, 10)); setError(null) }} inputMode="numeric" type="tel" required placeholder="10-digit mobile number" /></span>{errors.phone?.message && <small className="booking-field-error" role="alert">{errors.phone.message}</small>}</label>} />
            {isRegisteredCustomer && <label className="field">Use a saved address<select value={savedAddressId} onChange={(event) => selectSavedAddress(event.target.value)}><option value="">Enter a new address</option>{(addressesQuery.data ?? []).map((address) => <option value={address.id} key={address.id}>{address.label} · {address.address}</option>)}</select></label>}
            {isRegisteredCustomer && addressesQuery.isLoading && <p className="booking-address-status" role="status">Loading saved addresses…</p>}
            {isRegisteredCustomer && addressesQuery.isError && <p className="booking-address-status" role="alert">Saved addresses are unavailable. Enter a new address instead.</p>}
            {savedAddressId && <p className="saved-location-preview">{sharedLocation}, {addressCity} {addressPincode}</p>}
            {!savedAddressId && <div className="booking-manual-location">
              <div className="split-fields"><label className="field">Service region<select value={region} onChange={(event) => setRegion(event.target.value)}><option>South Chennai</option><option>Central Chennai</option><option>North Chennai</option><option>West Chennai</option><option>ECR / OMR</option></select></label><label className="field">Address label<input value={addressLabel} onChange={(event) => setAddressLabel(event.target.value)} placeholder="Home, Office or Site" /></label></div>
              <label className="field">Full address<textarea rows={3} required value={sharedLocation} onBlur={() => activeServiceEntries.forEach((entry) => validateDeliveryAddress(entry.id, sharedLocation))} onChange={(event) => updateSharedLocation(event.target.value)} placeholder="Door number, street, locality and landmark, Chennai" /></label>
              <div className="booking-location-tools"><button className="button button-quiet" type="button" onClick={() => setLocationModalOpen(true)}><MapPin size={15} /> Choose on map</button><button className="button button-quiet" type="button" onClick={() => detectLocation('shared')}><Crosshair size={15} /> Use current location</button></div>
              {(locationToasts.shared || locationToasts[activeServiceEntries[0]?.id ?? '']) && <p className="booking-location-toast" role="alert">{locationToasts.shared || locationToasts[activeServiceEntries[0]?.id ?? '']}</p>}
              {locationStatus.shared && <p className="booking-address-status" role="status">{locationStatus.shared}</p>}
              {isRegisteredCustomer && <label className="check-line"><input type="checkbox" checked={saveAddressForFuture} onChange={(event) => setSaveAddressForFuture(event.target.checked)} /> Save this address to my account for future bookings.</label>}
              {saveAddressForFuture && <div className="split-fields booking-save-address-fields"><label className="field">City<input value={addressCity} onChange={(event) => setAddressCity(event.target.value)} required /></label><label className="field">Pincode<input value={addressPincode} onChange={(event) => setAddressPincode(event.target.value.replace(/\D/g, '').slice(0, 12))} inputMode="numeric" maxLength={12} required /></label></div>}
            </div>}
            <div className="guest-verification">
              <p className="eyebrow">MOBILE VERIFICATION</p>
              {isPhoneVerified(phone) ? <p className="verification-success">Mobile number verified. It can be used for all selected services.</p> : <>
                {user && phoneVerificationQuery.isError && <p className="booking-field-error" role="alert">We couldn't check whether your saved number is verified. Verify it below to continue.</p>}
                <p>Verify the shared contact number once for this booking.</p>
                <div className="guest-otp-row"><input value={otpValues[phone.replace(/\D/g, '').slice(-10)] ?? ''} onChange={(event) => setOtpValues((current) => ({ ...current, [phone.replace(/\D/g, '').slice(-10)]: event.target.value.replace(/\D/g, '').slice(0, 6) }))} inputMode="numeric" placeholder="6-digit code" aria-label="Mobile verification code" /><button className="button button-quiet" type="button" onClick={() => void requestGuestOtp()} disabled={otpPendingPhone !== null}>{otpChallenges[phone.replace(/\D/g, '').slice(-10)] ? 'Resend code' : 'Send code'}</button><button className="button button-quiet" type="button" onClick={() => void verifyGuestOtp()} disabled={otpPendingPhone !== null || !otpChallenges[phone.replace(/\D/g, '').slice(-10)]}>Verify</button></div>
                {otpMessages[phone.replace(/\D/g, '').slice(-10)] && <p className="verification-message" role="status">{otpMessages[phone.replace(/\D/g, '').slice(-10)]}</p>}
              </>}
            </div>
          </BookingSection>

          <BookingSection number="03" title="Choose one booking slot" description="All selected services are requested for this date and time.">
            <div className="split-fields"><label className="field">Required date<input type="date" min={currentDateInputValue()} required value={sharedDate} onChange={(event) => setSharedDate(event.target.value)} /></label><label className="field">Preferred time<select value={preferredTime} onChange={(event) => setPreferredTime(event.target.value)}><option value="07:00">7 AM – 10 AM</option><option value="10:00">10 AM – 1 PM</option><option value="14:00">2 PM – 5 PM</option><option value="18:00">6 PM – 9 PM</option></select></label></div>
            <label className="field">Additional requirements<textarea {...register('notes')} rows={3} placeholder="Access, parking, handling or site instructions" /></label>
            <div className="booking-coupon-row"><label className="field">Have a coupon?<input {...register('couponCode')} onChange={(event) => setValue('couponCode', event.target.value.toUpperCase())} placeholder="Enter coupon code" /></label><button className="button button-quiet" type="button" onClick={() => void applyCoupon()} disabled={couponValidation.isPending}>{couponValidation.isPending ? 'Checking…' : 'Apply coupon'}</button><p className="coupon-feedback" role="status">{couponMessage ?? ''}</p></div>
            <div className="booking-coupon-carousel"><div className="coupon-carousel-heading"><span>Available coupons</span><span><button type="button" className="coupon-scroll-button" aria-label="Scroll coupons left" onClick={() => document.querySelector('.booking-coupon-list')?.scrollBy({ left: -220, behavior: 'smooth' })}><ChevronLeft size={15} /></button><button type="button" className="coupon-scroll-button" aria-label="Scroll coupons right" onClick={() => document.querySelector('.booking-coupon-list')?.scrollBy({ left: 220, behavior: 'smooth' })}><ChevronRight size={15} /></button></span></div><div className="booking-coupon-list">{(offersQuery.data ?? []).map((offer) => <button type="button" className={`booking-coupon-card ${couponCode === offer.code ? 'is-selected' : ''}`} key={offer.code} onClick={() => void applyCoupon(offer.code)}><strong>{offer.code}</strong><span>{formatOfferDiscount(offer)}</span><small>{offer.title}{offer.valid_until ? ` · Valid through ${new Date(offer.valid_until).toLocaleDateString()}` : ' · No expiry date'}</small></button>)}</div></div>
          </BookingSection>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="button button-primary booking-review-button" type="submit" disabled={!canReviewRequest}>Review combined booking <ArrowRight size={16} /></button>
          {!canReviewRequest && <p className="booking-review-hint" role="status">Complete each service item, enter a Chennai address and valid date, and verify the shared mobile number.</p>}
        </div>
        <BookingSummary items={summaryItems} total={total} />
      </form>
    </div>
    {locationModalOpen && <Suspense fallback={<div className="surface booking-map-loading" role="status">Loading map…</div>}><LocationPickerModal value={sharedCoordinates} onChange={(point, name) => updateMapLocation('shared', point, name)} onClose={() => setLocationModalOpen(false)} /></Suspense>}
  </section>
}
