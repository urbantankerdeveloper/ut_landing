import { useNavigationStore } from '../../stores/navigationStore'
import { useAuthStore } from '../../stores/authStore'

const navigationItems = [
  ['Home', 'home'],
  ['Services', 'services'],
  ['Subscription', 'subscriptions'],
  ['Track', 'tracking'],
  ['Become a Partner', 'partner'],
] as const

export function BookingPageHeader() {
  const navigate = useNavigationStore((state) => state.navigate)
  const openWorkspace = useNavigationStore((state) => state.openWorkspace)
  const user = useAuthStore((state) => state.user)

  return <header className="booking-page-header">
    <button className="booking-page-brand" type="button" aria-label="Urban Tanker home" onClick={() => navigate('home')}>
      <img className="brand-wordmark booking-wordmark" src="/urban-tanker-wordmark.png" alt="Urban Tanker" />
    </button>
    <nav className="booking-page-nav" aria-label="Main navigation">
      {navigationItems.map(([label, screen]) => <button key={screen} type="button" onClick={() => navigate(screen)}>{label}</button>)}
    </nav>
    <button className="button button-quiet booking-account-button" type="button" onClick={() => user ? openWorkspace(user.role) : navigate('login')}>{user ? 'My account' : 'Log in'}</button>
  </header>
}

export function BookingPageFooter() {
  const navigate = useNavigationStore((state) => state.navigate)

  return <footer className="booking-page-footer">
    <button className="booking-page-brand" type="button" aria-label="Urban Tanker home" onClick={() => navigate('home')}>
      <img className="brand-wordmark booking-wordmark" src="/urban-tanker-wordmark.png" alt="Urban Tanker" />
    </button>
    <p>© 2026 Urban Tanker. All rights reserved.</p>
    <nav aria-label="Footer navigation">
      <button type="button" onClick={() => navigate('services')}>Services</button>
      <button type="button" onClick={() => navigate('subscriptions')}>Subscriptions</button>
      <button type="button" onClick={() => navigate('partner')}>Partner</button>
    </nav>
  </footer>
}
