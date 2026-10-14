import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useNavigationStore, type WorkspaceRole } from '../stores/navigationStore'
import { demoDataEnabled } from '../constants/demo'
import { authApi } from '../api/auth'
import { trackEvent } from '../services/analytics'

type AuthMode = 'login' | 'signup' | 'reset'
type SignupRole = 'customer' | 'vendor' | 'admin'
type DemoAccount = { role: WorkspaceRole; name: string; usernames: string[]; password: string }
const demoAccounts: DemoAccount[] = demoDataEnabled ? [
  { role: 'customer', name: 'Demo Customer', usernames: ['customer', 'customer@urbantanker.com'], password: 'customer123' },
  { role: 'vendor', name: 'Demo Vendor', usernames: ['vendor', 'vendor@bluedrop.demo'], password: 'vendor123' },
  { role: 'admin', name: 'Demo Admin', usernames: ['admin', 'admin@urbantanker.com'], password: 'Maneesh@123' },
] : []
const googleSignInEnabled = import.meta.env.VITE_ENABLE_GOOGLE_SIGN_IN === 'true'

export default function LoginScreen() {
  const navigate = useNavigationStore((state) => state.navigate)
  const openWorkspace = useNavigationStore((state) => state.openWorkspace)
  const signIn = useAuthStore((state) => state.signIn)
  const [mode, setMode] = useState<AuthMode>('login')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<SignupRole>('customer')
  const [adminKey, setAdminKey] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    document.body.classList.toggle('google-sign-in-disabled', !googleSignInEnabled)
    return () => document.body.classList.remove('google-sign-in-disabled')
  }, [])

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
        const response = await authApi.signup({ email: normalizedUsername, password, name: name.trim(), phone, role, adminKey: role === 'admin' ? adminKey : undefined })
        if (!response.accessToken && !response.token) {
          setMessage('Account created. Check your email if verification is required, then sign in.')
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
        setMessage('If that account exists, reset instructions will be sent shortly.')
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
  return <section className="auth-screen"><div className="auth-story"><button className="auth-story-brand" onClick={() => navigate('home')} aria-label="Back to Urban Tanker home"><span className="brand-mark">UT</span><span>Urban <b>Tanker</b></span></button><div className="auth-story-content"><p className="eyebrow">ONE ACCOUNT. YOUR WORKSPACE.</p><h1>{isSignup ? <>Start with <em>Urban Tanker.</em></> : <>Welcome <em>back.</em></>}</h1><p>{isSignup ? 'Register to book and manage tanker services.' : 'Log in once and we will take you to the right place for your work with Urban Tanker.'}</p><div className="auth-proof"><ShieldCheck size={18} /><span>Customer, vendor and admin experiences share one trusted delivery flow.</span></div></div><div className="auth-orbit" aria-hidden="true" /></div><div className="auth-panel"><button className="back-link" onClick={() => navigate('home')}><ArrowLeft size={14} /> Back to Urban Tanker</button><div className="auth-panel-inner">{isSignup ? <p className="eyebrow">CREATE YOUR ACCOUNT</p> : <p className="eyebrow">SECURE SIGN IN</p>}<h2>{isSignup ? 'Create your account.' : isReset ? 'Reset your password.' : 'Open your workspace.'}</h2><p className="auth-intro">{isSignup ? 'Register to book, track, and manage your services.' : isReset ? 'We will send reset instructions if the account exists.' : 'Use your account credentials. Your role will route you automatically.'}</p>{!isSignup && !isReset && googleSignInEnabled && <><button className="google-button" onClick={() => setMessage('Google sign-in is not connected.')}>Continue with Google <span aria-hidden="true">G</span></button><p className="provider-note">Google sign-in is not connected.</p><div className="or-divider"><span>or use your username</span></div></>}<form className="auth-form" onSubmit={submit} noValidate>{isSignup && <><label htmlFor="signup-name">Full name</label><input id="signup-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Enter your full name" required /><label htmlFor="signup-phone">Phone number</label><input id="signup-phone" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 10))} type="tel" inputMode="numeric" autoComplete="tel" placeholder="10-digit mobile number" required /><label htmlFor="signup-role">Account type</label><select id="signup-role" value={role} onChange={(event) => setRole(event.target.value as SignupRole)}><option value="customer">Customer</option><option value="vendor">Vendor partner</option><option value="admin">Administrator</option></select>{role === 'admin' && <><label htmlFor="admin-registration-key">Admin registration key</label><input id="admin-registration-key" value={adminKey} onChange={(event) => setAdminKey(event.target.value)} type="password" autoComplete="off" placeholder="Enter administrator key" required /></>}</>}<label htmlFor="login-username">{isSignup || isReset ? 'Email' : 'Username or email'}</label><input id="login-username" value={username} onChange={(event) => setUsername(event.target.value)} type={isSignup || isReset ? 'email' : 'text'} autoComplete="username" autoCapitalize="none" spellCheck="false" placeholder={isSignup || isReset ? 'you@example.com' : 'Enter your username or email'} required />{!isReset && <><label htmlFor="login-password">Password</label><span className="password-field"><input id="login-password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete={isSignup ? 'new-password' : 'current-password'} placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span></>} {error && <p className="login-error" role="alert">{error}</p>}{message && <p className="login-message" role="status">{message}</p>}<button className="button button-primary button-large" type="submit">{isSignup ? 'Create account' : isReset ? 'Send reset instructions' : 'Log in'} {isSignup ? <ArrowRight size={15} /> : <LogIn size={15} />}</button></form><div className="auth-links">{!isSignup && !isReset && <button type="button" onClick={() => changeMode('reset')}>Forgot password?</button>}{isReset && <button type="button" onClick={() => changeMode('login')}>Back to login</button>}{!isReset && <><span>·</span><span>{isSignup ? 'Already have an account?' : 'New here?'}</span><button type="button" onClick={() => changeMode(isSignup ? 'login' : 'signup')}>{isSignup ? 'Log in' : 'Create an account'}</button></>}</div></div></div></section>
}
