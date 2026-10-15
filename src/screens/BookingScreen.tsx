import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Check, ChevronLeft, ChevronRight, CreditCard, Crosshair, Droplets, MapPin, Phone, Tag, Wallet } from 'lucide-react'
import { useNavigationStore } from '../stores/navigationStore'
import { useCreateCustomerBooking, useCustomerOffers, useCustomerServices } from '../hooks/useCustomerData'
import { useCouponValidation, useRazorpayPayment } from '../hooks/useFrontendFeatures'
import { useAuthStore } from '../stores/authStore'
import { customerApi } from '../api/customer'
import { demoDataEnabled } from '../constants/demo'
import { trackEvent } from '../services/analytics'
import { LocationPickerModal } from '../components/LocationPickerModal'
import type { LatLngLiteral } from 'leaflet'
import { reverseGeocodeApproximate } from '../services/geocoding'

const GST_RATE = 0.18
type Step = 'details' | 'review' | 'payment' | 'success'

type CouponRecord = { discount_type?: string; discount_value?: number | string; discount?: number | string }
type BookingDraft = {
  selectedServices: string[]
  capacity: string
  step: Step
  details: { location: string; deliveryDate: string; notes: string }
  locationAddress: string
  coordinates: { latitude: number; longitude: number } | null
  locationStatus: string | null
  paymentMethod: string
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
  const [selectedServices, setSelectedServices] = useState<string[]>(draft.selectedServices ?? [])
  const [capacity, setCapacity] = useState(draft.capacity ?? '5000')
  const [step, setStep] = useState<Step>(draft.step ?? 'details')
  const [details, setDetails] = useState(draft.details ?? { location: '', deliveryDate: '', notes: '' })
  const [locationAddress, setLocationAddress] = useState(draft.locationAddress ?? '')
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number } | null>(draft.coordinates ?? null)
  const [locationStatus, setLocationStatus] = useState<string | null>(draft.locationStatus ?? null)
  const [locationModalOpen, setLocationModalOpen] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState(draft.paymentMethod ?? 'wallet')
  const [couponCode, setCouponCode] = useState(draft.couponCode ?? '')
  const [couponDiscount, setCouponDiscount] = useState(draft.couponDiscount ?? 0)
  const [couponMessage, setCouponMessage] = useState<string | null>(null)
  const [phone, setPhone] = useState(draft.phone ?? '')
  const [guestName, setGuestName] = useState(draft.guestName ?? '')
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

  const subtotal = servicesForQuote.reduce((sum, code) => sum + (options.find((option) => option.code === code)?.price ?? 0), 0)
  const gst = Math.round(subtotal * GST_RATE)
  const total = Math.max(0, subtotal + gst - couponDiscount)

  useEffect(() => {
    if (step === 'success') {
      sessionStorage.removeItem(BOOKING_DRAFT_KEY)
      return
    }
    const bookingDraft: BookingDraft = { selectedServices, capacity, step, details, locationAddress, coordinates, locationStatus, paymentMethod, couponCode, couponDiscount, phone, guestName, guestChallengeId, bookingId, quotedTotal }
    sessionStorage.setItem(BOOKING_DRAFT_KEY, JSON.stringify(bookingDraft))
  }, [selectedServices, capacity, step, details, locationAddress, coordinates, locationStatus, paymentMethod, couponCode, couponDiscount, phone, guestName, guestChallengeId, bookingId, quotedTotal])

  function toggleService(service: string) { setSelectedServices((current) => current.includes(service) ? current.filter((item) => item !== service) : [...current, service]) }
  function updateMapLocation(point: LatLngLiteral, approximateName?: string) { setCoordinates({ latitude: point.lat, longitude: point.lng }); setLocationAddress(approximateName ?? 'Selected delivery area'); setLocationStatus('Delivery area selected and will be shared securely with the assigned fleet.') }
  async function updateDetectedLocation(point: LatLngLiteral) { setCoordinates({ latitude: point.lat, longitude: point.lng }); setLocationStatus('Finding nearby area…'); try { const approximateName = await reverseGeocodeApproximate(point); setLocationAddress(approximateName); setLocationStatus('Current location detected and will be shared securely with the assigned fleet.') } catch (error) { setLocationAddress('Selected delivery area'); setLocationStatus('Current location detected, but the approximate area name is unavailable.'); console.warn(JSON.stringify({ event: 'location.reverse_geocode_failed', error: error instanceof Error ? error.message : 'Unknown error' })) } }
  function detectLocation() { if (!navigator.geolocation) { setLocationStatus('Location detection is not supported by this browser.'); return }; setLocationStatus('Detecting your current location…'); navigator.geolocation.getCurrentPosition((position) => { void updateDetectedLocation({ lat: position.coords.latitude, lng: position.coords.longitude }) }, (positionError) => { setLocationStatus(positionError.code === positionError.PERMISSION_DENIED ? 'Location permission was not granted. You can continue by entering the delivery address.' : 'Location could not be detected. You can continue by entering the delivery address.') }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }) }
  function updatePhone(value: string) { const normalizedPhone = value.replace(/\D/g, '').slice(0, 10); setPhone(normalizedPhone); if (/^\d{10}$/.test(normalizedPhone)) setError(null) }
  function review(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!servicesForQuote.length) { setError('Select at least one service.'); return }; if (!/^\d{10}$/.test(phone)) { setError('Enter a valid 10-digit mobile number before reviewing your request.'); return }; const values = new FormData(event.currentTarget); setDetails({ location: String(values.get('location')), deliveryDate: String(values.get('deliveryDate')), notes: String(values.get('notes') || '') }); trackEvent('booking.started', { service: servicesForQuote.join(','), capacity: Number(capacity) || 0 }); setError(null); setStep('review') }
  async function applyCoupon(selectedCode = couponCode) { const code = selectedCode.trim().toUpperCase(); if (!code) { setCouponMessage('Enter a coupon code.'); return }; setCouponCode(code); setCouponMessage(null); try { const result = await couponValidation.mutateAsync({ code, serviceCode: selectedServices[0], amount: subtotal }); const discount = calculateDiscount(result.coupon as CouponRecord, subtotal); if (!result.valid || !discount) { setCouponDiscount(0); setCouponMessage('Coupon is not valid for this booking.'); return }; setCouponDiscount(discount); setCouponMessage(`Coupon applied. You saved INR ${discount.toLocaleString('en-IN')}.`) } catch (validationError) { setCouponDiscount(0); setCouponMessage(validationError instanceof Error ? validationError.message : 'Coupon could not be validated.') } }
  async function requestGuestOtp() { const normalizedPhone = phone.replace(/\D/g, ''); if (!/^\d{10}$/.test(normalizedPhone)) { setGuestOtpMessage('Enter a valid 10-digit mobile number.'); return }; setGuestOtpPending(true); setGuestOtpMessage(null); try { const result = await customerApi.requestGuestOtp(normalizedPhone); setGuestChallengeId(result.challengeId); setGuestOtpMessage('Verification code sent. It expires in 10 minutes.') } catch (otpError) { setGuestOtpMessage(otpError instanceof Error ? otpError.message : 'We could not send the verification code.') } finally { setGuestOtpPending(false) } }
  async function verifyGuestOtp() { if (!guestChallengeId || !/^\d{6}$/.test(guestOtp)) { setGuestOtpMessage('Enter the 6-digit verification code.'); return }; setGuestOtpPending(true); setGuestOtpMessage(null); try { const session = await customerApi.verifyGuestOtp({ challengeId: guestChallengeId, phone: phone.replace(/\D/g, ''), otp: guestOtp, name: guestName.trim() || undefined }); signIn(session.user, session.accessToken, session.refreshToken); setGuestOtpMessage('Mobile number verified. Your booking is ready to continue.') } catch (otpError) { setGuestOtpMessage(otpError instanceof Error ? otpError.message : 'The verification code could not be confirmed.') } finally { setGuestOtpPending(false) } }
  async function confirmBooking() { setIsSubmitting(true); setError(null); try { if (!/^\d{10}$/.test(phone.replace(/\D/g, ''))) throw new Error('Enter a valid 10-digit mobile number before continuing.'); if (!user && !useAuthStore.getState().accessToken) throw new Error('Verify your mobile number before confirming the booking.'); let currentBookingId = bookingId; let payableTotal = quotedTotal ?? total; if (!demoDataEnabled && !currentBookingId) { const booking = await createBooking.mutateAsync({ serviceId: servicesForQuote.join(','), capacity, location: details.location, deliveryDate: details.deliveryDate, notes: details.notes, couponCode, phone: phone.replace(/\D/g, ''), ...coordinates }); currentBookingId = booking.id; payableTotal = Number(booking.quotedAmountPaise ?? 0) / 100 || total; setQuotedTotal(payableTotal); setBookingId(currentBookingId); trackEvent('booking.created', { service: servicesForQuote.join(','), capacity: Number(capacity) || 0, paymentMethod, bookingId: currentBookingId, locationDetected: Boolean(coordinates) }) }; if (!demoDataEnabled && paymentMethod === 'gateway' && currentBookingId) await razorpay.pay(payableTotal, currentBookingId, { name: user?.name ?? (guestName || 'Urban Tanker customer'), email: user?.username, phone: `+91${phone.replace(/\D/g, '')}` }); sessionStorage.removeItem(BOOKING_DRAFT_KEY); setStep('success') } catch (paymentError) { setError(paymentError instanceof Error && paymentError.message === 'Payment cancelled' ? 'Payment cancelled. You can retry when you are ready.' : paymentError instanceof Error ? paymentError.message : 'We could not complete this booking. Check your connection and try again.') } finally { setIsSubmitting(false) } }

  if (step === 'success') return <section className="content-screen booking-screen"><div className="success-panel"><Droplets size={34} /><h2>Request received.</h2><p>Your combined request is ready for vendor matching. We will keep you updated.</p><button className="button button-primary" onClick={() => navigate('home')}>Return home <ArrowRight size={15} /></button></div></section>
  if (step === 'review' || step === 'payment') return <section className="content-screen booking-screen"><div className="section-intro"><p className="eyebrow">{step === 'review' ? 'REVIEW REQUEST' : 'SECURE PAYMENT'}</p><h1>{step === 'review' ? 'Check the details.' : 'Choose how to pay.'}</h1><p>{step === 'review' ? 'Review your combined services before moving to payment.' : 'Your payment is protected and linked to this booking.'}</p></div><div className="booking-layout"><div className="booking-form"><section className="workspace-view-panel booking-review-panel"><p className="eyebrow">SERVICES</p>{selectedServices.map((service) => <div className="review-item" key={service}><strong>{service}</strong><p>{details.location} · {details.deliveryDate}</p></div>)}<div className="review-item"><strong>Delivery notes</strong><p>{details.notes || 'No additional notes'}</p></div>{step === 'payment' && <><div className="coupon-entry"><label htmlFor="coupon-code">Coupon code</label><div><input id="coupon-code" value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="Enter coupon code" /><button className="button button-quiet" type="button" onClick={() => void applyCoupon()} disabled={couponValidation.isPending}><Tag size={15} />{couponValidation.isPending ? 'Checking' : 'Apply'}</button></div><div className="coupon-carousel-heading"><span>Available coupons</span><span><button type="button" className="coupon-scroll-button" aria-label="Scroll coupons left" onClick={() => document.querySelector('.booking-coupon-list')?.scrollBy({ left: -220, behavior: 'smooth' })}><ChevronLeft size={15} /></button><button type="button" className="coupon-scroll-button" aria-label="Scroll coupons right" onClick={() => document.querySelector('.booking-coupon-list')?.scrollBy({ left: 220, behavior: 'smooth' })}><ChevronRight size={15} /></button></span></div><div className="booking-coupon-list">{(offersQuery.data ?? []).map((offer) => <button type="button" className={`booking-coupon-card ${couponCode === offer.code ? 'is-selected' : ''}`} key={offer.code} onClick={() => void applyCoupon(offer.code)}><strong>{offer.code}</strong><span>{formatOfferDiscount(offer)}</span><small>{offer.title}{offer.valid_until ? ` · Valid through ${new Date(offer.valid_until).toLocaleDateString()}` : ' · No expiry date'}</small></button>)}</div>{couponMessage && <p className={couponDiscount ? 'coupon-success' : 'coupon-error'} role="status">{couponMessage}</p>}</div><div className="booking-price-summary"><div><span>Services</span><b>INR {subtotal.toLocaleString('en-IN')}</b></div><div><span>GST (18%)</span><b>INR {gst.toLocaleString('en-IN')}</b></div>{couponDiscount > 0 && <div><span>Coupon discount</span><b>- INR {couponDiscount.toLocaleString('en-IN')}</b></div>}<div className="booking-price-total"><span>Total</span><b>INR {total.toLocaleString('en-IN')}</b></div></div><div className="guest-verification"><p className="eyebrow">MOBILE VERIFICATION</p>{user ? <p className="verification-success">Your mobile number will receive booking updates and delivery OTP.</p> : <><p>Verify your mobile number once to continue as a guest.</p><div className="guest-otp-row"><input value={guestOtp} onChange={(event) => setGuestOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-digit code" aria-label="Mobile verification code" /><button className="button button-quiet" type="button" onClick={() => void requestGuestOtp()} disabled={guestOtpPending}>{guestChallengeId ? 'Resend code' : 'Send code'}</button><button className="button button-quiet" type="button" onClick={() => void verifyGuestOtp()} disabled={guestOtpPending || !guestChallengeId}>Verify</button></div>{guestOtpMessage && <p className="verification-message" role="status">{guestOtpMessage}</p>}</>}</div></>}{step === 'review' ? <button className="button button-primary button-large" onClick={() => setStep('payment')}>Continue to payment <ArrowRight size={16} /></button> : <div className="payment-choice-list"><label className={paymentMethod === 'wallet' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'wallet'} onChange={() => setPaymentMethod('wallet')} /><Wallet size={18} /><span><b>Urban Tanker wallet</b><small>Use available balance</small></span></label><label className={paymentMethod === 'gateway' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'gateway'} onChange={() => setPaymentMethod('gateway')} /><CreditCard size={18} /><span><b>Card or UPI</b><small>Secure payment gateway</small></span></label><button className="button button-primary button-large" disabled={isSubmitting} onClick={() => void confirmBooking()}>{isSubmitting ? 'Processing...' : `Confirm booking · INR ${total.toLocaleString('en-IN')}`} <Check size={16} /></button></div>}{error && <p className="login-error" role="alert">{error}</p>}</section><button className="back-link" onClick={() => setStep(step === 'payment' ? 'review' : 'details')}><ArrowLeft size={14} /> Back</button></div><aside className="quote-panel"><p className="eyebrow">YOUR REQUEST</p><h2>{selectedServices.length} service{selectedServices.length === 1 ? '' : 's'}</h2><p>GST is calculated at 18% for every selected service.</p><div className="availability"><span className="pulse" /> Verified partners nearby</div></aside></div></section>
  return <section className="content-screen booking-screen"><div className="section-intro"><p className="eyebrow">BOOK A SERVICE</p><h1>Tell us what you need.</h1><p>Combine services in one request, then review and pay securely.</p></div><form className="booking-layout" onSubmit={review}><div className="booking-form"><fieldset><legend>Choose one or more services</legend><div className="product-grid">{options.map((option) => <label className={`product-card ${selectedServices.includes(option.code) ? 'selected' : ''}`} key={option.code}><input type="checkbox" name="service" checked={selectedServices.includes(option.code)} onChange={() => toggleService(option.code)} /><Droplets size={21} /><b>{option.label}</b><small>Verified local availability</small></label>)}</div></fieldset><div className="field-row"><label className="field"><span>Delivery location</span><span className="input-with-icon"><MapPin size={16} /><input name="location" required value={locationAddress} onChange={(event) => { setLocationAddress(event.target.value); setCoordinates(null) }} placeholder="Area, street or landmark" /></span><div className="location-actions"><button className="button button-quiet" type="button" onClick={() => setLocationModalOpen(true)}><MapPin size={15} /> Choose on map</button><button className="button button-quiet" type="button" onClick={detectLocation}><Crosshair size={15} /> Use current location</button></div>{locationStatus && <small role="status">{locationStatus}</small>}</label><label className="field"><span>Preferred date</span><span className="input-with-icon"><CalendarDays size={16} /><input name="deliveryDate" required type="date" /></span></label></div><label className="field"><span>Mobile number</span><span className="input-with-icon"><Phone size={16} /><input value={phone} onChange={(event) => updatePhone(event.target.value)} inputMode="numeric" type="tel" required placeholder="10-digit mobile number" /></span><small>We’ll use this number for booking updates and delivery OTP.</small></label>{!user && <label className="field"><span>Your name <small>Optional</small></span><input value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="Name for this booking" /></label>}<label className="field"><span>Tanker capacity</span><select value={capacity} onChange={(event) => setCapacity(event.target.value)}><option value="1000">1,000 litres</option><option value="5000">5,000 litres</option><option value="10000">10,000 litres</option><option value="15000">15,000 litres</option></select></label><label className="field"><span>Additional details <small>Optional</small></span><textarea name="notes" rows={4} placeholder="Access notes or anything else we should know" /></label>{error && <p className="login-error" role="alert">{error}</p>}<button className="button button-primary button-large" type="submit">Review request <ArrowRight size={16} /></button></div><aside className="quote-panel"><p className="eyebrow">YOUR REQUEST</p><h2>{selectedServices.length} service{selectedServices.length === 1 ? '' : 's'}</h2><p>Combine water, sanitation, cleaning, and infrastructure needs in one request.</p><div className="availability"><span className="pulse" /> Verified partners nearby</div></aside></form>{locationModalOpen && <LocationPickerModal value={coordinates ? { lat: coordinates.latitude, lng: coordinates.longitude } : null} onChange={updateMapLocation} onClose={() => setLocationModalOpen(false)} />}</section>
}
