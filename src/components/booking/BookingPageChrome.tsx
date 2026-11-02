import { useNavigationStore } from '../../stores/navigationStore'
import { useAuthStore } from '../../stores/authStore'
import { bookingContent as c } from '../../content/booking'

export function BookingPageHeader() {
  const navigate = useNavigationStore((state) => state.navigate)
  const openWorkspace = useNavigationStore((state) => state.openWorkspace)
  const user = useAuthStore((state) => state.user)

  return <header className="booking-page-header">
    <button className="booking-page-brand" type="button" aria-label={c.chrome.brandHome} onClick={() => navigate('home')}>
      <img className="brand-wordmark booking-wordmark" src="/urban-tanker-wordmark.png" alt={c.chrome.brandAlt} />
    </button>
    <nav className="booking-page-nav" aria-label={c.chrome.mainNav}>
      {c.chrome.navigation.map((item) => <button key={item.id} type="button" onClick={() => navigate(item.id)}>{item.label}</button>)}
    </nav>
    <button className="button button-quiet booking-account-button" type="button" onClick={() => user ? openWorkspace(user.role) : navigate('login')}>{user ? c.chrome.myAccount : c.chrome.logIn}</button>
  </header>
}

export function BookingPageFooter() {
  const navigate = useNavigationStore((state) => state.navigate)

  return <footer className="booking-page-footer">
    <button className="booking-page-brand" type="button" aria-label={c.chrome.brandHome} onClick={() => navigate('home')}>
      <img className="brand-wordmark booking-wordmark" src="/urban-tanker-wordmark.png" alt={c.chrome.brandAlt} />
    </button>
    <p>{c.chrome.copyright}</p>
    <nav aria-label={c.chrome.footerNav}>
      <button type="button" onClick={() => navigate('services')}>{c.chrome.footerLinks.services}</button>
      <button type="button" onClick={() => navigate('subscriptions')}>{c.chrome.footerLinks.subscriptions}</button>
      <button type="button" onClick={() => navigate('partner')}>{c.chrome.footerLinks.partner}</button>
    </nav>
  </footer>
}
