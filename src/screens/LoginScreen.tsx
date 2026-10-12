import { useState } from 'react'
import { ArrowLeft, ArrowRight, Eye, EyeOff, LogIn, ShieldCheck } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useNavigationStore, type WorkspaceRole } from '../stores/navigationStore'
import { demoDataEnabled } from '../constants/demo'
import { authApi } from '../api/auth'

type DemoAccount = { role: WorkspaceRole; name: string; usernames: string[]; password: string }
const demoAccounts: DemoAccount[] = demoDataEnabled ? [
  { role: 'customer', name: 'Demo Customer', usernames: ['customer', 'customer@urbantanker.com'], password: 'customer123' },
  { role: 'vendor', name: 'Demo Vendor', usernames: ['vendor', 'vendor@bluedrop.demo'], password: 'vendor123' },
  { role: 'admin', name: 'Demo Admin', usernames: ['admin', 'admin@urbantanker.com'], password: 'Maneesh@123' },
] : []

export default function LoginScreen() {
  const navigate = useNavigationStore((state) => state.navigate)
  const openWorkspace = useNavigationStore((state) => state.openWorkspace)
  const signIn = useAuthStore((state) => state.signIn)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    const normalizedUsername = username.trim().toLowerCase()
    if (!normalizedUsername || !password) { setError('Enter your username and password.'); return }
    try {
      if (demoDataEnabled) {
        const account = demoAccounts.find((item) => item.usernames.includes(normalizedUsername) && item.password === password)
        if (!account) { setError('Username or password not recognised. Try a demo account below.'); return }
        signIn({ username: normalizedUsername, role: account.role, name: account.name })
        openWorkspace(account.role)
      } else {
        const response = await authApi.login(normalizedUsername, password)
        const role = response.user.role
        if (!role) throw new Error('Your account has no valid workspace role.')
        signIn({ username: response.user.username ?? response.user.email ?? normalizedUsername, role, name: response.user.name ?? normalizedUsername }, response.accessToken ?? response.token, response.refreshToken)
        openWorkspace(role)
      }
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Unable to sign in. Please try again.')
    }
  }

  function requestReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!username.trim()) { setError('Enter your username or email first.'); return }
    setError(null)
    setMessage('If that account exists, reset instructions will be sent shortly.')
  }

  return <section className="auth-screen"><div className="auth-story"><button className="auth-story-brand" onClick={() => navigate('home')} aria-label="Back to Urban Tanker home"><span className="brand-mark">UT</span><span>Urban <b>Tanker</b></span></button><div className="auth-story-content"><p className="eyebrow">ONE ACCOUNT. YOUR WORKSPACE.</p><h1>Welcome <em>back.</em></h1><p>Log in once and we will take you to the right place for your work with Urban Tanker.</p><div className="auth-proof"><ShieldCheck size={18} /><span>Customer, vendor and admin experiences share one trusted delivery flow.</span></div></div><div className="auth-orbit" aria-hidden="true" /></div><div className="auth-panel"><button className="back-link" onClick={() => navigate('home')}><ArrowLeft size={14} /> Back to Urban Tanker</button><div className="auth-panel-inner">{mode === 'login' ? <><p className="eyebrow">SECURE SIGN IN</p><h2 id="login-title">Open your workspace.</h2><p className="auth-intro">Use your account credentials. Your role will route you automatically.</p><button className="google-button" onClick={() => setMessage('Google sign-in is not connected in this demo.')}>Continue with Google <span aria-hidden="true">G</span></button><p className="provider-note">Google sign-in is not connected in this demo.</p><div className="or-divider"><span>or use your username</span></div><form className="auth-form" onSubmit={submit} noValidate><label htmlFor="login-username">Username or email</label><input id="login-username" name="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" spellCheck="false" placeholder="Enter your username or email" required /><label htmlFor="login-password">Password</label><span className="password-field"><input id="login-password" name="password" value={password} onChange={(event) => setPassword(event.target.value)} type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Enter your password" required /><button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></span>{error && <p className="login-error" role="alert">{error}</p>}{message && <p className="login-message" role="status">{message}</p>}<button className="button button-primary button-large" type="submit">Log in <LogIn size={16} /></button></form><div className="auth-links"><button onClick={() => { setMode('reset'); setError(null); setMessage(null) }}>Forgot password?</button><span>·</span><span>New here? <button onClick={() => navigate('booking')}>Book as a guest</button></span></div><details className="demo-details"><summary>Try a demo account</summary><dl>{demoAccounts.map((account) => <div key={account.role}><dt>{account.role}</dt><dd><code>{account.usernames[0]}</code> / <code>{account.password}</code></dd></div>)}</dl><p>Demo credentials only. Use these sample accounts to explore the prototype.</p></details></> : <><p className="eyebrow">ACCOUNT RECOVERY</p><h2>Reset your password.</h2><p className="auth-intro">Enter your username or email and we will help you get back in.</p><form className="auth-form" onSubmit={requestReset} noValidate><label htmlFor="reset-username">Username or email</label><input id="reset-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" placeholder="Enter your username or email" required />{error && <p className="login-error" role="alert">{error}</p>}{message && <p className="login-message" role="status">{message}</p>}<button className="button button-primary button-large" type="submit">Send reset instructions <ArrowRight size={16} /></button></form><button className="auth-return" onClick={() => { setMode('login'); setError(null); setMessage(null) }}><ArrowLeft size={14} /> Return to sign in</button></>}</div><p className="terms-note">By continuing, you agree to our Terms and Privacy Policy.</p></div></section>
}
