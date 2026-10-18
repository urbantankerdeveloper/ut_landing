import { useEffect, useRef } from 'react'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { ScreenRenderer } from '../components/ScreenRenderer'
import { useNavigationStore } from '../stores/navigationStore'
import { useFormGuards } from '../hooks/useFormGuards'
import { useAuthStore } from '../stores/authStore'
import type { WorkspaceRole } from '../stores/navigationStore'

export function AppShell() {
	useFormGuards()
	const activeScreen = useNavigationStore((state) => state.activeScreen)
	const openWorkspace = useNavigationStore((state) => state.openWorkspace)
	const user = useAuthStore((state) => state.user)
	useEffect(() => {
		if (user && (activeScreen === 'home' || activeScreen === 'login' || activeScreen === 'account')) openWorkspace(user.role as WorkspaceRole)
	}, [activeScreen, openWorkspace, user])
	const isWorkspace = activeScreen.endsWith('-workspace')
	const isAuthScreen = activeScreen === 'login'
	const mainRef = useRef<HTMLElement>(null)
	useEffect(() => {
		const titles: Record<string, string> = {
			home: 'Urban Tanker | One App. All Water Services.',
			services: 'Services | Urban Tanker',
			subscriptions: 'Subscriptions | Urban Tanker',
			booking: 'Book a service | Urban Tanker',
			'yearly-contract': 'Yearly contract | Urban Tanker',
			coupons: 'Coupons | Urban Tanker',
			tracking: 'Track your booking | Urban Tanker',
			partner: 'Become a partner | Urban Tanker',
			terms: 'Terms and conditions | Urban Tanker',
			policy: 'Privacy policy | Urban Tanker',
			account: 'My account | Urban Tanker',
			login: 'Sign in | Urban Tanker',
			about: 'About Urban Tanker',
			'customer-workspace': 'Customer workspace | Urban Tanker',
			'vendor-workspace': 'Vendor workspace | Urban Tanker',
			'admin-workspace': 'Admin workspace | Urban Tanker',
			'dispatcher-workspace': 'Dispatch workspace | Urban Tanker',
		}
		document.title = titles[activeScreen] ?? 'Urban Tanker'
		mainRef.current?.focus()
	}, [activeScreen])
	return <div className={`app-shell ${isWorkspace ? 'app-shell-workspace' : ''} ${isAuthScreen ? 'app-shell-auth' : ''}`}><a className="skip-link" href="#main-content">Skip to main content</a>{!isWorkspace && !isAuthScreen && <Header />}<main ref={mainRef} id="main-content" tabIndex={-1} aria-labelledby="page-announcement"><span id="page-announcement" className="visually-hidden" aria-live="polite">{activeScreen.replaceAll('-', ' ')}</span><ScreenRenderer /></main>{!isWorkspace && !isAuthScreen && <Footer />}</div>
}
