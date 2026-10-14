import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { customerApi } from '../api/customer'
import { apiFetch } from '../api/client'

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
  async function pay(amount: number, bookingId: string, customer: { name: string; email?: string; phone?: string }) {
    if (loading) throw new Error('A payment is already in progress.')
    setLoading(true); setError(null)
    setCompleted(false)
    try {
      const order = await customerApi.createPaymentOrder({ amount, bookingId })
      const Razorpay = await loadRazorpayWidget()
      await new Promise<void>((resolve, reject) => { let settled = false; const finish = (callback: () => void) => { if (settled) return; settled = true; callback() }; const checkout = new Razorpay({ key: order.keyId ?? import.meta.env.VITE_RAZORPAY_KEY_ID, amount: order.amount, currency: order.currency, name: 'Urban Tanker', order_id: order.id, prefill: customer, handler: async (result: { razorpay_payment_id: string; razorpay_signature: string }) => { try { await customerApi.verifyPayment({ orderId: order.id, paymentId: result.razorpay_payment_id, signature: result.razorpay_signature }); finish(() => { setCompleted(true); resolve() }) } catch (verificationError) { finish(() => reject(verificationError)) } }, modal: { ondismiss: () => finish(() => reject(new Error('Payment cancelled'))) } }); checkout.open() })
    } catch (paymentError) { const message = paymentError instanceof Error ? paymentError.message : 'Payment could not be completed.'; setError(message); throw paymentError } finally { setLoading(false) }
  }
  return { pay, loading, error, completed }
}

export function useCouponValidation() { return useMutation({ mutationFn: (payload: { code: string; serviceCode?: string; amount: number }) => apiFetch<{ valid: boolean; coupon: unknown }>('/customer/coupons/validate', { method: 'POST', body: JSON.stringify(payload) }) }) }

export function useFileUpload() {
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [controller, setController] = useState<AbortController | null>(null)
  async function upload(file: File, ownerType: string, ownerId: string) { const abortController = new AbortController(); setController(abortController); setProgress(1); setError(null); try { const signed = await apiFetch<{ signedUrl: string; path: string; token: string }>('/uploads/signed-url', { method: 'POST', body: JSON.stringify({ path: `${ownerType}/${ownerId}/${file.name}` }), signal: abortController.signal }); const response = await fetch(signed.signedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'true' }, body: file, signal: abortController.signal }); if (!response.ok) throw new Error('Upload failed.'); setProgress(100); return signed } catch (uploadError) { if ((uploadError as Error).name !== 'AbortError') setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.'); throw uploadError } finally { setController(null) } }
  return { upload, progress, error, cancel: () => controller?.abort(), reset: () => { setProgress(0); setError(null) } }
}

export async function loadRazorpayWidget() {
  if (window.Razorpay) return window.Razorpay
  await new Promise<void>((resolve, reject) => { const script = document.createElement('script'); script.src = 'https://checkout.razorpay.com/v1/checkout.js'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Payment widget could not load.')); document.head.appendChild(script) })
  if (!window.Razorpay) throw new Error('Payment widget is unavailable.')
  return window.Razorpay
}

declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => { open: () => void } } }
