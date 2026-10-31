import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useNavigationStore, type WorkspaceRole } from '../stores/navigationStore'
import { demoDataEnabled } from '../constants/demo'
import { authApi } from '../api/auth'
import { trackEvent } from '../services/analytics'
import { base64FromBytes, prepareSelfieJpeg } from '../utils/selfiePhoto'

type AuthMode = 'login' | 'signup' | 'reset' | 'set-password'
type SignupRole = 'customer' | 'vendor' | 'admin'
type DemoAccount = { role: WorkspaceRole; name: string; usernames: string[]; password: string }
const demoAccounts: DemoAccount[] = demoDataEnabled ? [
  { role: 'vendor', name: 'Demo Vendor', usernames: ['vendor', 'vendor@bluedrop.demo'], password: 'vendor123' },
  { role: 'admin', name: 'Demo Admin', usernames: ['admin', 'admin@urbantanker.com'], password: 'Maneesh@123' },
] : []
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
  error: string | null
  message: string | null
}

function PasswordResetForm({ onSubmit, onBack, password, setPassword, confirmPassword, setConfirmPassword, showPassword, setShowPassword, error, message }: PasswordResetFormProps) {
  return <section className="auth-screen">
    <div className="auth-story">
      <div className="auth-story-content">
        <p className="eyebrow">ONE ACCOUNT. YOUR WORKSPACE.</p>
        <h1>Choose a <em>new password.</em></h1>
        <p>Set a new password to secure your Urban Tanker account.</p>
        <div className="auth-proof"><ShieldCheck size={18} /><span>Choose a password with at least 8 characters.</span></div>
      </div>
      <div className="auth-orbit" aria-hidden="true" />
    </div>
    <div className="auth-panel">
      <div className="auth-panel-inner">
        <p className="eyebrow">PASSWORD RECOVERY</p>
        <h2>Set a new password.</h2>
        <p className="auth-intro">Enter and confirm your new password below.</p>
        <form className="auth-form" onSubmit={onSubmit} noValidate>
          <label htmlFor="new-password">New password</label>
          <span className="password-field">
            <input id="new-password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="At least 8 characters" required />
            <button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
          </span>
          <label htmlFor="confirm-password">Confirm new password</label>
          <input id="confirm-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" autoComplete="new-password" placeholder="Re-enter your new password" required />
          {error && <p id="login-error" className="login-error" role="alert">{error}</p>}
          {message && <p className="login-message" role="status">{message}</p>}
          <button className="button button-primary button-large" type="submit">Update password <ArrowRight size={15} /></button>
        </form>
        <div className="auth-links"><button type="button" onClick={onBack}>Back to login</button></div>
      </div>
    </div>
  </section>
}

export default function LoginScreen() {
  const navigate = useNavigationStore((state) => state.navigate)
  const openWorkspace = useNavigationStore((state) => state.openWorkspace)
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
  const [adminKey, setAdminKey] = useState('')
  const [selfieBytes, setSelfieBytes] = useState<Uint8Array<ArrayBuffer> | null>(null)
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null)
  const [selfieError, setSelfieError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [recoveryAccessToken, setRecoveryAccessToken] = useState(recoveryLink?.accessToken ?? '')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(() => (
    recoveryLink && !recoveryLink.accessToken
      ? 'This password reset link is invalid or expired. Request a new one.'
      : null
  ))

  useEffect(() => {
    document.body.classList.toggle('google-sign-in-disabled', !googleSignInEnabled)
    if (recoveryLink?.accessToken) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    return () => document.body.classList.remove('google-sign-in-disabled')
  }, [recoveryLink])

  async function choosePhoto(file: File | undefined) {
    if (!file) return
    setSelfieError(null)
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
      setSelfieError(photoError instanceof Error ? photoError.message : 'This photo could not be used. Try another photo.')
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode)
    setError(null)
    setMessage(null)
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setMessage(null)
    const normalizedUsername = username.trim().toLowerCase()
    try {
      if (mode === 'signup') {
        if (!name.trim() || !normalizedUsername || password.length < 8 || !/^\d{10}$/.test(phone) || (role === 'admin' && !adminKey.trim())) {
          setError('Complete all required account fields before continuing.')
          return
        }
        const response = await authApi.signup({ email: normalizedUsername, password, name: name.trim(), phone, role, adminKey: role === 'admin' ? adminKey : undefined, selfieJpegBase64: role === 'customer' && selfieBytes ? base64FromBytes(selfieBytes) : undefined })
        if (!response.accessToken && !response.token) {
          setMessage(response.emailSent
            ? 'Account created. Check your email and confirm your address before signing in.'
            : 'Account created. Follow the email instructions to finish registration.')
          setMode('login')
          setPassword('')
          return
        }
        if (!response.user?.role) throw new Error('Your account was created but has no valid workspace role.')
        signIn({ username: response.user.username ?? response.user.email ?? normalizedUsername, role: response.user.role, name: response.user.name ?? name.trim() }, response.accessToken ?? response.token, response.refreshToken)
        openWorkspace(response.user.role)
        return
      }
      if (mode === 'reset') {
        if (!normalizedUsername) { setError('Enter your email address first.'); return }
        await authApi.passwordReset(normalizedUsername)
        setMessage('If that account exists, reset instructions will be sent shortly.')
        return
      }
      if (mode === 'set-password') {
        if (password.length < 8) { setError('Use a password with at least 8 characters.'); return }
        if (password !== confirmPassword) { setError('The passwords do not match.'); return }
        await authApi.passwordUpdate(recoveryAccessToken, password)
        setPassword('')
        setConfirmPassword('')
        setRecoveryAccessToken('')
        setMode('login')
        setMessage('Your password has been updated. You can now sign in.')
        return
      }
      if (!normalizedUsername || !password) { setError('Enter your username and password.'); return }
      if (demoDataEnabled) {
        const account = demoAccounts.find((item) => item.usernames.includes(normalizedUsername) && item.password === password)
        if (!account) { setError('Username or password not recognised.'); return }
        signIn({ username: normalizedUsername, role: account.role, name: account.name })
        openWorkspace(account.role)
        return
      }
      const response = await authApi.login(normalizedUsername, password)
      if (!response.user.role) throw new Error('Your account has no valid workspace role.')
      signIn({ username: response.user.username ?? response.user.email ?? normalizedUsername, role: response.user.role, name: response.user.name ?? normalizedUsername }, response.accessToken ?? response.token, response.refreshToken)
      trackEvent('auth.login', { role: response.user.role, sessionId: sessionStorage.getItem('urban-tanker-analytics-session') ?? '' })
      openWorkspace(response.user.role)
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to complete the request. Please try again.')
    }
  }

  const isSignup = mode === 'signup'
  const isReset = mode === 'reset'
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
      error={error}
      message={message}
    />
  }
  return <section className="auth-screen"><div className="auth-story"><button className="auth-story-brand" onClick={() => navigate('home')} aria-label="Back to Urban Tanker home"><img className="brand-mark" src="/urban-tanker-mark.png" alt="" aria-hidden="true" /><span>Urban <b>Tanker</b></span></button><div className="auth-story-content"><p className="eyebrow">ONE ACCOUNT. YOUR WORKSPACE.</p><h1>{isSignup ? <>Start with <em>Urban Tanker.</em></> : <>Welcome <em>back.</em></>}</h1><p>{isSignup ? 'Register to book and manage tanker services.' : 'Log in once and we will take you to the right place for your work with Urban Tanker.'}</p><div className="auth-proof"><ShieldCheck size={18} /><span>Customer, vendor and admin experiences share one trusted delivery flow.</span></div></div><div className="auth-orbit" aria-hidden="true" /></div><div className="auth-panel"><button className="back-link" onClick={() => navigate('home')}><ArrowLeft size={14} /> Back to Urban Tanker</button><div className="auth-panel-inner">{isSignup ? <p className="eyebrow">CREATE YOUR ACCOUNT</p> : <p className="eyebrow">SECURE SIGN IN</p>}<h2>{isSignup ? 'Create your account.' : isReset ? 'Reset your password.' : 'Open your workspace.'}</h2><p className="auth-intro">{isSignup ? 'Register to book, track, and manage your services.' : isReset ? 'We will send reset instructions if the account exists.' : 'Use your account credentials. Your role will route you automatically.'}</p>{!isSignup && !isReset && googleSignInEnabled && <><button className="google-button" onClick={() => setMessage('Google sign-in is not connected.')}>Continue with Google <span aria-hidden="true">G</span></button><p className="provider-note">Google sign-in is not connected.</p><div className="or-divider"><span>or use your username</span></div></>}<form className="auth-form" onSubmit={submit} noValidate>{isSignup && <><label htmlFor="signup-name">Full name</label><input id="signup-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Enter your full name" required /><label htmlFor="signup-phone">Phone number</label><input id="signup-phone" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} type="tel" inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile number" required /><label htmlFor="signup-role">Account type</label><select id="signup-role" value={role} onChange={(event) => setRole(event.target.value as SignupRole)}><option value="customer">Customer</option><option value="vendor">Vendor partner</option><option value="admin">Administrator</option></select>{role === 'admin' && <><label htmlFor="admin-registration-key">Admin registration key</label><input id="admin-registration-key" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} type="password" autoComplete="off" placeholder="Enter administrator key" required /></>}</>}<label htmlFor="login-username">{isSignup || isReset ? 'Email' : 'Username or email'}</label><input id="login-username" value={username} onChange={(event) => setUsername(event.target.value)} type={isSignup || isReset ? 'email' : 'text'} autoComplete="username" autoCapitalize="none" spellCheck="false" placeholder={isSignup || isReset ? 'you@example.com' : 'Enter your username or email'} required />{!isReset && <><label htmlFor="login-password">Password</label><span className="password-field"><input id="login-password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></>} {error &&   <p id="login-error" className="login-error" role="alert">{error}</p>}{message && <p className="login-message" role="status">{message}</p>}{isSignup && role === 'customer' && <div className="selfie-upload"><p className="selfie-upload-title">Your photo (optional)</p><p className="selfie-upload-note">It is used to verify your account. It is stored privately, and only admins can view it.</p>{selfiePreview && <img className="selfie-upload-preview" src={selfiePreview} alt="Your selected photo" />}<div className="selfie-upload-actions"><label className="button button-quiet">Take selfie<input type="file" accept="image/*" capture="user" hidden onChange={(event) => { void choosePhoto(event.target.files?.[0]); event.target.value = '' }} /></label><label className="button button-quiet">Choose photo<input type="file" accept="image/*" hidden onChange={(event) => { void choosePhoto(event.target.files?.[0]); event.target.value = '' }} /></label></div>{selfieError && <p className="login-error" role="alert">{selfieError}</p>}</div>}<button className="button button-primary button-large" type="submit">{isSignup ? 'Create account' : isReset ? 'Send reset instructions' : 'Log in'} {isSignup ? <ArrowRight size={15} /> : <LogIn size={15} />}</button></form><div className="auth-links">{!isSignup && !isReset && <button type="button" onClick={() => changeMode('reset')}>Forgot password?</button>}{isReset && <button type="button" onClick={() => changeMode('login')}>Back to login</button>}{!isReset && <><span>·</span><span>{isSignup ? 'Already have an account?' : 'New here?'}</span><button type="button" onClick={() => changeMode(isSignup ? 'login' : 'signup')}>{isSignup ? 'Log in' : 'Create an account'}</button></>}</div></div></div></section>
}
