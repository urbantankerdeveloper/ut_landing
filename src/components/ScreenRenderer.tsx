import { lazy, Suspense, useEffect, useState } from 'react'
import { MIN_SCREEN_LOADING_MS } from '../constants/loading'
import { ScreenSkeleton } from './ScreenSkeleton'
import { useNavigationStore } from '../stores/navigationStore'
const screens = { home: lazy(() => import('../screens/HomeScreen')), services: lazy(() => import('../screens/ServicesScreen')), subscriptions: lazy(() => import('../screens/SubscriptionsScreen')), booking: lazy(() => import('../screens/BookingScreen')), 'yearly-contract': lazy(() => import('../screens/BookingScreen')), coupons: lazy(() => import('../screens/PublicReferenceScreen')), tracking: lazy(() => import('../screens/PublicReferenceScreen')), partner: lazy(() => import('../screens/PartnerApplicationScreen')), terms: lazy(() => import('../screens/PublicReferenceScreen')), policy: lazy(() => import('../screens/PublicReferenceScreen')), account: lazy(() => import('../screens/AccountScreen')), login: lazy(() => import('../screens/LoginScreen')), about: lazy(() => import('../screens/AboutScreen')) } as const
const workspaceScreens = { 'customer-workspace': lazy(() => import('../screens/WorkspaceScreen')), 'vendor-workspace': lazy(() => import('../screens/WorkspaceScreen')), 'admin-workspace': lazy(() => import('../screens/WorkspaceScreen')) } as const
const allScreens = { ...screens, ...workspaceScreens }
export function ScreenRenderer() {
	const activeScreen = useNavigationStore((state) => state.activeScreen)
	if (activeScreen === 'home' || activeScreen === 'login' || activeScreen.endsWith('-workspace')) {
		const Screen = allScreens[activeScreen]
		return <Suspense fallback={null}><Screen /></Suspense>
	}
	return <ScreenLoadingGate key={activeScreen} activeScreen={activeScreen} />
}

function ScreenLoadingGate({ activeScreen }: { activeScreen: keyof typeof allScreens }) {
	const [minimumLoadingComplete, setMinimumLoadingComplete] = useState(false)
	const Screen = allScreens[activeScreen]
	const workspace = activeScreen === 'vendor-workspace' || activeScreen === 'admin-workspace'

	useEffect(() => {
		const timer = window.setTimeout(() => setMinimumLoadingComplete(true), MIN_SCREEN_LOADING_MS)
		return () => window.clearTimeout(timer)
	}, [])

	if (!workspace) return <Suspense fallback={null}><Screen /></Suspense>
	if (!minimumLoadingComplete) return <ScreenSkeleton workspace={workspace} />
	return <Suspense fallback={<ScreenSkeleton workspace={workspace} />}><Screen /></Suspense>
}
