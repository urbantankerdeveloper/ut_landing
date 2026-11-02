import { Suspense } from 'react'
import { lazyWithRetry } from '../utils/lazyWithRetry'
import { ScreenSkeleton } from './ScreenSkeleton'
import { useNavigationStore } from '../stores/navigationStore'
const PublicTrackingScreen = lazyWithRetry(() => import('../screens/PublicTrackingScreen'))
const screens = { home: lazyWithRetry(() => import('../screens/HomeScreen')), services: lazyWithRetry(() => import('../screens/ServicesScreen')), subscriptions: lazyWithRetry(() => import('../screens/SubscriptionsScreen')), booking: lazyWithRetry(() => import('../screens/BookingScreen')), 'yearly-contract': lazyWithRetry(() => import('../screens/BookingScreen')), coupons: lazyWithRetry(() => import('../screens/PublicReferenceScreen')), tracking: lazyWithRetry(() => import('../screens/PublicReferenceScreen')), partner: lazyWithRetry(() => import('../screens/PartnerApplicationScreen')), terms: lazyWithRetry(() => import('../screens/PublicReferenceScreen')), policy: lazyWithRetry(() => import('../screens/PublicReferenceScreen')), account: lazyWithRetry(() => import('../screens/AccountScreen')), login: lazyWithRetry(() => import('../screens/LoginScreen')), about: lazyWithRetry(() => import('../screens/AboutScreen')) } as const
const workspaceScreens = { 'customer-workspace': lazyWithRetry(() => import('../screens/WorkspaceScreen')), 'vendor-workspace': lazyWithRetry(() => import('../screens/WorkspaceScreen')), 'dispatcher-workspace': lazyWithRetry(() => import('../screens/WorkspaceScreen')), 'admin-workspace': lazyWithRetry(() => import('../screens/WorkspaceScreen')) } as const
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
