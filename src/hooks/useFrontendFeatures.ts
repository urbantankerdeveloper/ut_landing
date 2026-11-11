import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { customerApi } from '../api/customer'
import { apiFetch } from '../api/client'
import { CheckoutError, openRazorpayCheckout, type CheckoutSuccess, type RazorpayCustomer } from '../utils/razorpayCheckout'

export function useGeolocation() {
  const [position, setPosition] = useState<GeolocationPosition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  function requestLocation() { if (!navigator.geolocation) { setError('Location is not supported by this browser.'); return }; setLoading(true); navigator.geolocation.getCurrentPosition((next) => { setPosition(next); setError(null); setLoading(false) }, (reason) => { setError(reason.message); setLoading(false) }, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 }) }
  return { position, error, loading, requestLocation }
}

export function useRazorpayPayment() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [completed, setCompleted] = useState(false)
  // Throws CheckoutError('verification') carrying the Razorpay ids, so the caller can retry without paying again.
  async function verifyPending(pending: CheckoutSuccess) {
    try {
      await customerApi.verifyPayment({ orderId: pending.orderId, paymentId: pending.paymentId, signature: pending.signature })
      setCompleted(true)
    } catch (verificationError) {
      throw new CheckoutError('verification', verificationError instanceof Error ? verificationError.message : undefined, pending)
    }
  }
  async function pay(amount: number, bookingId: string, customer: RazorpayCustomer) {
    if (loading) throw new Error('A payment is already in progress.')
    setLoading(true); setError(null)
    setCompleted(false)
    try {
      const order = await customerApi.createPaymentOrder({ amount, bookingId })
      const result = await openRazorpayCheckout(order, customer)
      await verifyPending(result)
    } catch (paymentError) { const message = paymentError instanceof Error ? paymentError.message : 'Payment could not be completed.'; setError(message); throw paymentError } finally { setLoading(false) }
  }
  return { pay, verifyPending, loading, error, completed }
}

export function useCouponValidation() { return useMutation({ mutationFn: (payload: { code: string; serviceCode?: string; amount: number }) => apiFetch<{ valid: boolean; coupon: unknown }>('/customer/coupons/validate', { method: 'POST', body: JSON.stringify(payload) }) }) }

export function useFileUpload() {
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [controller, setController] = useState<AbortController | null>(null)
  async function upload(file: File, ownerType: string, ownerId: string) { const abortController = new AbortController(); setController(abortController); setProgress(1); setError(null); try { if (file.size > 10 * 1024 * 1024) throw new Error('Files must be 10 MB or smaller.'); const signed = await apiFetch<{ signedUrl: string; path: string; token: string }>('/uploads/signed-url', { method: 'POST', body: JSON.stringify({ path: `${ownerType}/${ownerId}/${file.name}`, contentType: file.type || 'application/octet-stream', size: file.size }), signal: abortController.signal }); const response = await fetch(signed.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' }, body: file, signal: abortController.signal }); if (!response.ok) throw new Error('Upload failed.'); setProgress(100); return signed } catch (uploadError) { if ((uploadError as Error).name !== 'AbortError') setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.'); throw uploadError } finally { setController(null) } }
  return { upload, progress, error, cancel: () => controller?.abort(), reset: () => { setProgress(0); setError(null) } }
}

