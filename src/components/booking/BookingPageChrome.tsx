import { useAppNavigation } from '../../routing/useAppNavigation'
import { useAuthStore } from '../../stores/authStore'
import { bookingContent as c } from '../../content/booking'

export function BookingPageHeader() {
  const { navigate } = useAppNavigation()
  const { openWorkspace } = useAppNavigation()
  const user = useAuthStore((state) => state.user)

  return <header className="booking-page-header">
    <button className="booking-page-brand" type="button" aria-label={c.chrome.brandHome} onClick={() => navigate('home')}>
      <img className="brand-wordmark booking-wordmark" src="/urban-tanker-wordmark.webp" width={380} height={59} decoding="async" alt={c.chrome.brandAlt} />
    </button>
    <nav className="booking-page-nav" aria-label={c.chrome.mainNav}>
      {c.chrome.navigation.map((item) => <button key={item.id} type="button" onClick={() => navigate(item.id)}>{item.label}</button>)}
    </nav>
    <button className="button button-quiet booking-account-button" type="button" onClick={() => user ? openWorkspace(user.role) : navigate('login')}>{user ? c.chrome.myAccount : c.chrome.logIn}</button>
  </header>
}

export function BookingPageFooter() {
  const { navigate } = useAppNavigation()

  return <footer className="booking-page-footer">
    <button className="booking-page-brand" type="button" aria-label={c.chrome.brandHome} onClick={() => navigate('home')}>
      <img className="brand-wordmark booking-wordmark" src="/urban-tanker-wordmark.webp" width={380} height={59} loading="lazy" decoding="async" alt={c.chrome.brandAlt} />
    </button>
    <p>{c.chrome.copyright}</p>
    <nav aria-label={c.chrome.footerNav}>
      <button type="button" onClick={() => navigate('services')}>{c.chrome.footerLinks.services}</button>
      <button type="button" onClick={() => navigate('subscriptions')}>{c.chrome.footerLinks.subscriptions}</button>
      <button type="button" onClick={() => navigate('partner')}>{c.chrome.footerLinks.partner}</button>
    </nav>
  </footer>
}
