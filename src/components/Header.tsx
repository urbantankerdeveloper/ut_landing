import { ChevronDown, Menu, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigationStore, type ScreenId } from '../stores/navigationStore'
import { useAuthStore } from '../stores/authStore'

const navItems: { label: string; screen: ScreenId }[] = [{ label: 'Subscription', screen: 'subscriptions' }, { label: 'Track', screen: 'tracking' }, { label: 'About', screen: 'about' }]
const serviceItems = ['Water tanker', 'Sewage tanker', 'Tank and sump cleaning', 'Borewell services', 'RMC mixer trucks', 'Empty tanker transport']

export function Header() {
	const { activeScreen, mobileMenuOpen, navigate, setMobileMenuOpen } = useNavigationStore()
	const user = useAuthStore((state) => state.user)
	const openWorkspace = useNavigationStore((state) => state.openWorkspace)
	const [servicesOpen, setServicesOpen] = useState(false)
	const select = (screen: ScreenId) => { navigate(screen); setServicesOpen(false) }
	return <header className="site-header"><button className="brand" onClick={() => select('home')} aria-label="Urban Tanker home"><img className="brand-wordmark" src="/urban-tanker-wordmark.png" alt="Urban Tanker" /></button><nav id="main-navigation" className={`main-nav ${mobileMenuOpen ? 'is-open' : ''}`} aria-label="Main navigation">{<div className="nav-dropdown"><button className="nav-dropdown-toggle" aria-expanded={servicesOpen} aria-controls="services-menu" onClick={() => setServicesOpen(!servicesOpen)}>Services <ChevronDown size={14} aria-hidden="true" /></button>{servicesOpen && <div id="services-menu" className="nav-dropdown-menu">{serviceItems.map((item) => <button key={item} onClick={() => select('booking')}><b>{item}</b><small>Book this service</small></button>)}<button onClick={() => select('services')}><b>Explore all services</b><small>Details, features and use cases</small></button></div>}</div>}{navItems.map((item) => <button key={item.screen} className={activeScreen === item.screen ? 'is-active' : ''} aria-current={activeScreen === item.screen ? 'page' : undefined} onClick={() => select(item.screen)}>{item.label}</button>)}<button onClick={() => select('partner')}>Become a partner</button></nav><div className="header-actions"><button className="button button-quiet account-button" onClick={() => user ? openWorkspace(user.role) : select('login')}>{user ? 'My account' : 'Log in'}</button>{!user && <button className="button button-primary" onClick={() => select('booking')}>Book now</button>}<button className="icon-button menu-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-expanded={mobileMenuOpen} aria-controls="main-navigation" aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}>{mobileMenuOpen ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}</button></div></header>
}
