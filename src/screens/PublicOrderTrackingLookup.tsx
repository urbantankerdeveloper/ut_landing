import { useState, type FormEvent } from 'react'
import { customerApi, type PublicTracking, type PublicTrackingResult } from '../api/customer'
import { TrackingDetails } from './PublicTrackingScreen'
import { trackingContent as c } from '../content/tracking'

export default function PublicOrderTrackingLookup() {
  const [reference, setReference] = useState('')
  const [phone, setPhone] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [otp, setOtp] = useState('')
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [tracking, setTracking] = useState<PublicTracking | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  async function requestCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await customerApi.requestPublicTrackingOtp({ reference: reference.trim(), phone: phone.replace(/\D/g, '') })
      setChallengeId(result.challengeId)
      setNotice(result.message)
      setOtp('')
    } catch {
      setError(c.orderLookup.verificationFailed)
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!challengeId) return
    setBusy(true)
    setError('')
    try {
      const result: PublicTrackingResult = await customerApi.verifyPublicTrackingOtp({
        reference: reference.trim(),
        phone: phone.replace(/\D/g, ''),
        challengeId,
        otp,
      })
      setAccessToken(result.accessToken)
      setTracking(result)
      setNotice(c.orderLookup.expiresNotice)
    } catch {
      setError(c.orderLookup.verificationFailed)
    } finally {
      setBusy(false)
    }
  }

  async function refreshTracking() {
    if (!accessToken) return
    setRefreshing(true)
    setError('')
    try {
      setTracking(await customerApi.publicTrackingDetails({ reference: reference.trim(), accessToken }))
    } catch {
      setAccessToken(null)
      setTracking(null)
      setChallengeId(null)
      setError(c.orderLookup.refreshFailed)
    } finally {
      setRefreshing(false)
    }
  }

  function reset() {
    setChallengeId(null)
    setOtp('')
    setAccessToken(null)
    setTracking(null)
    setNotice('')
    setError('')
  }

  return (
    <div className="public-order-tracking">
      {!tracking && (
        <section className="reference-copy-card public-tracking-card public-order-lookup-card">
          <div className="view-panel-heading"><div><p className="eyebrow">{c.eyebrow}</p><h2>{c.orderLookup.title}</h2></div></div>
          <p>{c.orderLookup.copy}</p>
          <form className="public-order-lookup-form" onSubmit={requestCode}>
            <label>
              {c.orderLookup.referenceLabel}
              <input value={reference} onChange={(event) => setReference(event.target.value)} placeholder={c.orderLookup.referencePlaceholder} autoComplete="off" required />
            </label>
            <label>
              {c.orderLookup.phoneLabel}
              <input value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} type="tel" inputMode="numeric" autoComplete="tel" placeholder={c.orderLookup.phonePlaceholder} required />
            </label>
            <button className="button button-primary" type="submit" disabled={busy || phone.replace(/\D/g, '').length !== 10}>
              {busy && !challengeId ? 'Sending…' : c.orderLookup.requestCode}
            </button>
          </form>
          {notice && <p className="tracking-lookup-notice" role="status">{notice}</p>}
          {error && <p className="tracking-lookup-error" role="alert">{error}</p>}
        </section>
      )}
      {!tracking && challengeId && (
        <section className="reference-copy-card public-tracking-card public-order-lookup-card">
          <form className="public-order-lookup-form" onSubmit={verifyCode}>
            <label>
              {c.orderLookup.otpLabel}
              <input value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder={c.orderLookup.otpPlaceholder} required />
            </label>
            <button className="button button-primary" type="submit" disabled={busy || otp.length !== 6}>
              {busy ? 'Verifying…' : c.orderLookup.verifyCode}
            </button>
          </form>
          {error && <p className="tracking-lookup-error" role="alert">{error}</p>}
          <button className="text-button" type="button" onClick={reset}>{c.orderLookup.requestAnother}</button>
        </section>
      )}
      {tracking && (
        <>
          <TrackingDetails tracking={tracking} onRefresh={() => { void refreshTracking() }} refreshing={refreshing} />
          {error && <p className="tracking-lookup-error" role="alert">{error}</p>}
          <button className="text-button tracking-lookup-another" type="button" onClick={reset}>{c.orderLookup.requestAnother}</button>
        </>
      )}
    </div>
  )
}
