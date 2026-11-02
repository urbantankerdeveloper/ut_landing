import { useEffect, useLayoutEffect, useRef } from 'react'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { ScreenRenderer } from '../components/ScreenRenderer'
import { ScreenSkeleton } from '../components/ScreenSkeleton'
import { useNavigationStore } from '../stores/navigationStore'
import { useFormGuards } from '../hooks/useFormGuards'
import { useAuthStore } from '../stores/authStore'
import type { WorkspaceRole } from '../stores/navigationStore'
import { Modal } from '../components/Modal'
import { BookingPageFooter, BookingPageHeader } from '../components/booking/BookingPageChrome'
import { chromeContent as c } from '../content/chrome'

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
			home: c.appShell.documentTitles.home,
			services: c.appShell.documentTitles.services,
			subscriptions: c.appShell.documentTitles.subscriptions,
			booking: c.appShell.documentTitles.booking,
			'yearly-contract': c.appShell.documentTitles.yearlyContract,
			coupons: c.appShell.documentTitles.coupons,
			tracking: c.appShell.documentTitles.tracking,
			partner: c.appShell.documentTitles.partner,
			terms: c.appShell.documentTitles.terms,
			policy: c.appShell.documentTitles.policy,
			account: c.appShell.documentTitles.account,
			login: c.appShell.documentTitles.login,
			about: c.appShell.documentTitles.about,
			'customer-workspace': c.appShell.documentTitles.customerWorkspace,
			'vendor-workspace': c.appShell.documentTitles.vendorWorkspace,
			'admin-workspace': c.appShell.documentTitles.adminWorkspace,
			'dispatcher-workspace': c.appShell.documentTitles.dispatcherWorkspace,
		}
		document.title = titles[activeScreen] ?? c.appShell.documentTitles.fallback
		window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
		mainRef.current?.focus({ preventScroll: true })
	}, [activeScreen])
	if (!hasHydrated) return <div className="app-shell app-shell-hydrating"><main id="main-content"><ScreenSkeleton workspace={false} /></main></div>
	return <div className={`app-shell ${isWorkspace ? 'app-shell-workspace' : ''} ${isAuthScreen ? 'app-shell-auth' : ''} ${isPublicTracking ? 'app-shell-public-tracking' : ''}`}>
		<a className="skip-link" href="#main-content">{c.appShell.skipToMain}</a>
		{isPublicTracking ? <header className="public-tracking-header"><span>{c.appShell.publicTrackingHeading}</span></header>: isBookingScreen ? <BookingPageHeader /> : !isWorkspace && !isAuthScreen && <Header />}
		<main ref={mainRef} id="main-content" tabIndex={-1} aria-labelledby={isPublicTracking ? undefined : 'page-announcement'}>{!isPublicTracking && <span id="page-announcement" className="visually-hidden" aria-live="polite">{activeScreen.replaceAll('-', ' ')}</span>}<ScreenRenderer /></main>
		{isBookingScreen ? <BookingPageFooter /> : !isPublicTracking && !isWorkspace && !isAuthScreen && <Footer />}
		{pendingNavigation && <Modal title={activeScreen === 'partner' ? c.appShell.leavePartner.title : c.appShell.leaveBooking.title} onClose={cancelNavigation}><div className="booking-exit-confirmation"><p>{activeScreen === 'partner' ? c.appShell.leavePartner.body : c.appShell.leaveBooking.body}</p><div><button className="button button-quiet" type="button" onClick={cancelNavigation}>{c.appShell.stayOnPage}</button><button className="button button-primary" type="button" onClick={confirmNavigation}>{activeScreen === 'partner' ? c.appShell.leavePartner.confirm : c.appShell.leaveBooking.confirm}</button></div></div></Modal>}
	</div>
}
