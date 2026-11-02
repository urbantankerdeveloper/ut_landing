import { useEffect, useLayoutEffect, useRef } from 'react'
import { Outlet, useBlocker, useLocation } from 'react-router'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { ServerWakingNotice } from '../components/ServerWakingNotice'
import { ScreenSkeleton } from '../components/ScreenSkeleton'
import { useFormGuards } from '../hooks/useFormGuards'
import { useNavigationStore } from '../stores/navigationStore'
import { useAuthStore } from '../stores/authStore'
import { Modal } from '../components/Modal'
import { BookingPageFooter, BookingPageHeader } from '../components/booking/BookingPageChrome'
import { chromeContent as c } from '../content/chrome'
import { needsLeaveConfirmation, prepareScreenChange, useAppNavigation } from '../routing/useAppNavigation'
import { useDocumentMeta } from '../routing/useDocumentMeta'

export function AppShell() {
	useFormGuards()
	const { activeScreen, openWorkspace } = useAppNavigation()
	const { pathname } = useLocation()
	const isPublicTracking = /^\/track\/[A-Za-z0-9_-]+$/.test(pathname)
	const partnerFormDirty = useNavigationStore((state) => state.partnerFormDirty)
	const user = useAuthStore((state) => state.user)
	const hasHydrated = useAuthStore((state) => state.hasHydrated)
	const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && needsLeaveConfirmation(currentLocation.pathname, nextLocation.pathname))
	useEffect(() => {
		if (user && (activeScreen === 'home' || activeScreen === 'login' || activeScreen === 'account')) openWorkspace(user.role, { replace: true })
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
	useDocumentMeta(pathname)
	useLayoutEffect(() => {
		window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
		mainRef.current?.focus({ preventScroll: true })
	}, [pathname])
	if (!hasHydrated) return <div className="app-shell app-shell-hydrating"><main id="main-content"><ScreenSkeleton workspace={false} /></main></div>
	return <div className={`app-shell ${isWorkspace ? 'app-shell-workspace' : ''} ${isAuthScreen ? 'app-shell-auth' : ''} ${isPublicTracking ? 'app-shell-public-tracking' : ''}`}>
		<a className="skip-link" href="#main-content">{c.appShell.skipToMain}</a>
		{isPublicTracking ? <header className="public-tracking-header"><span>{c.appShell.publicTrackingHeading}</span></header>: isBookingScreen ? <BookingPageHeader /> : !isWorkspace && !isAuthScreen && <Header />}
		<main ref={mainRef} id="main-content" tabIndex={-1} aria-labelledby={isPublicTracking ? undefined : 'page-announcement'}>{!isPublicTracking && <span id="page-announcement" className="visually-hidden" aria-live="polite">{activeScreen.replaceAll('-', ' ')}</span>}<Outlet /></main>
		{isBookingScreen ? <BookingPageFooter /> : !isPublicTracking && !isWorkspace && !isAuthScreen && <Footer />}
		<ServerWakingNotice />
		{blocker.state === 'blocked' && <Modal title={activeScreen === 'partner' ? c.appShell.leavePartner.title : c.appShell.leaveBooking.title} onClose={blocker.reset}><div className="booking-exit-confirmation"><p>{activeScreen === 'partner' ? c.appShell.leavePartner.body : c.appShell.leaveBooking.body}</p><div><button className="button button-quiet" type="button" onClick={blocker.reset}>{c.appShell.stayOnPage}</button><button className="button button-primary" type="button" onClick={() => { prepareScreenChange(blocker.location.pathname); blocker.proceed() }}>{activeScreen === 'partner' ? c.appShell.leavePartner.confirm : c.appShell.leaveBooking.confirm}</button></div></div></Modal>}
	</div>
}
