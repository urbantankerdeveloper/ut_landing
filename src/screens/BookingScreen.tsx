import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, CreditCard, Crosshair, Droplets, MapPin, Phone, Tag, Wallet, X } from 'lucide-react'
import { useNavigationStore } from '../stores/navigationStore'
import { useCreateCustomerBooking, useCustomerOffers, useCustomerPhoneVerification, useCustomerServices } from '../hooks/useCustomerData'
import { useCouponValidation, useRazorpayPayment } from '../hooks/useFrontendFeatures'
import { useAuthStore } from '../stores/authStore'
import { customerApi, type BookingPaymentMethod, type BookingServiceDetails, type CustomerBooking } from '../api/customer'
import { customerDemoDataEnabled } from '../constants/demo'
import { trackEvent } from '../services/analytics'
import { LocationPickerModal } from '../components/LocationPickerModal'
import type { LatLngLiteral } from 'leaflet'
import { isChennaiDeliveryAddress, lookupDeliveryPoint } from '../services/geocoding'
import { BOOKING_DRAFT_KEY, REPEAT_BOOKING_KEY } from '../constants/bookingDraft'

const GST_RATE = 0.18
type Step = 'details' | 'review' | 'payment' | 'success'

type CouponRecord = { discount_type?: string; discount_value?: number | string; discount?: number | string }
type ServiceFieldErrors = { deliveryDate?: string; notes?: string; capacity?: string; waterType?: string; location?: string }
type ServiceDraft = { capacity: string; waterType: string; tankerCount: string; notes: string; deliveryDate: string; location: string; latitude?: number; longitude?: number }
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
  selectedServices: string[]
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
  phoneChallenges?: Record<string, string>
  guestChallengeId?: string | null
  bookingId: string | null
  quotedTotal: number | null
}

function loadBookingDraft(): Partial<BookingDraft> {
  try {
    const repeatedBooking = sessionStorage.getItem(REPEAT_BOOKING_KEY)
    if (repeatedBooking) {
      const booking = JSON.parse(repeatedBooking) as CustomerBooking
      if (Array.isArray(booking.services) && booking.services.length > 0) {
        const serviceDetails = Object.fromEntries(booking.services.map((service) => [
          service.serviceId,
          {capacity: service.capacity ?? '', waterType: service.waterType ?? '', tankerCount: service.tankerCount ?? '', notes: service.details ?? '', deliveryDate: service.deliveryDate ?? booking.scheduledAt?.slice(0, 10) ?? '', location: service.location ?? booking.location ?? '', latitude: service.latitude ?? booking.latitude, longitude: service.longitude ?? booking.longitude},
        ]))
        return {
          selectedServices: booking.services.map((service) => service.serviceId),
          serviceDetails,
          capacity: booking.services[0]?.capacity ?? '',
          step: 'details',
          details: { location: '', notes: booking.notes ?? '' },
          phone: booking.phone?.replace(/\D/g, '').slice(-10) ?? '',
          paymentMethod: booking.paymentMethod ?? 'wallet',
          couponCode: '',
          couponDiscount: 0,
          guestName: '',
          phoneChallenges: {},
          bookingId: null,
          quotedTotal: null,
        }
      }
    }
    const stored = sessionStorage.getItem(BOOKING_DRAFT_KEY)
    if (!stored) return {}
    const parsed = JSON.parse(stored) as Partial<BookingDraft>
    if (parsed.step === 'success') return {}
    const savedServiceDetails = parsed.serviceDetails ?? {}
    return {
      ...parsed,
      serviceDetails: Object.fromEntries((parsed.selectedServices ?? []).map((serviceId) => {
        const service = savedServiceDetails[serviceId]
        return [serviceId, {
          capacity: service?.capacity ?? '',
          waterType: service?.waterType ?? '',
          tankerCount: service?.tankerCount ?? '',
          notes: service?.notes ?? '',
          deliveryDate: service?.deliveryDate ?? parsed.details?.deliveryDate ?? '',
          location: service?.location ?? parsed.details?.location ?? parsed.locationAddress ?? '',
          latitude: service?.latitude ?? parsed.coordinates?.latitude,
          longitude: service?.longitude ?? parsed.coordinates?.longitude,
        }]
      })),
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

function isValidDeliveryDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < currentDateInputValue()) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

function getServiceFormLabels(code: string) {
  switch (code) {
    case 'water_tanker':
      return { quantity: 'Delivery capacity (litres)', quantityHint: 'For example, 5,000 litres', details: 'Service requirements', detailsHint: 'Add any special delivery requirements' }
    case 'sewage_tanker':
      return { quantity: 'Tank capacity or volume', quantityHint: 'Approximate volume is fine', details: 'Waste type and collection details', detailsHint: 'Describe the waste type, collection point, and any access requirements' }
    case 'tank_cleaning':
      return { quantity: 'Tank size or number of tanks', quantityHint: 'For example, 2 rooftop tanks', details: 'Tank type and cleaning requirements', detailsHint: 'Describe the tank type, size, and access or cleaning requirements' }
    case 'borewell_service':
      return { quantity: 'Borewell depth (if known)', quantityHint: 'Approximate depth in feet or metres', details: 'Borewell issue and service needs', detailsHint: 'Describe the borewell issue and any site access requirements' }
    default:
      return { quantity: 'Quantity or capacity', quantityHint: 'Enter the quantity or capacity if applicable', details: 'Service requirements', detailsHint: 'Describe the work and any special requirements for this service' }
  }

}

export default function BookingScreen() {
  const draft = loadBookingDraft()
  const navigate = useNavigationStore((state) => state.navigate)
  const createBooking = useCreateCustomerBooking()
  const servicesQuery = useCustomerServices()
  const razorpay = useRazorpayPayment()
  const couponValidation = useCouponValidation()
  const user = useAuthStore((state) => state.user)
  const phoneVerificationQuery = useCustomerPhoneVerification(Boolean(user && !user.username.startsWith('guest_')))
  const signIn = useAuthStore((state) => state.signIn)
  const offersQuery = useCustomerOffers()
  const serviceCatalog = servicesQuery.data ?? []
  const options = serviceCatalog.map((service) => ({ code: service.code, label: service.name, price: service.base_price_paise / 100 }))
  const serviceConfig = (code: string) => serviceCatalog.find((service) => service.code === code)?.config
  const { control, register, handleSubmit, setValue, getValues, formState: { errors } } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    mode: 'onChange',
    defaultValues: {
      selectedServices: draft.selectedServices ?? [],
      capacity: draft.capacity ?? '',
      phone: draft.phone ?? '',
      notes: draft.details?.notes ?? '',
      paymentMethod: draft.paymentMethod ?? 'wallet',
      couponCode: draft.couponCode ?? '',
      guestName: draft.guestName ?? '',
    },
  })
  const formValues = useWatch({ control })
  const selectedServices = useMemo(() => formValues.selectedServices ?? [], [formValues.selectedServices])
  const capacity = formValues.capacity ?? '5000'
  const phone = formValues.phone ?? ''
  const details = useMemo(() => ({ notes: formValues.notes ?? '' }), [formValues.notes])
  const paymentMethod = formValues.paymentMethod ?? 'wallet'
  const couponCode = formValues.couponCode ?? ''
  const guestName = formValues.guestName ?? ''
  const [step, setStep] = useState<Step>(draft.step ?? 'details')
  const [serviceDetails, setServiceDetails] = useState(draft.serviceDetails ?? {})
  const [serviceFieldErrors, setServiceFieldErrors] = useState<Record<string, ServiceFieldErrors>>({})
  const [expandedServices, setExpandedServices] = useState(() => new Set<string>())
  const [locationModalOpen, setLocationModalOpen] = useState(false)
  const [locationServiceId, setLocationServiceId] = useState<string | null>(null)
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
  const activeServices = selectedServices.filter((service) => options.some((option) => option.code === service))
  const servicesForQuote = activeServices.length ? activeServices : [options[0]?.code].filter((code): code is string => Boolean(code))
  const serviceItems: BookingServiceDetails[] = activeServices.map((serviceId) => ({
    serviceId,
    capacity: serviceDetails[serviceId]?.capacity ?? '',
    waterType: serviceDetails[serviceId]?.waterType ?? '',
    tankerCount: serviceDetails[serviceId]?.tankerCount ?? '',
    details: serviceDetails[serviceId]?.notes?.trim() ?? '',
    deliveryDate: serviceDetails[serviceId]?.deliveryDate ?? '',
    location: serviceDetails[serviceId]?.location ?? '',
    latitude: serviceDetails[serviceId]?.latitude,
    longitude: serviceDetails[serviceId]?.longitude,
  }))

  const subtotal = servicesForQuote.reduce((sum, code) => sum + (options.find((option) => option.code === code)?.price ?? 0), 0)
  const gst = Math.round(subtotal * GST_RATE)
  const total = Math.max(0, subtotal + gst - couponDiscount)
  const canReviewRequest = activeServices.length > 0
    && activeServices.length === selectedServices.length
    && activeServices.every((service) => {
      const values = serviceDetails[service]
      return Boolean(
        values
        && isValidDeliveryDate(values.deliveryDate)
        && (service === 'water_tanker' || values.notes.trim().length >= 3)
        && values.notes.length <= 1000
        && values.capacity.trim().length <= 100
        && values.location.trim().length >= 3
        && values.location.trim().length <= 200
        && (locationEligibility[service] === true || isChennaiDeliveryAddress(values.location)),
      )
    })
    && /^\d{10}$/.test(phone.replace(/\D/g, '').slice(-10))
    && isPhoneVerified(phone)

  useEffect(() => {
    if (step === 'success') {
      sessionStorage.removeItem(BOOKING_DRAFT_KEY)
      return
    }
    const bookingDraft: BookingDraft = { selectedServices, serviceDetails, capacity, step, details, phone, paymentMethod, couponCode, couponDiscount, guestName, phoneChallenges, bookingId, quotedTotal }
    sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(bookingDraft))
  }, [selectedServices, serviceDetails, capacity, step, details, phone, paymentMethod, couponCode, couponDiscount, guestName, phoneChallenges, bookingId, quotedTotal])
  useEffect(() => {
    sessionStorage.removeItem(REPEAT_BOOKING_KEY)
  }, [])
  useEffect(() => {
    if (!phone && phoneVerificationQuery.data?.verified && phoneVerificationQuery.data.phone) {
      setValue('phone', phoneVerificationQuery.data.phone, { shouldValidate: true })
    }
  }, [phone, phoneVerificationQuery.data, setValue])

  function toggleService(service: string) { const current = selectedServices ?? []; const isSelected = current.includes(service); setValue('selectedServices', isSelected ? current.filter((item) => item !== service) : [...current, service], { shouldValidate: true }); setExpandedServices((expanded) => { const next = new Set(expanded); next.delete(service); return next }); setServiceFieldErrors((currentErrors) => { const next = { ...currentErrors }; delete next[service]; return next }); if (!isSelected) setServiceDetails((currentDetails) => currentDetails[service] ? currentDetails : { ...currentDetails, [service]: { capacity: '', waterType: '', tankerCount: '', notes: '', deliveryDate: '', location: '' } }) }
  function toggleServiceDetails(service: string) { setExpandedServices((expanded) => { const next = new Set(expanded); if (next.has(service)) next.delete(service); else next.add(service); return next }) }
  function updateServiceDetails(service: string, field: 'capacity' | 'waterType' | 'tankerCount' | 'notes' | 'deliveryDate' | 'location', value: string) {
    setServiceDetails((current) => ({ ...current, [service]: { capacity: current[service]?.capacity ?? '', waterType: current[service]?.waterType ?? '', tankerCount: current[service]?.tankerCount ?? '', notes: current[service]?.notes ?? '', deliveryDate: current[service]?.deliveryDate ?? '', location: current[service]?.location ?? '', latitude: field === 'location' ? undefined : current[service]?.latitude, longitude: field === 'location' ? undefined : current[service]?.longitude, [field]: value } }))
    if (field === 'location') {
      setLocationEligibility((current) => { const next = { ...current }; delete next[service]; return next })
      setLocationToasts((current) => { const next = { ...current }; delete next[service]; return next })
      setLocationStatus((current) => { const next = { ...current }; delete next[service]; return next })
    }
    setServiceFieldErrors((current) => { const errors = current[service]; if (!errors?.[field]) return current; const next = { ...current, [service]: { ...errors } }; delete next[service][field]; if (!Object.keys(next[service]).length) delete next[service]; return next })
  }
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
  function updateMapLocation(service: string, point: LatLngLiteral, _approximateName?: string) {
    setServiceDetails((current) => ({ ...current, [service]: { capacity: current[service]?.capacity ?? '', waterType: current[service]?.waterType ?? '', tankerCount: current[service]?.tankerCount ?? '', notes: current[service]?.notes ?? '', deliveryDate: current[service]?.deliveryDate ?? '', location: current[service]?.location ?? '', latitude: point.lat, longitude: point.lng } }))
    setLocationEligibility((current) => ({ ...current, [service]: true }))
    setLocationToasts((current) => { const next = { ...current }; delete next[service]; return next })
    setServiceFieldErrors((current) => { const errors = current[service]; if (!errors?.location) return current; const next = { ...current, [service]: { ...errors } }; delete next[service].location; if (!Object.keys(next[service]).length) delete next[service]; return next })
    setLocationStatus((current) => ({ ...current, [service]: 'Delivery area selected and will be shared securely with the assigned fleet.' }))
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
    for (const service of activeServices) {
      const values = serviceDetails[service] ?? { capacity: '', waterType: '', tankerCount: '', notes: '', deliveryDate: '', location: '' }
      const errors: ServiceFieldErrors = {}
      if (!values.deliveryDate) errors.deliveryDate = 'Choose a preferred delivery date.'
      else if (!isValidDeliveryDate(values.deliveryDate)) errors.deliveryDate = values.deliveryDate < today ? 'Choose today or a future date.' : 'Choose a valid delivery date.'
      if (service !== 'water_tanker' && values.notes.trim().length < 3) errors.notes = 'Enter at least 3 characters describing this service.'
      else if (values.notes.length > 1000) errors.notes = 'Service details must be 1,000 characters or fewer.'
      if (values.capacity.trim().length > 100) errors.capacity = 'Capacity or quantity must be 100 characters or fewer.'
      if (values.location.trim().length < 3) errors.location = 'Enter a delivery location for this service.'
      else if (values.location.trim().length > 200) errors.location = 'Delivery location must be 200 characters or fewer.'
      if (Object.keys(errors).length) fieldErrors[service] = errors
    }
    const outOfAreaServices = activeServices.map((service) => {
      if (fieldErrors[service]?.location || locationEligibility[service] === true) return false
      return !validateDeliveryAddress(service, serviceDetails[service]?.location ?? '')
    })
    activeServices.forEach((service, index) => {
      if (!outOfAreaServices[index]) return
      fieldErrors[service] = { ...fieldErrors[service], location: 'Choose a delivery location inside Chennai.' }
    })
    setServiceFieldErrors(fieldErrors)
    if (Object.keys(fieldErrors).length) {
      setExpandedServices(new Set(Object.keys(fieldErrors)))
      setError('Please correct the highlighted service details.')
      return
    }
    if (!isPhoneVerified(normalizedPhone)) {
      setError('Verify the shared mobile number with OTP before continuing.')
      return
    }
    trackEvent('booking.started', { service: servicesForQuote.join(','), capacity: Number(values.capacity) || 0 })
    setError(null)
    setStep('review')
  }
  async function applyCoupon(selectedCode = couponCode) { const code = selectedCode.trim().toUpperCase(); if (!code) { setCouponMessage('Enter a coupon code.'); return }; setValue('couponCode', code); setCouponMessage(null); try { const result = await couponValidation.mutateAsync({ code, serviceCode: selectedServices[0], amount: subtotal }); const discount = calculateDiscount(result.coupon as CouponRecord, subtotal); if (!result.valid || !discount) { setCouponDiscount(0); setCouponMessage('Coupon is not valid for this booking.'); return }; setCouponDiscount(discount); setCouponMessage(`Coupon applied. You saved INR ${discount.toLocaleString('en-IN')}.`) } catch (validationError) { setCouponDiscount(0); setCouponMessage(validationError instanceof Error ? validationError.message : 'Coupon could not be validated.') } }
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
        signIn(session.user, session.accessToken)
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
      let currentBookingId = bookingId
      let payableTotal = quotedTotal ?? total
      if (!customerDemoDataEnabled && !currentBookingId) {
        const booking = await createBooking.mutateAsync({
          serviceId: primaryService.serviceId,
          services: serviceItems,
          capacity: primaryService.capacity ?? capacity,
          location: primaryService.location ?? '',
          deliveryDate: primaryDeliveryDate,
          notes: details.notes,
          couponCode,
          phone: normalizedPhone,
          phoneVerificationChallengeId: phoneChallenges[normalizedPhone],
          latitude: primaryService.latitude,
          longitude: primaryService.longitude,
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

  if (step === 'success') return <section className="content-screen booking-screen"><div className="success-panel"><Droplets size={34} /><h2>Request received.</h2><p>Your combined request is ready for vendor matching. We will keep you updated.</p><button className="button button-primary" onClick={() => navigate('home')}>Return home <ArrowRight size={15} /></button></div></section>
  if (step === 'review' || step === 'payment') return <section className="content-screen booking-screen">
    <div className="section-intro"><p className="eyebrow">{step === 'review' ? 'REVIEW REQUEST' : 'SECURE PAYMENT'}</p><h1>{step === 'review' ? 'Check the details.' : 'Choose how to pay.'}</h1><p>{step === 'review' ? 'Review your combined services before moving to payment.' : 'Your payment is protected and linked to this booking.'}</p></div>
    <div className="booking-layout">
      <div className="booking-form">
        <section className="workspace-view-panel booking-review-panel">
          <p className="eyebrow">SERVICES</p>
          {serviceItems.map((item) => {
            const serviceName = options.find((option) => option.code === item.serviceId)?.label ?? item.serviceId
            return <div className="review-item" key={item.serviceId}><strong>{serviceName}</strong><p>{item.capacity || 'Quantity not specified'}{item.waterType ? ` · ${item.waterType}` : ''}{item.tankerCount ? ` · ${item.tankerCount} tanker${item.tankerCount === '1' ? '' : 's'}` : ''} · {item.details}</p><p>{item.location} · {item.deliveryDate}</p></div>
          })}
          <div className="review-item"><strong>Shared contact number</strong><p>{phone}</p></div>
          <div className="review-item"><strong>Delivery access notes</strong><p>{details.notes || 'No additional notes'}</p></div>
          {step === 'payment' && <>
            <div className="coupon-entry">
              <label htmlFor="coupon-code">Coupon code</label>
              <div><input id="coupon-code" {...register('couponCode')} onChange={(event) => setValue('couponCode', event.target.value.toUpperCase())} placeholder="Enter coupon code" /><button className="button button-quiet" type="button" onClick={() => void applyCoupon()} disabled={couponValidation.isPending}><Tag size={15} />{couponValidation.isPending ? 'Checking' : 'Apply'}</button></div>
              <div className="coupon-carousel-heading"><span>Available coupons</span><span><button type="button" className="coupon-scroll-button" aria-label="Scroll coupons left" onClick={() => document.querySelector('.booking-coupon-list')?.scrollBy({ left: -220, behavior: 'smooth' })}><ChevronLeft size={15} /></button><button type="button" className="coupon-scroll-button" aria-label="Scroll coupons right" onClick={() => document.querySelector('.booking-coupon-list')?.scrollBy({ left: 220, behavior: 'smooth' })}><ChevronRight size={15} /></button></span></div>
              <div className="booking-coupon-list">{(offersQuery.data ?? []).map((offer) => <button type="button" className={`booking-coupon-card ${couponCode === offer.code ? 'is-selected' : ''}`} key={offer.code} onClick={() => void applyCoupon(offer.code)}><strong>{offer.code}</strong><span>{formatOfferDiscount(offer)}</span><small>{offer.title}{offer.valid_until ? ` · Valid through ${new Date(offer.valid_until).toLocaleDateString()}` : ' · No expiry date'}</small></button>)}</div>
              {couponMessage && <p className={couponDiscount ? 'coupon-success' : 'coupon-error'} role="status">{couponMessage}</p>}
            </div>
            <div className="booking-price-summary"><div><span>Services</span><b>INR {subtotal.toLocaleString('en-IN')}</b></div><div><span>GST (18%)</span><b>INR {gst.toLocaleString('en-IN')}</b></div>{couponDiscount > 0 && <div><span>Coupon discount</span><b>- INR {couponDiscount.toLocaleString('en-IN')}</b></div>}<div className="booking-price-total"><span>Total</span><b>INR {total.toLocaleString('en-IN')}</b></div></div>
            <div className="guest-verification">
              <p className="eyebrow">MOBILE VERIFICATION</p>
              <p className="verification-success">This shared number is verified and will receive booking updates and delivery OTPs.</p>
            </div>
          </>}
          {step === 'review' ? <button className="button button-primary button-large" onClick={() => setStep('payment')}>Continue to payment <ArrowRight size={16} /></button> : <div className="payment-choice-list">
            <label className={paymentMethod === 'wallet' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'wallet'} onChange={() => setValue('paymentMethod', 'wallet')} /><Wallet size={18} /><span><b>Urban Tanker wallet</b><small>Use available balance</small></span></label>
            <label className={paymentMethod === 'gateway' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'gateway'} onChange={() => setValue('paymentMethod', 'gateway')} /><CreditCard size={18} /><span><b>Card or UPI</b><small>Secure payment gateway</small></span></label>
            <label className={paymentMethod === 'cod' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'cod'} onChange={() => setValue('paymentMethod', 'cod')} /><Wallet size={18} /><span><b>Cash on delivery</b><small>Pay the driver when your service is completed</small></span></label>
            <button className="button button-primary button-large" disabled={isSubmitting} onClick={() => void confirmBooking()}>{isSubmitting ? 'Processing...' : `Confirm booking · INR ${total.toLocaleString('en-IN')}`} <Check size={16} /></button>
          </div>}
          {error && <p className="login-error" role="alert">{error}</p>}
        </section>
        <button className="back-link" onClick={() => setStep(step === 'payment' ? 'review' : 'details')}><ArrowLeft size={14} /> Back</button>
      </div>
      <aside className="quote-panel"><p className="eyebrow">YOUR REQUEST</p><h2>{selectedServices.length} service{selectedServices.length === 1 ? '' : 's'}</h2><p>GST is calculated at 18% for every selected service.</p><div className="availability"><span className="pulse" /> Verified partners nearby</div></aside>
    </div>
  </section>
  return <section className="content-screen booking-screen">
    <div className="section-intro"><p className="eyebrow">BOOK A SERVICE</p><h1>Tell us what you need.</h1><p>Combine services in one request, then review and pay securely.</p></div>
    <form noValidate className="booking-layout" onSubmit={handleSubmit(review, (invalid) => setError(invalid.selectedServices?.message ?? invalid.phone?.message ?? invalid.notes?.message ?? 'Please complete the required fields.'))}>
      <div className="booking-form">
        <fieldset><legend>Choose one or more services</legend><div className="product-grid">{options.map((option) => <label className={`product-card ${selectedServices.includes(option.code) ? 'selected' : ''}`} key={option.code}><input type="checkbox" name="service" checked={selectedServices.includes(option.code)} onChange={() => toggleService(option.code)} /><Droplets size={21} /><b>{option.label}</b><small>Verified local availability</small></label>)}</div></fieldset>
        {activeServices.map((service) => {
          const serviceName = options.find((option) => option.code === service)?.label ?? service
          const formLabels = getServiceFormLabels(service)
          const values = serviceDetails[service] ?? { capacity: '', notes: '', deliveryDate: '', location: '' }
          return <fieldset className="service-detail-form" key={service}>
            <legend className="visually-hidden">{serviceName} details</legend>
            <div className="service-detail-heading">
              <button className="service-detail-toggle" type="button" aria-expanded={expandedServices.has(service)} onClick={() => toggleServiceDetails(service)}>
                <span>{serviceName} details</span><ChevronDown size={17} aria-hidden="true" />
              </button>
              <button className="service-detail-remove" type="button" aria-label={`Remove ${serviceName}`} onClick={() => toggleService(service)}><X size={18} aria-hidden="true" /></button>
            </div>
            {expandedServices.has(service) && <div className="service-detail-fields">
              <label className="field"><span>{formLabels.quantity} <small>Optional</small></span><select aria-invalid={Boolean(serviceFieldErrors[service]?.capacity)} value={values.capacity} onChange={(event) => updateServiceDetails(service, 'capacity', event.target.value)}><option value="">Select an option</option>{(serviceConfig(service)?.capacityOptions ?? []).map((option) => <option value={option} key={option}>{option}</option>)}</select>{serviceFieldErrors[service]?.capacity && <small className="booking-field-error" role="alert">{serviceFieldErrors[service].capacity}</small>}</label>
              {serviceConfig(service)?.waterTypeOptions && <label className="field"><span>Water type <small>Optional</small></span><select value={values.waterType} onChange={(event) => updateServiceDetails(service, 'waterType', event.target.value)}><option value="">Select water type</option>{serviceConfig(service)?.waterTypeOptions?.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>}
              {serviceConfig(service)?.tankerCountOptions && <label className="field"><span>Number of tankers <small>Maximum 5</small></span><select value={values.tankerCount} onChange={(event) => updateServiceDetails(service, 'tankerCount', event.target.value)}><option value="">Select number of tankers</option>{serviceConfig(service)?.tankerCountOptions?.map((option) => <option value={option} key={option}>{option}</option>)}</select></label>}
              <label className="field"><span>Preferred delivery date</span><span className="input-with-icon"><CalendarDays size={16} /><input aria-label={`Preferred delivery date for ${serviceName}`} aria-invalid={Boolean(serviceFieldErrors[service]?.deliveryDate)} min={currentDateInputValue()} required type="date" value={values.deliveryDate} onChange={(event) => updateServiceDetails(service, 'deliveryDate', event.target.value)} /></span>{serviceFieldErrors[service]?.deliveryDate && <small className="booking-field-error" role="alert">{serviceFieldErrors[service].deliveryDate}</small>}</label>
              {serviceConfig(service)?.detailOptions ? <label className="field"><span>{formLabels.details}</span><select aria-invalid={Boolean(serviceFieldErrors[service]?.notes)} required aria-label={`${formLabels.details} for ${serviceName}`} value={values.notes} onChange={(event) => updateServiceDetails(service, 'notes', event.target.value)}><option value="">Select an option</option>{serviceConfig(service)?.detailOptions?.map((option) => <option value={option} key={option}>{option}</option>)}</select>{serviceFieldErrors[service]?.notes && <small className="booking-field-error" role="alert">{serviceFieldErrors[service].notes}</small>}</label> : service !== 'water_tanker' && <label className="field"><span>{formLabels.details}</span><textarea aria-invalid={Boolean(serviceFieldErrors[service]?.notes)} maxLength={1000} required aria-label={`${formLabels.details} for ${serviceName}`} value={values.notes} onChange={(event) => updateServiceDetails(service, 'notes', event.target.value)} rows={3} placeholder={formLabels.detailsHint} />{serviceFieldErrors[service]?.notes && <small className="booking-field-error" role="alert">{serviceFieldErrors[service].notes}</small>}</label>}
              <label className="field delivery-location-field"><span>Delivery location for {serviceName}</span>
                <div className="delivery-location-row">
                  <span className="input-with-icon"><MapPin size={16} /><input aria-label={`Delivery location for ${serviceName}`} aria-invalid={Boolean(serviceFieldErrors[service]?.location)} maxLength={200} required value={values.location} onBlur={() => { if (locationEligibility[service] !== true) void validateDeliveryAddress(service, values.location) }} onChange={(event) => updateServiceDetails(service, 'location', event.target.value)} placeholder="Area, street or landmark, Chennai" /></span>
                  <span className="location-actions"><button className="button button-quiet" type="button" aria-label={`Choose ${serviceName} delivery location on map`} title="Choose on map" onClick={() => { setLocationServiceId(service); setLocationModalOpen(true) }}><MapPin size={17} /></button><button className="button button-quiet" type="button" aria-label={`Use current location for ${serviceName}`} title="Use current location" onClick={() => detectLocation(service)}><Crosshair size={17} /></button></span>
                </div>
                <small>Enter the address separately. Map selection stores latitude and longitude in the background.</small>
                {locationToasts[service] && <p className="booking-location-toast" role="alert">{locationToasts[service]}</p>}
                {locationStatus[service] && <small role="status">{locationStatus[service]}</small>}
                {serviceFieldErrors[service]?.location && <small className="booking-field-error" role="alert">{serviceFieldErrors[service].location}</small>}
              </label>
            </div>}
          </fieldset>
        })}
        {activeServices.length > 0 ? <>
          <Controller control={control} name="phone" render={({ field }) => <label className="field"><span>Mobile number</span><span className="input-with-icon"><Phone size={16} /><input {...field} value={field.value ?? ''} aria-invalid={Boolean(errors.phone)} onChange={(event) => { field.onChange(event.target.value.replace(/\D/g, '').slice(0, 10)); setError(null) }} inputMode="numeric" type="tel" required placeholder="10-digit mobile number" /></span><small>This shared number will receive booking updates and delivery OTP.</small>{errors.phone?.message && <small className="booking-field-error" role="alert">{errors.phone.message}</small>}</label>} />
          <div className="guest-verification">
            <p className="eyebrow">MOBILE VERIFICATION</p>
            {isPhoneVerified(phone) ? <p className="verification-success">Mobile number verified. It can be used for all selected services.</p> : <>
              {user && phoneVerificationQuery.isError && <p className="booking-field-error" role="alert">We couldn't check whether your saved number is verified. Verify the number below to continue.</p>}
              <p>Verify the shared contact number once for this booking.</p>
              <div className="guest-otp-row">
                <input value={otpValues[phone.replace(/\D/g, '').slice(-10)] ?? ''} onChange={(event) => setOtpValues((current) => ({ ...current, [phone.replace(/\D/g, '').slice(-10)]: event.target.value.replace(/\D/g, '').slice(0, 6) }))} inputMode="numeric" placeholder="6-digit code" aria-label="Mobile verification code" />
                <button className="button button-quiet" type="button" onClick={() => void requestGuestOtp()} disabled={otpPendingPhone !== null}>{otpChallenges[phone.replace(/\D/g, '').slice(-10)] ? 'Resend code' : 'Send code'}</button>
                <button className="button button-quiet" type="button" onClick={() => void verifyGuestOtp()} disabled={otpPendingPhone !== null || !otpChallenges[phone.replace(/\D/g, '').slice(-10)]}>Verify</button>
              </div>
              {otpMessages[phone.replace(/\D/g, '').slice(-10)] && <p className="verification-message" role="status">{otpMessages[phone.replace(/\D/g, '').slice(-10)]}</p>}
            </>}
          </div>
          {!user && <label className="field"><span>Your name <small>Optional</small></span><input {...register('guestName')} maxLength={60} placeholder="Name for this booking" /></label>}
          <label className="field"><span>Delivery access notes <small>Optional</small></span><textarea {...register('notes')} maxLength={500} rows={3} placeholder="Access notes or instructions for the delivery location" />{errors.notes?.message && <small className="booking-field-error" role="alert">{errors.notes.message}</small>}</label>
          {error && <p className="login-error" role="alert">{error}</p>}
          <button className="button button-primary button-large" type="submit" disabled={!canReviewRequest}>Review request <ArrowRight size={16} /></button>
          {!canReviewRequest && <p className="booking-review-hint" role="status">Complete each selected service’s required details, enter a Chennai delivery location, and verify the shared mobile number to continue.</p>}
        </> : <p className="booking-no-services" role="status">Select at least one service to enter delivery and contact details.</p>}
      </div>
      <aside className="quote-panel"><p className="eyebrow">YOUR REQUEST</p><h2>{selectedServices.length} service{selectedServices.length === 1 ? '' : 's'}</h2><p>Each service has its own details and quantity, combined into one booking.</p><div className="availability"><span className="pulse" /> Verified partners nearby</div></aside>
    </form>
    {locationModalOpen && locationServiceId && <LocationPickerModal value={serviceDetails[locationServiceId]?.latitude !== undefined && serviceDetails[locationServiceId]?.longitude !== undefined ? { lat: serviceDetails[locationServiceId].latitude!, lng: serviceDetails[locationServiceId].longitude! } : null} onChange={(point, name) => updateMapLocation(locationServiceId, point, name)} onClose={() => { setLocationModalOpen(false); setLocationServiceId(null) }} />}
  </section>
}
