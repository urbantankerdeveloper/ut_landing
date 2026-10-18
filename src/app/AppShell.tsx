import { useEffect } from 'react'
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
	return <div className={`app-shell ${isWorkspace ? 'app-shell-workspace' : ''} ${isAuthScreen ? 'app-shell-auth' : ''}`}><a className="skip-link" href="#main-content">Skip to main content</a>{!isWorkspace && !isAuthScreen && <Header />}<main id="main-content"><ScreenRenderer /></main>{!isWorkspace && !isAuthScreen && <Footer />}</div>
}
