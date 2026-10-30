import { useEffect, useLayoutEffect, useRef } from 'react'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { ScreenRenderer } from '../components/ScreenRenderer'
import { ScreenSkeleton } from '../components/ScreenSkeleton'
import { useNavigationStore } from '../stores/navigationStore'
import { useFormGuards } from '../hooks/useFormGuards'
import { useAuthStore } from '../stores/authStore'
import type { WorkspaceRole } from '../stores/navigationStore'
import { Modal } from '../screens/WorkspaceInteractive'
import { BookingPageFooter, BookingPageHeader } from '../components/booking/BookingPageChrome'

export function AppShell() {
	useFormGuards()
	const activeScreen = useNavigationStore((state) => state.activeScreen)
	const isPublicTracking = typeof window !== 'undefined' && /^\/track\/[A-Za-z0-9_-]+$/.test(window.location.pathname)
	const openWorkspace = useNavigationStore((state) => state.openWorkspace)
	const pendingNavigation = useNavigationStore((state) => state.pendingNavigation)
	const partnerFormDirty = useNavigationStore((state) => state.partnerFormDirty)
	const confirmNavigation = useNavigationStore((state) => state.confirmNavigation)
	const cancelNavigation = useNavigationStore((state) => state.cancelNavigation)
	const user = useAuthStore((state) => state.user)
	const hasHydrated = useAuthStore((state) => state.hasHydrated)
	useEffect(() => {
		if (user && (activeScreen === 'home' || activeScreen === 'login' || activeScreen === 'account')) openWorkspace(user.role as WorkspaceRole)
	}, [activeScreen, openWorkspace, user])
	const isBookingScreen = activeScreen === 'booking'
	const isPartnerDraft = activeScreen === 'partner' && partnerFormDirty
	useEffect(() => {
		if (!isBookingScreen && !isPartnerDraft) return
		const confirmBeforeUnload = (event: BeforeUnloadEvent) => {
			event.preventDefault()
			event.returnValue = ''
		}
		window.addEventListener('beforeunload', confirmBeforeUnload)
		return () => window.removeEventListener('beforeunload', confirmBeforeUnload)
	}, [activeScreen, isBookingScreen, isPartnerDraft])
	const isWorkspace = activeScreen.endsWith('-workspace')
	const isAuthScreen = activeScreen === 'login'
	const mainRef = useRef<HTMLElement>(null)
	useLayoutEffect(() => {
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
		window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
		mainRef.current?.focus({ preventScroll: true })
	}, [activeScreen])
	if (!hasHydrated) return <div className="app-shell app-shell-hydrating"><main id="main-content"><ScreenSkeleton workspace={false} /></main></div>
	return <div className={`app-shell ${isWorkspace ? 'app-shell-workspace' : ''} ${isAuthScreen ? 'app-shell-auth' : ''} ${isPublicTracking ? 'app-shell-public-tracking' : ''}`}>
		<a className="skip-link" href="#main-content">Skip to main content</a>
		{isPublicTracking ? <header className="public-tracking-header"><span>Track your booking</span></header> : isBookingScreen ? <BookingPageHeader /> : !isWorkspace && !isAuthScreen && <Header />}
		<main ref={mainRef} id="main-content" tabIndex={-1} aria-labelledby={isPublicTracking ? undefined : 'page-announcement'}>{!isPublicTracking && <span id="page-announcement" className="visually-hidden" aria-live="polite">{activeScreen.replaceAll('-', ' ')}</span>}<ScreenRenderer /></main>
		{isBookingScreen ? <BookingPageFooter /> : !isPublicTracking && !isWorkspace && !isAuthScreen && <Footer />}
		{pendingNavigation && <Modal title={activeScreen === 'partner' ? 'Leave partner application?' : 'Leave booking?'} onClose={cancelNavigation}><div className="booking-exit-confirmation"><p>{activeScreen === 'partner' ? 'You have an unfinished partner application. If you leave now, the details entered here will be cleared.' : 'Are you sure you want to leave the booking screen? Any details entered here will be cleared.'}</p><div><button className="button button-quiet" type="button" onClick={cancelNavigation}>Stay on this page</button><button className="button button-primary" type="button" onClick={confirmNavigation}>{activeScreen === 'partner' ? 'Leave application' : 'Leave booking'}</button></div></div></Modal>}
	</div>
}
