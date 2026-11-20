import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useBlocker, useLocation } from 'react-router'
import { authApi } from '../api/auth'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { PhoneVerifyDialog } from '../components/PhoneVerifyDialog'
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
import { notifyError, notifySuccess } from '../utils/notify'

export function AppShell() {
	useFormGuards()
	const { activeScreen, navigate } = useAppNavigation()
	const { pathname } = useLocation()
	const isPublicTracking = /^\/track\/[A-Za-z0-9_-]+$/.test(pathname)
	const partnerFormDirty = useNavigationStore((state) => state.partnerFormDirty)
	const bookingCompleted = useNavigationStore((state) => state.bookingCompleted)
	const user = useAuthStore((state) => state.user)
	const hasHydrated = useAuthStore((state) => state.hasHydrated)
	const setUser = useAuthStore((state) => state.setUser)
	const [phoneVerifyDialogUserId, setPhoneVerifyDialogUserId] = useState<string | null>(null)
	const loadedPhoneProfileFor = useRef<string | null>(null)
	const phoneVerifyDialogEnabled = import.meta.env.VITE_PHONE_VERIFY_DIALOG_ENABLED === 'true'
	const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname && needsLeaveConfirmation(currentLocation.pathname, nextLocation.pathname))
	useEffect(() => {
		if (user && (activeScreen === 'login' || activeScreen === 'account')) navigate('home', { replace: true })
	}, [activeScreen, navigate, user])
	useEffect(() => {
		if (!phoneVerifyDialogEnabled || !hasHydrated || !user) {
			if (!user) {
				loadedPhoneProfileFor.current = null
			}
			return
		}
		const userId = user.id
		if (!userId || loadedPhoneProfileFor.current === userId) return
		let active = true
		loadedPhoneProfileFor.current = userId
		void authApi.me().then(({ user: profile }) => {
			if (!active) return
			setUser(profile)
			if (profile.phoneVerified === false) {
				setPhoneVerifyDialogUserId(userId)
			} else {
				setPhoneVerifyDialogUserId((current) => current === userId ? null : current)
			}
		}).catch((error: unknown) => {
			if (active) notifyError(error instanceof Error ? error.message : 'Your phone verification status could not be checked.')
		})
		return () => { active = false }
	}, [hasHydrated, phoneVerifyDialogEnabled, setUser, user])
	async function phoneVerified(result: { phone: string }) {
		const current = useAuthStore.getState().user
		if (current) setUser({ ...current, phone: result.phone, phoneVerified: true })
		try {
			const profile = await authApi.me()
			setUser(profile.user)
		} catch (error) {
			notifyError(error instanceof Error ? error.message : 'Your profile could not be refreshed.')
		}
		notifySuccess('Phone number verified.')
	}
	const isBookingScreen = activeScreen === 'booking' && !bookingCompleted
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
		{phoneVerifyDialogEnabled && user && phoneVerifyDialogUserId === user.id && <PhoneVerifyDialog
			initialPhone={user?.phone}
			allowSkip
			onClose={() => setPhoneVerifyDialogUserId(null)}
			onVerified={phoneVerified}
		/>}
	</div>
}
