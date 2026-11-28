import { useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, MessageCircle, MessageSquare } from 'lucide-react'
import { useAppNavigation } from '../routing/useAppNavigation'
import { useFeatureFlags } from '../hooks/useFeatureFlags'
import { partnerApi } from '../api/partner'
import { adminAccessApi } from '../api/adminAccess'
import { notifyError, notifySuccess } from '../utils/notify'

export default function RequestAdminAccessScreen() {
  const { navigate } = useAppNavigation()
  const flags = useFeatureFlags()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [reason, setReason] = useState('')
  const [otp, setOtp] = useState('')
  const [phoneChallengeId, setPhoneChallengeId] = useState<string | null>(null)
  const [otpChannel, setOtpChannel] = useState<'whatsapp' | 'sms' | null>(null)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  async function requestOtp() {
    if (!/^\d{10}$/.test(phone)) {
      notifyError('Enter a valid 10-digit mobile number.')
      return
    }
    setBusy(true)
    try {
      const result = await partnerApi.requestPhoneOtp(phone)
      setPhoneChallengeId(result.challengeId)
      setOtpChannel(result.channel)
      setOtp('')
      setPhoneVerified(false)
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'The phone code could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  async function verifyPhone() {
    if (!phoneChallengeId) return
    setBusy(true)
    try {
      await partnerApi.verifyPhoneOtp({ challengeId: phoneChallengeId, phone, otp })
      setPhoneVerified(true)
      notifySuccess('Phone number verified.')
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'The phone code could not be verified.')
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!phoneVerified || !phoneChallengeId) {
      notifyError('Verify your mobile number before submitting the request.')
      return
    }
    setBusy(true)
    try {
      const result = await adminAccessApi.submit({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone,
        reason: reason.trim(),
        phoneChallengeId,
      })
      setSubmitted(true)
      notifySuccess(result.message)
    } catch (error) {
      notifyError(error instanceof Error ? error.message : 'Your request could not be submitted.')
    } finally {
      setBusy(false)
    }
  }

  const enabled = flags.data?.admin_approval_required_enabled === true
  return <section className="auth-screen">
    <div className="auth-story">
      <button className="auth-story-brand" type="button" onClick={() => navigate('home')} aria-label="Back to Urban Tanker home">
        <img className="brand-mark" src="/urban-tanker-mark.png" width={512} height={512} decoding="async" alt="" aria-hidden="true" />
        <span>Urban <b>Tanker</b></span>
      </button>
      <div className="auth-story-content">
        <p className="eyebrow">ADMIN ACCESS</p>
        <h1>Request <em>access.</em></h1>
        <p>Submit your details and justification for review by an existing administrator.</p>
      </div>
      <div className="auth-orbit" aria-hidden="true" />
    </div>
    <div className="auth-panel">
      <button className="back-link" type="button" onClick={() => navigate('login')}><ArrowLeft size={14} /> Back to login</button>
      <div className="auth-panel-inner">
        <p className="eyebrow">REQUEST REVIEW</p>
        <h2>Request admin access</h2>
        {!flags.isSuccess ? <p className="auth-intro" role={flags.isError ? 'alert' : 'status'}>
          {flags.isError ? 'The request form settings could not be loaded. Please try again later.' : 'Loading request form…'}
        </p> : !enabled ? <p className="auth-intro" role="status">Admin access requests are not currently available.</p> : submitted ? <>
          <p className="auth-intro" role="status">Your request has been received and will be reviewed.</p>
          <button className="button button-primary button-large" type="button" onClick={() => navigate('login')}>Return to login <ArrowRight size={15} /></button>
        </> : <>
          <p className="auth-intro">Verify your phone number, then submit your request for review.</p>
          <form className="auth-form" onSubmit={submit} noValidate>
            <label htmlFor="admin-request-name">Full name</label>
            <input id="admin-request-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength={2} maxLength={60} required />
            <label htmlFor="admin-request-email">Email</label>
            <input id="admin-request-email" value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" maxLength={160} required />
            <label htmlFor="admin-request-phone">Phone number</label>
            <div className="admin-access-phone-row">
              <input id="admin-request-phone" value={phone} onChange={(event) => {
                const next = event.target.value.replace(/\D/g, '').slice(0, 10)
                if (next !== phone) {
                  setPhoneVerified(false)
                  setPhoneChallengeId(null)
                  setOtpChannel(null)
                  setOtp('')
                }
                setPhone(next)
              }} type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} required />
              <button className="button button-quiet" type="button" disabled={busy || phoneVerified} onClick={() => void requestOtp()}>
                {phoneChallengeId ? 'Send new code' : 'Send code'}
              </button>
            </div>
            {phoneChallengeId && !phoneVerified && <div className="admin-access-otp">
              <p className={`otp-delivery otp-delivery-${otpChannel ?? 'unknown'}`} role="status">
                {otpChannel === 'whatsapp' ? <MessageCircle size={18} /> : <MessageSquare size={18} />}
                <span>Enter the code sent via {otpChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'}.</span>
              </p>
              <label htmlFor="admin-request-otp">Phone verification code</label>
              <input id="admin-request-otp" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required />
              <button className="button button-quiet" type="button" disabled={busy || otp.length !== 6} onClick={() => void verifyPhone()}>Verify phone</button>
            </div>}
            {phoneVerified && <p className="admin-access-verified" role="status"><CheckCircle2 size={16} /> Phone verified</p>}
            <label htmlFor="admin-request-reason">Reason for requesting access</label>
            <textarea id="admin-request-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={2000} rows={5} required />
            <button className="button button-primary button-large" type="submit" disabled={busy || !phoneVerified}>{busy ? 'Please wait…' : 'Submit request'} {!busy && <ArrowRight size={15} />}</button>
          </form>
        </>}
      </div>
    </div>
  </section>
}
