import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { MessageCircle, MessageSquare } from 'lucide-react'
import { authApi, type PhoneVerifyResult } from '../api/auth'
import { Modal } from './Modal'

type Props = {
  initialPhone?: string
  allowSkip: boolean
  onClose: () => void
  onVerified: (result: PhoneVerifyResult) => void | Promise<void>
}

const emptyOtp = () => Array.from({ length: 6 }, () => '')

export function PhoneVerifyDialog({ initialPhone = '', allowSkip, onClose, onVerified }: Props) {
  const [phone, setPhone] = useState(() => initialPhone.replace(/\D/g, '').slice(-10))
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [channel, setChannel] = useState<'whatsapp' | 'sms'>('whatsapp')
  const [otp, setOtp] = useState<string[]>(emptyOtp)
  const [step, setStep] = useState<'phone' | 'code' | 'success'>('phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendRemaining, setResendRemaining] = useState(0)
  const digitRefs = useRef<Array<HTMLInputElement | null>>([])
  const closeTimer = useRef<number | null>(null)

  useEffect(() => {
    if (step !== 'code' || resendRemaining <= 0) return
    const timer = window.setTimeout(() => setResendRemaining((remaining) => remaining - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendRemaining, step])

  useEffect(() => {
    if (step === 'code') digitRefs.current[0]?.focus()
  }, [step])

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  async function sendCode() {
    if (!/^\d{10}$/.test(phone)) {
      setError('Enter a valid 10-digit mobile number.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const challenge = await authApi.requestPhoneVerification(phone)
      setChallengeId(challenge.challengeId)
      setChannel(challenge.channel)
      setOtp(emptyOtp())
      setStep('code')
      setResendRemaining(Math.max(1, challenge.resendAfterSeconds))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The code could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  function pasteCode(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    event.preventDefault()
    setOtp([...pasted, ...Array.from({ length: 6 - pasted.length }, () => '')])
    digitRefs.current[Math.min(pasted.length, 5)]?.focus()
  }

  function changeDigit(index: number, value: string) {
    const digits = value.replace(/\D/g, '')
    if (digits.length > 1) {
      setOtp([...digits.slice(0, 6), ...Array.from({ length: Math.max(0, 6 - digits.length) }, () => '')])
      digitRefs.current[Math.min(digits.length, 5)]?.focus()
      return
    }
    const next = [...otp]
    next[index] = digits
    setOtp(next)
    if (digits && index < 5) digitRefs.current[index + 1]?.focus()
  }

  function handleDigitKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !otp[index] && index > 0) {
      digitRefs.current[index - 1]?.focus()
    }
    if (event.key === 'ArrowLeft' && index > 0) digitRefs.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < 5) digitRefs.current[index + 1]?.focus()
  }

  async function verifyCode() {
    if (!challengeId || otp.join('').length !== 6) {
      setError('Enter the 6-digit code.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await authApi.confirmPhoneVerification(phone, otp.join(''))
      await onVerified(result)
      setStep('success')
      closeTimer.current = window.setTimeout(onClose, 650)
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'The code could not be verified.')
    } finally {
      setBusy(false)
    }
  }

  function changeNumber() {
    setStep('phone')
    setChallengeId(null)
    setOtp(emptyOtp())
    setResendRemaining(0)
    setError(null)
  }

  const canClose = allowSkip || step === 'success'
  return <Modal
    title="Verify your phone number"
    onClose={canClose ? onClose : () => undefined}
    dismissible={canClose}
    contentClassName="phone-verify-modal"
  >
    <div className="phone-verify-content">
      {step === 'phone' && <>
        <p>Verify a phone number for your account. We’ll send a one-time code to this number.</p>
        <label className="phone-verify-label" htmlFor="phone-verify-number">Mobile number</label>
        <div className="phone-verify-number">
          <span aria-hidden="true">+91</span>
          <input
            id="phone-verify-number"
            autoFocus
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={phone}
            maxLength={10}
            onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))}
            aria-describedby="phone-verify-help"
          />
        </div>
        <p id="phone-verify-help" className="phone-verify-help">Enter your 10-digit Indian mobile number.</p>
        <button className="button button-primary phone-verify-action" type="button" onClick={() => void sendCode()} disabled={busy || phone.length !== 10}>
          {busy ? 'Sending…' : 'Send code'}
        </button>
      </>}

      {step === 'code' && <>
        <div className={`otp-delivery otp-delivery-${channel}`} role="status">
          {channel === 'whatsapp' ? <MessageCircle size={18} aria-hidden="true" /> : <MessageSquare size={18} aria-hidden="true" />}
          <span>We sent a code via {channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} to +91 {phone}.</span>
        </div>
        <p className="phone-verify-help">The code expires in 5 minutes.</p>
        <label className="phone-verify-label" id="phone-verify-code-label">6-digit code</label>
        <div className="phone-verify-otp" role="group" aria-labelledby="phone-verify-code-label">
          {otp.map((digit, index) => <input
            key={index}
            ref={(element) => { digitRefs.current[index] = element }}
            aria-label={`Digit ${index + 1} of 6`}
            autoComplete="off"
            inputMode="numeric"
            maxLength={1}
            value={digit}
            onChange={(event) => changeDigit(index, event.target.value)}
            onKeyDown={(event) => handleDigitKeyDown(index, event)}
            onPaste={pasteCode}
          />)}
        </div>
        <button className="button button-primary phone-verify-action" type="button" onClick={() => void verifyCode()} disabled={busy || otp.join('').length !== 6}>
          {busy ? 'Verifying…' : 'Verify'}
        </button>
        <div className="phone-verify-links">
          <button type="button" onClick={changeNumber} disabled={busy}>Change number</button>
          {resendRemaining > 0
            ? <span>Resend in {resendRemaining}s</span>
            : <button type="button" onClick={() => void sendCode()} disabled={busy}>Resend code</button>}
        </div>
      </>}

      {step === 'success' && <p className="phone-verify-success" role="status">Phone number verified successfully.</p>}
      {error && <p className="phone-verify-error" role="alert">{error}</p>}
      {allowSkip && step !== 'success' && <button className="phone-verify-skip" type="button" onClick={onClose}>Skip for now</button>}
    </div>
  </Modal>
}
