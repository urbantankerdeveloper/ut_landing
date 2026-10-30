import { lazy, Suspense } from 'react'
import { ScreenSkeleton } from './ScreenSkeleton'
import { useNavigationStore } from '../stores/navigationStore'
const PublicTrackingScreen = lazy(() => import('../screens/PublicTrackingScreen'))
const screens = { home: lazy(() => import('../screens/HomeScreen')), services: lazy(() => import('../screens/ServicesScreen')), subscriptions: lazy(() => import('../screens/SubscriptionsScreen')), booking: lazy(() => import('../screens/BookingScreen')), 'yearly-contract': lazy(() => import('../screens/BookingScreen')), coupons: lazy(() => import('../screens/PublicReferenceScreen')), tracking: lazy(() => import('../screens/PublicReferenceScreen')), partner: lazy(() => import('../screens/PartnerApplicationScreen')), terms: lazy(() => import('../screens/PublicReferenceScreen')), policy: lazy(() => import('../screens/PublicReferenceScreen')), account: lazy(() => import('../screens/AccountScreen')), login: lazy(() => import('../screens/LoginScreen')), about: lazy(() => import('../screens/AboutScreen')) } as const
const workspaceScreens = { 'customer-workspace': lazy(() => import('../screens/WorkspaceScreen')), 'vendor-workspace': lazy(() => import('../screens/WorkspaceScreen')), 'dispatcher-workspace': lazy(() => import('../screens/WorkspaceScreen')), 'admin-workspace': lazy(() => import('../screens/WorkspaceScreen')) } as const
const allScreens = { ...screens, ...workspaceScreens }
export function ScreenRenderer() {
	const activeScreen = useNavigationStore((state) => state.activeScreen)
	const trackingMatch = typeof window !== 'undefined' ? window.location.pathname.match(/^\/track\/([A-Za-z0-9_-]+)$/) : null
	if (trackingMatch) return <Suspense fallback={<ScreenSkeleton workspace={false} />}><PublicTrackingScreen token={trackingMatch[1]} /></Suspense>
	const Screen = allScreens[activeScreen]
	const fallback = activeScreen === 'login'
		? <LoginLoadingScreen />
		: activeScreen.endsWith('-workspace')
			? <ScreenSkeleton workspace />
			: <ScreenSkeleton workspace={false} />
	return <Suspense fallback={fallback}><Screen /></Suspense>
}

function LoginLoadingScreen() {
	return <section className="auth-loading-screen" role="status" aria-live="polite" aria-label="Loading login screen"><div className="auth-loading-spinner" /><p>Loading your account</p></section>
}
