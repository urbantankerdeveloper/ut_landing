import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useAppNavigation } from '../routing/useAppNavigation'
import { authApi } from '../api/auth'
import { trackEvent } from '../services/analytics'
import { base64FromBytes, prepareSelfieJpeg } from '../utils/selfiePhoto'
import { CameraUnavailableError, captureFrameAsFile, openFrontCamera } from '../utils/selfieCamera'
import { authContent as c } from '../content/auth'
import { notifyError, notifyInfo, notifySuccess } from '../utils/notify'

type AuthMode = 'login' | 'signup' | 'reset' | 'set-password'
type SignupRole = 'customer' | 'vendor'
const googleSignInEnabled = import.meta.env.VITE_ENABLE_GOOGLE_SIGN_IN === 'true'

type PasswordResetFormProps = {
  onSubmit: React.FormEventHandler<HTMLFormElement>
  onBack: () => void
  password: string
  setPassword: (value: string) => void
  confirmPassword: string
  setConfirmPassword: (value: string) => void
  showPassword: boolean
  setShowPassword: (value: (current: boolean) => boolean) => void
}

function PasswordResetForm({ onSubmit, onBack, password, setPassword, confirmPassword, setConfirmPassword, showPassword, setShowPassword }: PasswordResetFormProps) {
  return <section className="auth-screen">
    <div className="auth-story">
      <div className="auth-story-content">
        <p className="eyebrow">{c.shared.eyebrow}</p>
        <h1>{c.recovery.story.titleLead}<em>{c.recovery.story.titleEmphasis}</em></h1>
        <p>{c.recovery.story.copy}</p>
        <div className="auth-proof"><ShieldCheck size={18} /><span>{c.recovery.story.proof}</span></div>
      </div>
      <div className="auth-orbit" aria-hidden="true" />
    </div>
    <div className="auth-panel">
      <div className="auth-panel-inner">
        <p className="eyebrow">{c.recovery.panel.eyebrow}</p>
        <h2>{c.recovery.panel.title}</h2>
        <p className="auth-intro">{c.recovery.panel.intro}</p>
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          <label htmlFor="new-password">{c.recovery.fields.newPassword.label}</label>
          <span className="password-field">
            <input id="new-password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder={c.recovery.fields.newPassword.placeholder} required />
            <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? c.shared.hidePassword : c.shared.showPassword}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </span>
          <label htmlFor="confirm-password">{c.recovery.fields.confirmPassword.label}</label>
          <input id="confirm-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" placeholder={c.recovery.fields.confirmPassword.placeholder} required />
          {/* feedback is shown as toasts */}
          <button className="button button-primary button-large" type="submit">{c.recovery.submit} <ArrowRight size={15} /></button>
        </form>
        <div className="auth-links"><button type="button" onClick={onBack}>{c.shared.backToLogin}</button></div>
      </div>
    </div>
  </section>
}

export default function LoginScreen() {
  const { navigate } = useAppNavigation()
  const { openWorkspace } = useAppNavigation()
  const signIn = useAuthStore((state) => state.signIn)
  const [recoveryLink] = useState(() => {
    const recovery = new URLSearchParams(window.location.hash.slice(1))
    return recovery.get('type') === 'recovery'
      ? { accessToken: recovery.get('access_token') ?? '' }
      : null
  })
  const [mode, setMode] = useState<AuthMode>(recoveryLink?.accessToken ? 'set-password' : 'login')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<SignupRole>('customer')
  const [selfieBytes, setSelfieBytes] = useState<Uint8Array<ArrayBuffer> | null>(null)
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const selfieVideoRef = useRef<HTMLVideoElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [recoveryAccessToken, setRecoveryAccessToken] = useState(recoveryLink?.accessToken ?? '')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (recoveryLink && !recoveryLink.accessToken) notifyError(c.messages.invalidResetLink)
  }, [recoveryLink])

  useEffect(() => {
    if (!cameraStream || !selfieVideoRef.current) return
    selfieVideoRef.current.srcObject = cameraStream
    void selfieVideoRef.current.play().catch(() => undefined)
  }, [cameraStream])

  useEffect(() => () => cameraStream?.getTracks().forEach((track) => track.stop()), [cameraStream])

  useEffect(() => {
    document.body.classList.toggle('google-sign-in-disabled', !googleSignInEnabled)
    if (recoveryLink?.accessToken) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    return () => document.body.classList.remove('google-sign-in-disabled')
  }, [recoveryLink])

  async function choosePhoto(file: File | undefined) {
    if (!file) return
    try {
      const bytes = await prepareSelfieJpeg(file)
      const previewUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
      setSelfiePreview((previous) => {
        if (previous) URL.revokeObjectURL(previous)
        return previewUrl
      })
      setSelfieBytes(bytes)
    } catch (photoError) {
      setSelfieBytes(null)
      notifyError(photoError instanceof Error ? photoError.message : c.selfie.unusable)
    }
  }

  async function takeSelfie() {
    try {
      setCameraStream(await openFrontCamera())
    } catch (cameraError) {
      const reason = cameraError instanceof CameraUnavailableError ? cameraError.reason : 'failed'
      notifyInfo(c.selfie.cameraNotice[reason])
      photoInputRef.current?.click()
    }
  }

  async function captureSelfie() {
    const video = selfieVideoRef.current
    if (!video) return
    if (video.videoWidth === 0) {
      notifyError(c.selfie.cameraStarting)
      return
    }
    try {
      const file = await captureFrameAsFile(video)
      setCameraStream(null)
      await choosePhoto(file)
    } catch (captureError) {
      notifyError(captureError instanceof Error ? captureError.message : c.selfie.unusable)
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedUsername = username.trim().toLowerCase()
    try {
      if (mode === 'signup') {
        if (!name.trim() || !normalizedUsername || password.length < 8 || !/^\d{10}$/.test(phone)) {
          notifyError(c.messages.incompleteSignUp)
          return
        }
        const response = await authApi.signup({ email: normalizedUsername, password, name: name.trim(), phone, role, selfieJpegBase64: role === 'customer' && selfieBytes ? base64FromBytes(selfieBytes) : undefined })
        if (!response.accessToken && !response.token) {
          notifySuccess(response.emailSent
            ? c.messages.accountCreatedConfirmEmail
            : c.messages.accountCreatedFollowEmail)
          setMode('login')
          setPassword('')
          return
        }
        if (!response.user?.role) throw new Error(c.messages.accountCreatedNoRole)
        signIn({ username: response.user.username ?? response.user.email ?? normalizedUsername, role: response.user.role, name: response.user.name ?? name.trim() }, response.accessToken ?? response.token)
        openWorkspace(response.user.role)
        return
      }
      if (mode === 'reset') {
        if (!normalizedUsername) { notifyError(c.messages.enterEmailFirst); return }
        await authApi.passwordReset(normalizedUsername)
        notifySuccess(c.messages.resetRequested)
        return
      }
      if (mode === 'set-password') {
        if (password.length < 8) { notifyError(c.messages.passwordTooShort); return }
        if (password !== confirmPassword) { notifyError(c.messages.passwordMismatch); return }
        await authApi.passwordUpdate(recoveryAccessToken, password)
        setPassword('')
        setConfirmPassword('')
        setRecoveryAccessToken('')
        setMode('login')
        notifySuccess(c.messages.passwordUpdated)
        return
      }
      if (!normalizedUsername || !password) { notifyError(c.messages.enterCredentials); return }
      const response = await authApi.login(normalizedUsername, password)
      if (!response.user.role) throw new Error(c.messages.noWorkspaceRole)
      signIn({ username: response.user.username ?? response.user.email ?? normalizedUsername, role: response.user.role, name: response.user.name ?? normalizedUsername }, response.accessToken ?? response.token)
      trackEvent('auth.login', { role: response.user.role, sessionId: sessionStorage.getItem('urban-tanker-analytics-session') ?? '' })
      openWorkspace(response.user.role)
    } catch (submissionError) {
      notifyError(submissionError instanceof Error ? submissionError.message : c.messages.genericFailure)
    }
  }

  const isSignup = mode === 'signup'
  const isReset = mode === 'reset'
  const story = isSignup ? c.story.signUp : c.story.signIn
  if (mode === 'set-password') {
    return <PasswordResetForm
      onSubmit={submit}
      onBack={() => {
        setRecoveryAccessToken('')
        setPassword('')
        setConfirmPassword('')
        changeMode('login')
      }}
      password={password}
      setPassword={setPassword}
      confirmPassword={confirmPassword}
      setConfirmPassword={setConfirmPassword}
      showPassword={showPassword}
      setShowPassword={setShowPassword}
    />
  }
  return <section className="auth-screen"><div className="auth-story"><button className="auth-story-brand" onClick={() => navigate('home')} aria-label={c.shared.homeAriaLabel}><img className="brand-mark" src="/urban-tanker-mark.png" width={512} height={512} decoding="async" alt="" aria-hidden="true" /><span>{c.shared.brandPrefix}<b>{c.shared.brandName}</b></span></button><div className="auth-story-content"><p className="eyebrow">{c.shared.eyebrow}</p><h1>{story.titleLead}<em>{story.titleEmphasis}</em></h1><p>{story.copy}</p><div className="auth-proof"><ShieldCheck size={18} /><span>{c.shared.proof}</span></div></div><div className="auth-orbit" aria-hidden="true" /></div><div className="auth-panel"><button className="back-link" onClick={() => navigate('home')}><ArrowLeft size={14} /> {c.shared.backToHome}</button><div className="auth-panel-inner">{isSignup ? <p className="eyebrow">{c.panel.eyebrow.signUp}</p> : <p className="eyebrow">{c.panel.eyebrow.signIn}</p>}<h2>{isSignup ? c.panel.title.signUp : isReset ? c.panel.title.reset : c.panel.title.signIn}</h2><p className="auth-intro">{isSignup ? c.panel.intro.signUp : isReset ? c.panel.intro.reset : c.panel.intro.signIn}</p>{!isSignup && !isReset && googleSignInEnabled && <><button className="google-button" onClick={() => notifyInfo(c.google.note)}>{c.google.button} <span aria-hidden="true">{c.google.mark}</span></button><p className="provider-note">{c.google.note}</p><div className="or-divider"><span>{c.google.divider}</span></div></>}<form className="auth-form" onSubmit={submit} noValidate>{isSignup && <><label htmlFor="signup-name">{c.fields.fullName.label}</label><input id="signup-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder={c.fields.fullName.placeholder} required /><label htmlFor="signup-phone">{c.fields.phone.label}</label><input id="signup-phone" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} type="tel" inputMode="numeric" autoComplete="tel" placeholder={c.fields.phone.placeholder} required /><label htmlFor="signup-role">{c.fields.accountType.label}</label><select id="signup-role" value={role} onChange={(event) => setRole(event.target.value as SignupRole)}><option value="customer">{c.fields.accountType.options.customer}</option><option value="vendor">{c.fields.accountType.options.vendor}</option></select></>}<label htmlFor="login-username">{isSignup || isReset ? c.fields.email.label : c.fields.usernameOrEmail.label}</label><input id="login-username" value={username} onChange={(event) => setUsername(event.target.value)} type={isSignup || isReset ? 'email' : 'text'} autoComplete="username" autoCapitalize="none" spellCheck="false" placeholder={isSignup || isReset ? c.fields.email.placeholder : c.fields.usernameOrEmail.placeholder} required />{!isReset && <><label htmlFor="login-password">{c.fields.password.label}</label><span className="password-field"><input id="login-password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder={isSignup ? c.fields.password.placeholderSignUp : c.fields.password.placeholderSignIn} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? c.shared.hidePassword : c.shared.showPassword}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></>} {isSignup && role === 'customer' && <div className="selfie-upload"><p className="selfie-upload-title">{c.selfie.title}</p><p className="selfie-upload-note">{c.selfie.note}</p>{selfiePreview && <img className="selfie-upload-preview" src={selfiePreview} alt={c.selfie.previewAlt} decoding="async" width={120} height={120} />}{cameraStream ? <div className="selfie-camera"><video ref={selfieVideoRef} className="selfie-camera-video" playsInline muted /><div className="selfie-upload-actions"><button type="button" className="button button-primary" onClick={() => void captureSelfie()}>{c.selfie.capture}</button><button type="button" className="button button-quiet" onClick={() => setCameraStream(null)}>{c.selfie.cancelCamera}</button></div></div> : <div className="selfie-upload-actions"><button type="button" className="button button-quiet" onClick={() => void takeSelfie()}>{c.selfie.takeSelfie}</button><button type="button" className="button button-quiet" onClick={() => photoInputRef.current?.click()}>{c.selfie.choosePhoto}</button></div>}<input ref={photoInputRef} type="file" accept="image/*" hidden onChange={(event) => { void choosePhoto(event.target.files?.[0]); event.target.value = '' }} /></div>}<button className="button button-primary button-large" type="submit">{isSignup ? c.actions.createAccount : isReset ? c.actions.sendReset : c.actions.logIn} {isSignup ? <ArrowRight size={15} /> : <LogIn size={15} />}</button></form><div className="auth-links">{!isSignup && !isReset && <button type="button" onClick={() => changeMode('reset')}>{c.actions.forgotPassword}</button>}{isReset && <button type="button" onClick={() => changeMode('login')}>{c.shared.backToLogin}</button>}{!isReset && <><span className="auth-switch"><span>{c.actions.separator}</span> <span>{isSignup ? c.actions.alreadyHaveAccount : c.actions.newHere}</span> <button type="button" onClick={() => changeMode(isSignup ? 'login' : 'signup')}>{isSignup ? c.actions.logIn : c.actions.createAnAccount}</button></span></>}</div></div></div></section>
}
