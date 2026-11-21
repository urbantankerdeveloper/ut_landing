import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Check, ImagePlus, UserRound } from 'lucide-react'
import { ApiError } from '../api/client'
import { authApi, type AuthUser } from '../api/auth'
import { customerApi } from '../api/customer'
import { useAuthStore } from '../stores/authStore'
import { customerQueryKeys } from '../hooks/useCustomerData'
import { prepareSelfieJpeg } from '../utils/selfiePhoto'
import { Modal } from './Modal'

type CodeKind = 'email' | 'phone'
const emptyCode = () => Array.from({ length: 6 }, () => '')

export function ProfileDialog({ user, initialPhotoUrl, onClose }: {
  user: AuthUser
  initialPhotoUrl?: string
  onClose: () => void
}) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoError, setPhotoError] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(user.email ?? '')
  const [phone, setPhone] = useState(user.phone ?? '')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [emailChallenge, setEmailChallenge] = useState<string | null>(null)
  const [emailVerified, setEmailVerified] = useState(false)
  const [phoneChallenge, setPhoneChallenge] = useState<string | null>(null)
  const [phoneVerified, setPhoneVerified] = useState(false)
  const [phoneChannel, setPhoneChannel] = useState<'whatsapp' | 'sms' | null>(null)
  const [codeKind, setCodeKind] = useState<CodeKind | null>(null)
  const [code, setCode] = useState(emptyCode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const digitRefs = useRef<Array<HTMLInputElement | null>>([])
  const photoPreviewUrl = useRef<string | null>(null)
  const setAuthUser = useAuthStore((state) => state.setUser)
  const queryClient = useQueryClient()

  useEffect(() => {
    let active = true
    authApi.profileSelfie().then(({ url }) => {
      if (active) setPhotoUrl(url)
    }).catch((requestError: unknown) => {
      if (!active) return
      if (requestError instanceof ApiError && requestError.status === 404) return
      setPhotoError(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => () => {
    if (photoPreviewUrl.current) URL.revokeObjectURL(photoPreviewUrl.current)
  }, [])

  useEffect(() => {
    if (codeKind) digitRefs.current[0]?.focus()
  }, [codeKind])

  const emailChanged = email.trim().toLowerCase() !== (user.email ?? '').trim().toLowerCase()
  const phoneDigits = phone.replace(/\D/g, '').slice(-10)
  const phoneChanged = phoneDigits !== (user.phone ?? '').replace(/\D/g, '').slice(-10)
  const details: Array<[string, string]> = []
  if (user.username) details.push(['Username', user.username])

  function resetEditor() {
    setEditing(false)
    setName(user.name)
    setEmail(user.email ?? '')
    setPhone(user.phone ?? '')
    setPhoto(null)
    clearPhotoPreview()
    setEmailChallenge(null)
    setEmailVerified(false)
    setPhoneChallenge(null)
    setPhoneVerified(false)
    setCodeKind(null)
    setCode(emptyCode())
    setError(null)
    setNotice(null)
  }

  async function sendCode(kind: CodeKind) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (kind === 'email') {
        const result = await authApi.requestEmailLinkCode(email.trim().toLowerCase())
        setEmailChallenge(result.challengeId)
      } else {
        if (!/^\d{10}$/.test(phoneDigits)) throw new Error('Enter a valid 10-digit mobile number.')
        const result = await customerApi.requestGuestOtp(phoneDigits)
        setPhoneChallenge(result.challengeId)
        setPhoneChannel(result.channel)
      }
      setCode(emptyCode())
      setCodeKind(kind)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The code could not be sent.')
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode() {
    const otp = code.join('')
    if (otp.length !== 6) {
      setError('Enter the 6-digit code.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (codeKind === 'email' && emailChallenge) {
        const result = await authApi.confirmEmailLinkCode({ email: email.trim().toLowerCase(), challengeId: emailChallenge, otp })
        setEmailChallenge(result.challengeId)
        setEmailVerified(true)
      } else if (codeKind === 'phone' && phoneChallenge) {
        await customerApi.verifyContactPhoneOtp({ challengeId: phoneChallenge, phone: phoneDigits, otp })
        setPhoneVerified(true)
      } else {
        throw new Error('Request a new verification code.')
      }
      setNotice(`${codeKind === 'email' ? 'Email' : 'Phone number'} verified.`)
      setCodeKind(null)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'The code could not be verified.')
    } finally {
      setBusy(false)
    }
  }

  async function saveProfile() {
    setError(null)
    setNotice(null)
    if (emailChanged && !emailVerified) {
      setError('Verify the new email address before saving.')
      return
    }
    if (phoneChanged && !phoneVerified) {
      setError('Verify the new phone number before saving.')
      return
    }
    setBusy(true)
    try {
      const saved = await customerApi.updateProfile({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        ...(phoneChanged ? { phone: phoneDigits, phoneVerificationChallengeId: phoneChallenge! } : {}),
        ...(emailChanged ? { emailVerificationChallengeId: emailChallenge! } : {}),
      })
      const current = useAuthStore.getState().user
      if (current) setAuthUser({ ...current, name: saved.name, email: saved.email, phone: saved.phone, phoneVerified: saved.phoneVerified })
      await queryClient.invalidateQueries({ queryKey: customerQueryKeys.profile })
      if (photo) {
        try {
          await authApi.uploadProfileSelfie(await prepareSelfieJpeg(photo))
          const selfie = await authApi.profileSelfie()
          setPhotoUrl(selfie.url)
          setPhotoError(false)
        } catch (photoSaveError) {
          setNotice(`Profile details saved, but the photo could not be saved: ${photoSaveError instanceof Error ? photoSaveError.message : 'Please try again.'}`)
          setEditing(false)
          setBusy(false)
          return
        }
      }
      setNotice('Profile saved successfully.')
      setEditing(false)
      setPhoto(null)
      clearPhotoPreview()
      setEmailChallenge(null)
      setPhoneChallenge(null)
      setEmailVerified(false)
      setPhoneVerified(false)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'The profile could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  function selectPhoto(event: ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0]
    if (!selected) return
    setError(null)
    if (!selected.type.startsWith('image/')) {
      setError('Choose an image file.')
      return
    }
    setPhotoError(false)
    if (photoPreviewUrl.current) URL.revokeObjectURL(photoPreviewUrl.current)
    photoPreviewUrl.current = URL.createObjectURL(selected)
    setPhotoPreview(photoPreviewUrl.current)
    setPhoto(selected)
  }

  function clearPhotoPreview() {
    if (photoPreviewUrl.current) URL.revokeObjectURL(photoPreviewUrl.current)
    photoPreviewUrl.current = null
    setPhotoPreview(null)
  }

  function pasteCode(event: ClipboardEvent<HTMLInputElement>) {
    const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!digits) return
    event.preventDefault()
    setCode([...digits, ...Array.from({ length: 6 - digits.length }, () => '')])
    digitRefs.current[Math.min(digits.length, 5)]?.focus()
  }

  function updateDigit(index: number, value: string) {
    const digits = value.replace(/\D/g, '')
    const next = [...code]
    if (digits.length > 1) {
      digits.slice(0, 6).split('').forEach((digit, offset) => { next[offset] = digit })
      setCode(next)
      digitRefs.current[Math.min(digits.length, 5)]?.focus()
      return
    }
    next[index] = digits
    setCode(next)
    if (digits && index < 5) digitRefs.current[index + 1]?.focus()
  }

  function handleDigitKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !code[index] && index > 0) digitRefs.current[index - 1]?.focus()
    if (event.key === 'ArrowLeft' && index > 0) digitRefs.current[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < 5) digitRefs.current[index + 1]?.focus()
  }

  return <Modal title="My profile" onClose={onClose} contentClassName="profile-dialog-modal">
    <div className="profile-dialog">
      {photoPreview || photoUrl || initialPhotoUrl
        ? <img className="profile-dialog-photo" src={photoPreview ?? photoUrl ?? initialPhotoUrl ?? undefined} alt={`${user.name}'s profile`} />
        : <span className="profile-dialog-photo profile-dialog-photo-fallback" aria-hidden="true"><UserRound size={32} /></span>}
      {editing && <label className="profile-dialog-photo-picker"><ImagePlus size={16} /> Change profile picture<input type="file" accept="image/*" onChange={selectPhoto} /></label>}
      {photoError && <p className="profile-dialog-error" role="status">Profile photo could not be loaded.</p>}
      <strong className="profile-dialog-role">{user.role}</strong>

      <form className="profile-dialog-form" onSubmit={(event) => { event.preventDefault(); if (editing) void saveProfile() }}>
        <label>Full name<input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} maxLength={60} disabled={!editing || busy} /></label>
        <label>Email
          <div className="profile-dialog-input-action"><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setEmailVerified(false); setEmailChallenge(null) }} required disabled={!editing || busy} />{editing && emailChanged && <button type="button" className="button button-quiet" onClick={() => void sendCode('email')} disabled={busy || !email}>{emailVerified ? <><Check size={15} /> Verified</> : 'Send code'}</button>}</div>
        </label>
        <label>Mobile number
          <div className="profile-dialog-input-action"><span className="profile-dialog-prefix">+91</span><input type="tel" inputMode="numeric" maxLength={10} value={phone} onChange={(event) => { setPhone(event.target.value.replace(/\D/g, '').slice(0, 10)); setPhoneVerified(false); setPhoneChallenge(null) }} required disabled={!editing || busy} />{editing && phoneChanged && <button type="button" className="button button-quiet" onClick={() => void sendCode('phone')} disabled={busy || phoneDigits.length !== 10}>{phoneVerified ? <><Check size={15} /> Verified</> : 'Send code'}</button>}</div>
        </label>
        {editing && codeKind && <div className="profile-dialog-code">
          <p>{codeKind === 'email' ? `Enter the code sent to ${email}.` : `Enter the code sent via ${phoneChannel === 'whatsapp' ? 'WhatsApp' : 'SMS'} to +91 ${phoneDigits}.`}</p>
          <div className="profile-dialog-otp" role="group" aria-label="6-digit verification code">
            {code.map((digit, index) => <input key={index} ref={(element) => { digitRefs.current[index] = element }} aria-label={`Digit ${index + 1}`} inputMode="numeric" autoComplete="off" maxLength={1} value={digit} onChange={(event) => updateDigit(index, event.target.value)} onKeyDown={(event) => handleDigitKeyDown(index, event)} onPaste={pasteCode} />)}
          </div>
          <button type="button" className="button button-primary" onClick={() => void verifyCode()} disabled={busy || code.join('').length !== 6}>{busy ? 'Verifying…' : 'Verify code'}</button>
        </div>}
        {details.map(([label, value]) => <div className="profile-dialog-readonly" key={label}><span>{label}</span><b>{value}</b></div>)}
        {error && <p className="profile-dialog-error" role="alert">{error}</p>}
        {notice && <p className="profile-dialog-notice" role="status">{notice}</p>}
        <div className="profile-dialog-actions">
          {editing
            ? <><button type="button" className="button button-quiet" onClick={resetEditor} disabled={busy}>Cancel</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></>
            : <button className="button button-primary" type="button" onClick={() => { setEditing(true); setNotice(null) }}>Edit profile</button>}
        </div>
      </form>
    </div>
  </Modal>
}
