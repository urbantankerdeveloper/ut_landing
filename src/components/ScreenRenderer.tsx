import { Suspense } from 'react'
import { Navigate, useParams } from 'react-router'
import { lazyWithRetry } from '../utils/lazyWithRetry'
import { ScreenSkeleton } from './ScreenSkeleton'
import { useAuthStore } from '../stores/authStore'
import type { ScreenId } from '../stores/navigationStore'
import { isWorkspaceRole, screenPath, workspaceScreen } from '../routing/paths'
import { chromeContent as c } from '../content/chrome'
const PublicTrackingScreen = lazyWithRetry(() => import('../screens/PublicTrackingScreen'))
const screens = { home: lazyWithRetry(() => import('../screens/HomeScreen')), services: lazyWithRetry(() => import('../screens/ServicesScreen')), subscriptions: lazyWithRetry(() => import('../screens/SubscriptionsScreen')), booking: lazyWithRetry(() => import('../screens/BookingScreen')), 'yearly-contract': lazyWithRetry(() => import('../screens/BookingScreen')), coupons: lazyWithRetry(() => import('../screens/PublicReferenceScreen')), tracking: lazyWithRetry(() => import('../screens/PublicReferenceScreen')), partner: lazyWithRetry(() => import('../screens/PartnerApplicationScreen')), terms: lazyWithRetry(() => import('../screens/PublicReferenceScreen')), policy: lazyWithRetry(() => import('../screens/PublicReferenceScreen')), account: lazyWithRetry(() => import('../screens/AccountScreen')), login: lazyWithRetry(() => import('../screens/LoginScreen')), about: lazyWithRetry(() => import('../screens/AboutScreen')) } as const
const workspaceScreens = { 'customer-workspace': lazyWithRetry(() => import('../screens/WorkspaceScreen')), 'vendor-workspace': lazyWithRetry(() => import('../screens/WorkspaceScreen')), 'dispatcher-workspace': lazyWithRetry(() => import('../screens/WorkspaceScreen')), 'admin-workspace': lazyWithRetry(() => import('../screens/WorkspaceScreen')) } as const
const allScreens = { ...screens, ...workspaceScreens }
export function ScreenRenderer({ screen }: { screen: ScreenId }) {
	const Screen = allScreens[screen]
	const fallback = screen === 'login'
		? <LoginLoadingScreen />
		: screen.endsWith('-workspace')
			? <ScreenSkeleton workspace />
			: <ScreenSkeleton workspace={false} />
	return <Suspense fallback={fallback}><Screen /></Suspense>
}

// Workspaces belong to one signed-in role. Anyone else is sent to the home page, or to their own workspace.
export function WorkspaceRoute() {
	const { role } = useParams()
	const user = useAuthStore((state) => state.user)
	if (!user) return <Navigate to="/" replace />
	if (!isWorkspaceRole(role) || role !== user.role) return <Navigate to={screenPath(workspaceScreen(user.role))} replace />
	return <ScreenRenderer screen={workspaceScreen(role)} />
}

export function TrackingRoute() {
	const { token = '' } = useParams()
	if (!/^[A-Za-z0-9_-]+$/.test(token)) return <Navigate to="/" replace />
	return <Suspense fallback={<ScreenSkeleton workspace={false} />}><PublicTrackingScreen token={token} /></Suspense>
}

function LoginLoadingScreen() {
	return <section className="auth-loading-screen" role="status" aria-live="polite" aria-label={c.screenRenderer.loginLoadingLabel}><div className="auth-loading-spinner" /><p>{c.screenRenderer.loginLoadingText}</p></section>
}
