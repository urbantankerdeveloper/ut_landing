import { useEffect, useMemo, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, CreditCard, Crosshair, Droplets, MapPin, Phone, Tag, Wallet } from 'lucide-react'
import { useNavigationStore } from '../stores/navigationStore'
import { useCreateCustomerBooking, useCustomerOffers, useCustomerServices } from '../hooks/useCustomerData'
import { useCouponValidation, useRazorpayPayment } from '../hooks/useFrontendFeatures'
import { useAuthStore } from '../stores/authStore'
import { customerApi, type BookingPaymentMethod, type BookingServiceDetails } from '../api/customer'
import { customerDemoDataEnabled } from '../constants/demo'
import { trackEvent } from '../services/analytics'
import { LocationPickerModal } from '../components/LocationPickerModal'
import type { LatLngLiteral } from 'leaflet'
import { reverseGeocodeApproximate } from '../services/geocoding'

const GST_RATE = 0.18
type Step = 'details' | 'review' | 'payment' | 'success'

type CouponRecord = { discount_type?: string; discount_value?: number | string; discount?: number | string }
const bookingFormSchema = z.object({
  selectedServices: z.array(z.string()).min(1, 'Select at least one service.'),
  capacity: z.string().optional(),
  location: z.string().min(3, 'Enter a delivery location.'),
  deliveryDate: z.string().min(10, 'Select a delivery date.'),
  notes: z.string().optional(),
  paymentMethod: z.enum(['wallet', 'gateway', 'cod']),
  couponCode: z.string().optional(),
  phone: z.string().regex(/^\d{10}$/, 'Enter a valid 10-digit mobile number.'),
  guestName: z.string().optional(),
})
type BookingFormValues = z.infer<typeof bookingFormSchema>
type BookingDraft = {
  selectedServices: string[]
  serviceDetails: Record<string, { capacity: string; notes: string }>
  capacity: string
  step: Step
  details: { location: string; deliveryDate: string; notes: string }
  locationAddress: string
  coordinates: { latitude: number; longitude: number } | null
  locationStatus: string | null
  paymentMethod: BookingPaymentMethod
  couponCode: string
  couponDiscount: number
  phone: string
  guestName: string
  guestChallengeId: string | null
  bookingId: string | null
  quotedTotal: number | null
}

const BOOKING_DRAFT_KEY = 'urban-tanker-booking-draft'

function loadBookingDraft(): Partial<BookingDraft> {
  try {
    const stored = sessionStorage.getItem(BOOKING_DRAFT_KEY)
    if (!stored) return {}
    const parsed = JSON.parse(stored) as Partial<BookingDraft>
    return parsed.step === 'success' ? {} : parsed
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

function getServiceFormLabels(code: string) {
  switch (code) {
    case 'water_tanker':
      return { quantity: 'Delivery capacity (litres)', quantityHint: 'For example, 5,000 litres', details: 'Water type and delivery requirements', detailsHint: 'Tell us the water type, intended use, and any delivery requirements' }
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
  const signIn = useAuthStore((state) => state.signIn)
  const offersQuery = useCustomerOffers()
  const options = (servicesQuery.data ?? []).map((service) => ({ code: service.code, label: service.name, price: service.base_price_paise / 100 }))
  const { control, register, handleSubmit, setValue, formState: { errors } } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    mode: 'onChange',
    defaultValues: {
      selectedServices: draft.selectedServices ?? [],
      capacity: draft.capacity ?? '',
      location: draft.details?.location ?? draft.locationAddress ?? '',
      deliveryDate: draft.details?.deliveryDate ?? '',
      notes: draft.details?.notes ?? '',
      paymentMethod: draft.paymentMethod ?? 'wallet',
      couponCode: draft.couponCode ?? '',
      phone: draft.phone ?? '',
      guestName: draft.guestName ?? '',
    },
  })
  const formValues = useWatch({ control })
  const selectedServices = useMemo(() => formValues.selectedServices ?? [], [formValues.selectedServices])
  const capacity = formValues.capacity ?? '5000'
  const details = useMemo(() => ({ location: formValues.location ?? '', deliveryDate: formValues.deliveryDate ?? '', notes: formValues.notes ?? '' }), [formValues.location, formValues.deliveryDate, formValues.notes])
  const paymentMethod = formValues.paymentMethod ?? 'wallet'
  const couponCode = formValues.couponCode ?? ''
  const phone = formValues.phone ?? ''
  const guestName = formValues.guestName ?? ''
  const [step, setStep] = useState<Step>(draft.step ?? 'details')
  const [locationAddress, setLocationAddress] = useState(draft.locationAddress ?? '')
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(draft.coordinates ?? null)
  const [locationStatus, setLocationStatus] = useState<string | null>(draft.locationStatus ?? null)
  const [serviceDetails, setServiceDetails] = useState(draft.serviceDetails ?? {})
  const [locationModalOpen, setLocationModalOpen] = useState(false)
  const [couponDiscount, setCouponDiscount] = useState(draft.couponDiscount ?? 0)
  const [couponMessage, setCouponMessage] = useState<string | null>(null)
  const [guestChallengeId, setGuestChallengeId] = useState<string | null>(draft.guestChallengeId ?? null)
  const [guestOtp, setGuestOtp] = useState('')
  const [guestOtpMessage, setGuestOtpMessage] = useState<string | null>(null)
  const [guestOtpPending, setGuestOtpPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [bookingId, setBookingId] = useState<string | null>(draft.bookingId ?? null)
  const [quotedTotal, setQuotedTotal] = useState<number | null>(draft.quotedTotal ?? null)
  const activeServices = selectedServices.filter((service) => options.some((option) => option.code === service))
  const servicesForQuote = activeServices.length ? activeServices : [options[0]?.code].filter((code): code is string => Boolean(code))
  const serviceItems: BookingServiceDetails[] = activeServices.map((serviceId) => ({
    serviceId,
    capacity: serviceDetails[serviceId]?.capacity ?? '',
    details: serviceDetails[serviceId]?.notes?.trim() ?? '',
  }))

  const subtotal = servicesForQuote.reduce((sum, code) => sum + (options.find((option) => option.code === code)?.price ?? 0), 0)
  const gst = Math.round(subtotal * GST_RATE)
  const total = Math.max(0, subtotal + gst - couponDiscount)

  useEffect(() => {
    if (step === 'success') {
      sessionStorage.removeItem(BOOKING_DRAFT_KEY)
      return
    }
    const bookingDraft: BookingDraft = { selectedServices, serviceDetails, capacity, step, details, locationAddress, coordinates, locationStatus, paymentMethod, couponCode, couponDiscount, phone, guestName, guestChallengeId, bookingId, quotedTotal }
    sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(bookingDraft))
  }, [selectedServices, serviceDetails, capacity, step, details, locationAddress, coordinates, locationStatus, paymentMethod, couponCode, couponDiscount, phone, guestName, guestChallengeId, bookingId, quotedTotal])

  function toggleService(service: string) { const current = selectedServices ?? []; setValue('selectedServices', current.includes(service) ? current.filter((item) => item !== service) : [...current, service], { shouldValidate: true }); setServiceDetails((currentDetails) => currentDetails[service] ? currentDetails : { ...currentDetails, [service]: { capacity: '', notes: '' } }) }
  function updateServiceDetails(service: string, field: 'capacity' | 'notes', value: string) { setServiceDetails((current) => ({ ...current, [service]: { capacity: current[service]?.capacity ?? '', notes: current[service]?.notes ?? '', [field]: value } })) }
  function updateMapLocation(point: LatLngLiteral, approximateName?: string) { setCoordinates({ latitude: point.lat, longitude: point.lng }); setLocationAddress(approximateName ?? 'Selected delivery area'); setValue('location', approximateName ?? 'Selected delivery area', { shouldValidate: true }); setLocationStatus('Delivery area selected and will be shared securely with the assigned fleet.') }
  async function updateDetectedLocation(point: LatLngLiteral) { setCoordinates({ latitude: point.lat, longitude: point.lng }); setLocationStatus('Finding nearby area…'); try { const approximateName = await reverseGeocodeApproximate(point); setLocationAddress(approximateName); setValue('location', approximateName, { shouldValidate: true }); setLocationStatus('Current location detected and will be shared securely with the assigned fleet.') } catch (error) { setLocationAddress('Selected delivery area'); setValue('location', 'Selected delivery area', { shouldValidate: true }); setLocationStatus('Current location detected, but the approximate area name is unavailable.'); console.warn(JSON.stringify({ event: 'location.reverse_geocode_failed', error: error instanceof Error ? error.message : 'Unknown error' })) } }
  function detectLocation() { if (!navigator.geolocation) { setLocationStatus('Location detection is not supported by this browser.'); return }; setLocationStatus('Detecting your current location…'); navigator.geolocation.getCurrentPosition((position) => { void updateDetectedLocation({ lat: position.coords.latitude, lng: position.coords.longitude }) }, (positionError) => { setLocationStatus(positionError.code === positionError.PERMISSION_DENIED ? 'Location permission was not granted. You can continue by entering the delivery address.' : 'Location could not be detected. You can continue by entering the delivery address.') }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }) }
  function review(values: BookingFormValues) { if (selectedServices.some((service) => !serviceDetails[service]?.notes.trim())) { setError('Add details for each selected service before continuing.'); return }; trackEvent('booking.started', { service: servicesForQuote.join(','), capacity: Number(values.capacity) || 0 }); setError(null); setStep('review') }
  async function applyCoupon(selectedCode = couponCode) { const code = selectedCode.trim().toUpperCase(); if (!code) { setCouponMessage('Enter a coupon code.'); return }; setValue('couponCode', code); setCouponMessage(null); try { const result = await couponValidation.mutateAsync({ code, serviceCode: selectedServices[0], amount: subtotal }); const discount = calculateDiscount(result.coupon as CouponRecord, subtotal); if (!result.valid || !discount) { setCouponDiscount(0); setCouponMessage('Coupon is not valid for this booking.'); return }; setCouponDiscount(discount); setCouponMessage(`Coupon applied. You saved INR ${discount.toLocaleString('en-IN')}.`) } catch (validationError) { setCouponDiscount(0); setCouponMessage(validationError instanceof Error ? validationError.message : 'Coupon could not be validated.') } }
  async function requestGuestOtp() { const normalizedPhone = phone.replace(/\D/g, ''); if (!/^\d{10}$/.test(normalizedPhone)) { setGuestOtpMessage('Enter a valid 10-digit mobile number.'); return }; setGuestOtpPending(true); setGuestOtpMessage(null); try { const result = await customerApi.requestGuestOtp(normalizedPhone); setGuestChallengeId(result.challengeId); setGuestOtpMessage('Verification code sent. It expires in 10 minutes.') } catch (otpError) { setGuestOtpMessage(otpError instanceof Error ? otpError.message : 'We could not send the verification code.') } finally { setGuestOtpPending(false) } }
  async function verifyGuestOtp() { if (!guestChallengeId || !/^\d{6}$/.test(guestOtp)) { setGuestOtpMessage('Enter the 6-digit verification code.'); return }; setGuestOtpPending(true); setGuestOtpMessage(null); try { const session = await customerApi.verifyGuestOtp({ challengeId: guestChallengeId, phone: phone.replace(/\D/g, ''), otp: guestOtp, name: guestName.trim() || undefined }); signIn(session.user, session.accessToken); setGuestOtpMessage('Mobile number verified. Your booking is ready to continue.') } catch (otpError) { setGuestOtpMessage(otpError instanceof Error ? otpError.message : 'The verification code could not be confirmed.') } finally { setGuestOtpPending(false) } }
  async function confirmBooking() { setIsSubmitting(true); setError(null); try { if (!/^\d{10}$/.test(phone.replace(/\D/g, ''))) throw new Error('Enter a valid 10-digit mobile number before continuing.'); if (!user && !useAuthStore.getState().accessToken) throw new Error('Verify your mobile number before confirming the booking.'); const primaryService = serviceItems[0]; if (!primaryService) throw new Error('Select at least one available service before confirming.'); let currentBookingId = bookingId; let payableTotal = quotedTotal ?? total; if (!customerDemoDataEnabled && !currentBookingId) { const booking = await createBooking.mutateAsync({ serviceId: primaryService.serviceId, services: serviceItems, capacity: primaryService.capacity ?? capacity, location: details.location, deliveryDate: details.deliveryDate, notes: details.notes, couponCode, phone: phone.replace(/\D/g, ''), paymentMethod, ...coordinates }); currentBookingId = booking.id; payableTotal = Number(booking.quotedAmountPaise ?? 0) / 100 || total; setQuotedTotal(payableTotal); setBookingId(currentBookingId); trackEvent('booking.created', { service: servicesForQuote.join(','), capacity: Number(capacity) || 0, paymentMethod, bookingId: currentBookingId, locationDetected: Boolean(coordinates) }) }; if (!customerDemoDataEnabled && paymentMethod === 'gateway' && currentBookingId) await razorpay.pay(payableTotal, currentBookingId, { name: user?.name ?? (guestName || 'Urban Tanker customer'), email: user?.username, phone: `+91${phone.replace(/\D/g, '')}` }); sessionStorage.removeItem(BOOKING_DRAFT_KEY); setStep('success') } catch (paymentError) { setError(paymentError instanceof Error && paymentError.message === 'Payment cancelled' ? 'Payment cancelled. You can retry when you are ready.' : paymentError instanceof Error ? paymentError.message : 'We could not complete this booking. Check your connection and try again.') } finally { setIsSubmitting(false) } }

  if (step === 'success') return <section className="content-screen booking-screen"><div className="success-panel"><Droplets size={34} /><h2>Request received.</h2><p>Your combined request is ready for vendor matching. We will keep you updated.</p><button className="button button-primary" onClick={() => navigate('home')}>Return home <ArrowRight size={15} /></button></div></section>
  if (step === 'review' || step === 'payment') return <section className="content-screen booking-screen">
    <div className="section-intro"><p className="eyebrow">{step === 'review' ? 'REVIEW REQUEST' : 'SECURE PAYMENT'}</p><h1>{step === 'review' ? 'Check the details.' : 'Choose how to pay.'}</h1><p>{step === 'review' ? 'Review your combined services before moving to payment.' : 'Your payment is protected and linked to this booking.'}</p></div>
    <div className="booking-layout">
      <div className="booking-form">
        <section className="workspace-view-panel booking-review-panel">
          <p className="eyebrow">SERVICES</p>
          {serviceItems.map((item) => {
            const serviceName = options.find((option) => option.code === item.serviceId)?.label ?? item.serviceId
            return <div className="review-item" key={item.serviceId}><strong>{serviceName}</strong><p>{item.capacity || 'Quantity not specified'} · {item.details}</p><p>{details.location} · {details.deliveryDate}</p></div>
          })}
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
              {user ? <p className="verification-success">Your mobile number will receive booking updates and delivery OTP.</p> : <><p>Verify your mobile number once to continue as a guest.</p><div className="guest-otp-row"><input value={guestOtp} onChange={(event) => setGuestOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit code" aria-label="Mobile verification code" /><button className="button button-quiet" type="button" onClick={() => void requestGuestOtp()} disabled={guestOtpPending}>{guestChallengeId ? 'Resend code' : 'Send code'}</button><button className="button button-quiet" type="button" onClick={() => void verifyGuestOtp()} disabled={guestOtpPending || !guestChallengeId}>Verify</button></div>{guestOtpMessage && <p className="verification-message" role="status">{guestOtpMessage}</p>}</>}
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
    <form noValidate className="booking-layout" onSubmit={handleSubmit(review, (invalid) => setError(invalid.phone?.message ?? invalid.location?.message ?? invalid.deliveryDate?.message ?? 'Please complete the required fields.'))}>
      <div className="booking-form">
        <fieldset><legend>Choose one or more services</legend><div className="product-grid">{options.map((option) => <label className={`product-card ${selectedServices.includes(option.code) ? 'selected' : ''}`} key={option.code}><input type="checkbox" name="service" checked={selectedServices.includes(option.code)} onChange={() => toggleService(option.code)} /><Droplets size={21} /><b>{option.label}</b><small>Verified local availability</small></label>)}</div></fieldset>
        {activeServices.map((service) => {
          const serviceName = options.find((option) => option.code === service)?.label ?? service
          const formLabels = getServiceFormLabels(service)
          const values = serviceDetails[service] ?? { capacity: '', notes: '' }
          return <fieldset className="service-detail-form" key={service}>
            <legend>{serviceName} details</legend>
            <label className="field"><span>{formLabels.quantity} <small>Optional</small></span><input value={values.capacity} onChange={(event) => updateServiceDetails(service, 'capacity', event.target.value)} placeholder={formLabels.quantityHint} /></label>
            <label className="field"><span>{formLabels.details}</span><textarea required aria-label={`${formLabels.details} for ${serviceName}`} value={values.notes} onChange={(event) => updateServiceDetails(service, 'notes', event.target.value)} rows={3} placeholder={formLabels.detailsHint} /></label>
          </fieldset>
        })}
        <div className="field-row">
          <label className="field"><span>Delivery location</span><span className="input-with-icon"><MapPin size={16} /><input {...register('location')} required value={locationAddress} onChange={(event) => { setLocationAddress(event.target.value); setValue('location', event.target.value, { shouldValidate: true }); setCoordinates(null) }} placeholder="Area, street or landmark" /></span><div className="location-actions"><button className="button button-quiet" type="button" onClick={() => setLocationModalOpen(true)}><MapPin size={15} /> Choose on map</button><button className="button button-quiet" type="button" onClick={detectLocation}><Crosshair size={15} /> Use current location</button></div>{locationStatus && <small role="status">{locationStatus}</small>}{errors.location?.message && <small className="login-error" role="alert">{errors.location.message}</small>}</label>
          <label className="field"><span>Preferred date</span><span className="input-with-icon"><CalendarDays size={16} /><input {...register('deliveryDate')} required type="date" /></span>{errors.deliveryDate?.message && <small className="login-error" role="alert">{errors.deliveryDate.message}</small>}</label>
        </div>
        <label className="field"><span>Mobile number</span><span className="input-with-icon"><Phone size={16} /><input {...register('phone')} onChange={(event) => setValue('phone', event.target.value.replace(/\D/g, '').slice(0, 10), { shouldValidate: true })} inputMode="numeric" type="tel" required placeholder="10-digit mobile number" /></span><small>We’ll use this number for booking updates and delivery OTP.</small>{errors.phone?.message && <small className="login-error" role="alert">{errors.phone.message}</small>}</label>
        {!user && <label className="field"><span>Your name <small>Optional</small></span><input {...register('guestName')} placeholder="Name for this booking" /></label>}
        <label className="field"><span>Delivery access notes <small>Optional</small></span><textarea {...register('notes')} rows={3} placeholder="Access notes or instructions for the delivery location" /></label>
        {error && <p className="login-error" role="alert">{error}</p>}
        <button className="button button-primary button-large" type="submit">Review request <ArrowRight size={16} /></button>
      </div>
      <aside className="quote-panel"><p className="eyebrow">YOUR REQUEST</p><h2>{selectedServices.length} service{selectedServices.length === 1 ? '' : 's'}</h2><p>Each service has its own details and quantity, combined into one booking.</p><div className="availability"><span className="pulse" /> Verified partners nearby</div></aside>
    </form>
    {locationModalOpen && <LocationPickerModal value={coordinates ? { lat: coordinates.latitude, lng: coordinates.longitude } : null} onChange={updateMapLocation} onClose={() => setLocationModalOpen(false)} />}
  </section>
}
