import { ChevronDown, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigationStore, type ScreenId } from '../stores/navigationStore'
import { useAuthStore } from '../stores/authStore'
import { chromeContent as c } from '../content/chrome'

const navScreens: Record<(typeof c.header.navItems)[number]['id'], ScreenId> = { subscription: 'subscriptions', track: 'tracking', about: 'about' }

export function Header() {
	const { activeScreen, mobileMenuOpen, navigate, setMobileMenuOpen } = useNavigationStore()
	const user = useAuthStore((state) => state.user)
	const openWorkspace = useNavigationStore((state) => state.openWorkspace)
	const [servicesOpen, setServicesOpen] = useState(false)
	const select = (screen: ScreenId) => { navigate(screen); setServicesOpen(false) }
	return <header className="site-header"><button className="brand" onClick={() => select('home')} aria-label={c.header.homeLabel}><img className="brand-wordmark" src="/urban-tanker-wordmark.png" alt={c.header.logoAlt} /></button><nav id="main-navigation" className={`main-nav ${mobileMenuOpen ? 'is-open' : ''}`} aria-label={c.header.mainNavigationLabel}>{<div className="nav-dropdown"><button className="nav-dropdown-toggle" aria-expanded={servicesOpen} aria-controls="services-menu" onClick={() => setServicesOpen(!servicesOpen)}>{c.header.servicesToggle} <ChevronDown size={14} aria-hidden="true" /></button>{servicesOpen && <div id="services-menu" className="nav-dropdown-menu">{c.header.serviceItems.map((item) => <button key={item.id} onClick={() => select('booking')}><b>{item.label}</b><small>{c.header.serviceHint}</small></button>)}<button onClick={() => select('services')}><b>{c.header.exploreServices}</b><small>{c.header.exploreServicesHint}</small></button></div>}</div>}{c.header.navItems.map((item) => <button key={item.id} className={activeScreen === navScreens[item.id] ? 'is-active' : ''} aria-current={activeScreen === navScreens[item.id] ? 'page' : undefined} onClick={() => select(navScreens[item.id])}>{item.label}</button>)}<button onClick={() => select('partner')}>{c.header.becomePartner}</button></nav><div className="header-actions"><button className="button button-quiet account-button" onClick={() => user ? openWorkspace(user.role) : select('login')}>{user ? c.header.myAccount : c.header.logIn}</button>{!user && <button className="button button-primary" onClick={() => select('booking')}>{c.header.bookNow}</button>}<button className="icon-button menu-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-expanded={mobileMenuOpen} aria-controls="main-navigation" aria-label={mobileMenuOpen ? c.header.closeNavigation : c.header.openNavigation}>{mobileMenuOpen ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}</button></div></header>
}
