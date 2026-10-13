import { useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, Check, CreditCard, Droplets, MapPin, Tag, Wallet } from 'lucide-react'
import { useNavigationStore } from '../stores/navigationStore'
import { useCreateCustomerBooking } from '../hooks/useCustomerData'
import { useCouponValidation, useRazorpayPayment } from '../hooks/useFrontendFeatures'
import { useAuthStore } from '../stores/authStore'
import { demoDataEnabled } from '../constants/demo'

const options = ['Water tanker', 'Sewage tanker', 'Tank cleaning', 'Borewell service']
const GST_RATE = 0.18
const SERVICE_PRICE = 1850
type Step = 'details' | 'review' | 'payment' | 'success'

type CouponRecord = { discount_type?: string; discount_value?: number | string; discount?: number | string }

function calculateDiscount(coupon: CouponRecord, subtotal: number) {
  const value = Number(coupon.discount_value ?? coupon.discount ?? 0)
  if (!Number.isFinite(value) || value <= 0) return 0
  const isPercentage = ['percentage', 'percent', '%'].includes(String(coupon.discount_type ?? '').toLowerCase())
  return Math.min(isPercentage ? Math.round(subtotal * value / 100) : Math.round(value), subtotal)
}

export default function BookingScreen() {
  const navigate = useNavigationStore((state) => state.navigate)
  const createBooking = useCreateCustomerBooking()
  const razorpay = useRazorpayPayment()
  const couponValidation = useCouponValidation()
  const user = useAuthStore((state) => state.user)
  const [selectedServices, setSelectedServices] = useState<string[]>([options[0]])
  const [step, setStep] = useState<Step>('details')
  const [details, setDetails] = useState({ location: '', deliveryDate: '', notes: '' })
  const [paymentMethod, setPaymentMethod] = useState('wallet')
  const [couponCode, setCouponCode] = useState('')
  const [couponDiscount, setCouponDiscount] = useState(0)
  const [couponMessage, setCouponMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [bookingId, setBookingId] = useState<string | null>(null)

  const subtotal = selectedServices.length * SERVICE_PRICE
  const gst = Math.round(subtotal * GST_RATE)
  const total = Math.max(0, subtotal + gst - couponDiscount)

  function toggleService(service: string) { setSelectedServices((current) => current.includes(service) ? current.filter((item) => item !== service) : [...current, service]) }
  function review(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selectedServices.length) { setError('Select at least one service.'); return }; const values = new FormData(event.currentTarget); setDetails({ location: String(values.get('location')), deliveryDate: String(values.get('deliveryDate')), notes: String(values.get('notes') || '') }); setError(null); setStep('review') }
  async function applyCoupon() { const code = couponCode.trim(); if (!code) { setCouponMessage('Enter a coupon code.'); return }; setCouponMessage(null); try { const result = await couponValidation.mutateAsync({ code, serviceCode: selectedServices[0], amount: subtotal }); const discount = calculateDiscount(result.coupon as CouponRecord, subtotal); if (!result.valid || !discount) { setCouponDiscount(0); setCouponMessage('Coupon is not valid for this booking.'); return }; setCouponDiscount(discount); setCouponMessage(`Coupon applied. You saved INR ${discount.toLocaleString('en-IN')}.`) } catch (validationError) { setCouponDiscount(0); setCouponMessage(validationError instanceof Error ? validationError.message : 'Coupon could not be validated.') } }
  async function confirmBooking() { setIsSubmitting(true); setError(null); try { let currentBookingId = bookingId; if (!demoDataEnabled && !currentBookingId) { const booking = await createBooking.mutateAsync({ serviceId: selectedServices.join(','), capacity: 'standard', location: details.location, deliveryDate: details.deliveryDate, notes: details.notes }); currentBookingId = booking.id; setBookingId(currentBookingId) }; if (!demoDataEnabled && paymentMethod === 'gateway' && currentBookingId) await razorpay.pay(total, currentBookingId, { name: user?.name ?? 'Urban Tanker customer', email: user?.username }); setStep('success') } catch (paymentError) { setError(paymentError instanceof Error && paymentError.message === 'Payment cancelled' ? 'Payment cancelled. You can retry when you are ready.' : paymentError instanceof Error ? paymentError.message : 'We could not complete this booking. Check your connection and try again.') } finally { setIsSubmitting(false) } }

  if (step === 'success') return <section className="content-screen booking-screen"><div className="success-panel"><Droplets size={34} /><h2>Request received.</h2><p>Your combined request is ready for vendor matching. We will keep you updated.</p><button className="button button-primary" onClick={() => navigate('home')}>Return home <ArrowRight size={15} /></button></div></section>
  if (step === 'review' || step === 'payment') return <section className="content-screen booking-screen"><div className="section-intro"><p className="eyebrow">{step === 'review' ? 'REVIEW REQUEST' : 'SECURE PAYMENT'}</p><h1>{step === 'review' ? 'Check the details.' : 'Choose how to pay.'}</h1><p>{step === 'review' ? 'Review your combined services before moving to payment.' : 'Your payment is protected and linked to this booking.'}</p></div><div className="booking-layout"><div className="booking-form"><section className="workspace-view-panel booking-review-panel"><p className="eyebrow">SERVICES</p>{selectedServices.map((service) => <div className="review-item" key={service}><strong>{service}</strong><p>{details.location} · {details.deliveryDate}</p></div>)}<div className="review-item"><strong>Delivery notes</strong><p>{details.notes || 'No additional notes'}</p></div>{step === 'payment' && <><div className="coupon-entry"><label htmlFor="coupon-code">Coupon code</label><div><input id="coupon-code" value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="Enter coupon code" /><button className="button button-quiet" type="button" onClick={applyCoupon} disabled={couponValidation.isPending}><Tag size={15} />{couponValidation.isPending ? 'Checking' : 'Apply'}</button></div>{couponMessage && <p className={couponDiscount ? 'coupon-success' : 'coupon-error'} role="status">{couponMessage}</p>}</div><div className="booking-price-summary"><div><span>Services</span><b>INR {subtotal.toLocaleString('en-IN')}</b></div><div><span>GST (18%)</span><b>INR {gst.toLocaleString('en-IN')}</b></div>{couponDiscount > 0 && <div><span>Coupon discount</span><b>- INR {couponDiscount.toLocaleString('en-IN')}</b></div>}<div className="booking-price-total"><span>Total</span><b>INR {total.toLocaleString('en-IN')}</b></div></div></>}{step === 'review' ? <button className="button button-primary button-large" onClick={() => setStep('payment')}>Continue to payment <ArrowRight size={16} /></button> : <div className="payment-choice-list"><label className={paymentMethod === 'wallet' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'wallet'} onChange={() => setPaymentMethod('wallet')} /><Wallet size={18} /><span><b>Urban Tanker wallet</b><small>Use available balance</small></span></label><label className={paymentMethod === 'gateway' ? 'selected' : ''}><input type="radio" name="payment" checked={paymentMethod === 'gateway'} onChange={() => setPaymentMethod('gateway')} /><CreditCard size={18} /><span><b>Card or UPI</b><small>Secure payment gateway</small></span></label><button className="button button-primary button-large" disabled={isSubmitting} onClick={confirmBooking}>{isSubmitting ? 'Processing...' : `Confirm booking · INR ${total.toLocaleString('en-IN')}`} <Check size={16} /></button></div>}{error && <p className="login-error" role="alert">{error}</p>}</section><button className="back-link" onClick={() => setStep(step === 'payment' ? 'review' : 'details')}><ArrowLeft size={14} /> Back</button></div><aside className="quote-panel"><p className="eyebrow">YOUR REQUEST</p><h2>{selectedServices.length} service{selectedServices.length === 1 ? '' : 's'}</h2><p>GST is calculated at 18% for every selected service.</p><div className="availability"><span className="pulse" /> Verified partners nearby</div></aside></div></section>
  return <section className="content-screen booking-screen"><div className="section-intro"><p className="eyebrow">BOOK A SERVICE</p><h1>Tell us what you need.</h1><p>Combine services in one request, then review and pay securely.</p></div><form className="booking-layout" onSubmit={review}><div className="booking-form"><fieldset><legend>Choose one or more services</legend><div className="product-grid">{options.map((option) => <label className={`product-card ${selectedServices.includes(option) ? 'selected' : ''}`} key={option}><input type="checkbox" name="service" checked={selectedServices.includes(option)} onChange={() => toggleService(option)} /><Droplets size={21} /><b>{option}</b><small>Verified local availability</small></label>)}</div></fieldset><div className="field-row"><label className="field"><span>Delivery location</span><span className="input-with-icon"><MapPin size={16} /><input name="location" required placeholder="Area, street or landmark" /></span></label><label className="field"><span>Preferred date</span><span className="input-with-icon"><CalendarDays size={16} /><input name="deliveryDate" required type="date" /></span></label></div><label className="field"><span>Additional details <small>Optional</small></span><textarea name="notes" rows={4} placeholder="Capacity, access notes or anything else we should know" /></label>{error && <p className="login-error" role="alert">{error}</p>}<button className="button button-primary button-large" type="submit">Review request <ArrowRight size={16} /></button></div><aside className="quote-panel"><p className="eyebrow">YOUR REQUEST</p><h2>{selectedServices.length} service{selectedServices.length === 1 ? '' : 's'}</h2><p>Combine water, sanitation, cleaning, and infrastructure needs in one request.</p><div className="availability"><span className="pulse" /> Verified partners nearby</div></aside></form></section>
}
