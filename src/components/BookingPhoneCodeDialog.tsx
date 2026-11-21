import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { MessageCircle, MessageSquare } from 'lucide-react'
import { Modal } from './Modal'

export function BookingPhoneCodeDialog({ phone, channel, busy, onVerify, onClose }: {
  phone: string
  channel: 'whatsapp' | 'sms'
  busy: boolean
  onVerify: (code: string) => Promise<void>
  onClose: () => void
}) {
  const [digits, setDigits] = useState(Array.from({ length: 6 }, () => ''))
  const [error, setError] = useState<string | null>(null)
  const inputRefs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => inputRefs.current[0]?.focus(), [])

  function pasteCode(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!pasted) return
    event.preventDefault()
    setDigits([...pasted, ...Array.from({ length: 6 - pasted.length }, () => '')])
    inputRefs.current[Math.min(pasted.length, 5)]?.focus()
  }

  function changeDigit(index: number, value: string) {
    const entered = value.replace(/\D/g, '')
    const next = [...digits]
    if (entered.length > 1) {
      entered.slice(0, 6).split('').forEach((digit, offset) => { next[offset] = digit })
      setDigits(next)
      inputRefs.current[Math.min(entered.length, 5)]?.focus()
      return
    }
    next[index] = entered
    setDigits(next)
    if (entered && index < 5) inputRefs.current[index + 1]?.focus()
  }

  function keyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) inputRefs.current[index - 1]?.focus()
    if (event.key === 'ArrowLeft' && index > 0) inputRefs.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < 5) inputRefs.current[index + 1]?.focus()
  }

  async function verify() {
    if (digits.join('').length !== 6) {
      setError('Enter the 6-digit code.')
      return
    }
    setError(null)
    try {
      await onVerify(digits.join(''))
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : 'The code could not be verified.')
    }
  }

  return <Modal title="Verify booking phone" onClose={onClose} contentClassName="booking-phone-code-modal">
    <div className="booking-phone-code-content">
      <p className={`otp-delivery otp-delivery-${channel}`}>
        {channel === 'whatsapp' ? <MessageCircle size={18} aria-hidden="true" /> : <MessageSquare size={18} aria-hidden="true" />}
        <span>Enter the code sent via {channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} to +91 {phone}.</span>
      </p>
      <div className="booking-phone-code-inputs" role="group" aria-label="6-digit verification code">
        {digits.map((digit, index) => <input
          key={index}
          ref={(element) => { inputRefs.current[index] = element }}
          aria-label={`Digit ${index + 1} of 6`}
          inputMode="numeric"
          autoComplete="off"
          maxLength={1}
          value={digit}
          onChange={(event) => changeDigit(index, event.target.value)}
          onKeyDown={(event) => keyDown(index, event)}
          onPaste={pasteCode}
        />)}
      </div>
      {error && <p className="profile-dialog-error" role="alert">{error}</p>}
      <button className="button button-primary button-large" type="button" onClick={() => void verify()} disabled={busy || digits.join('').length !== 6}>{busy ? 'Verifying…' : 'Verify'}</button>
    </div>
  </Modal>
}
