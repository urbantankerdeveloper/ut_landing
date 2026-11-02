import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { BOOKING_DRAFT_KEY, REPEAT_BOOKING_KEY } from '../constants/bookingDraft'
import { useNavigationStore, type ScreenId, type WorkspaceRole } from '../stores/navigationStore'
import { roleFromPath, screenFromPath, screenPath, workspaceScreen } from './paths'

// Booking and partner drafts ask before the user leaves them. The router blocker also covers browser back and forward.
export function needsLeaveConfirmation(fromPathname: string, toPathname: string) {
  const currentScreen = screenFromPath(fromPathname)
  const nextScreen = screenFromPath(toPathname)
  if (currentScreen === nextScreen) return false
  return currentScreen === 'booking' || (currentScreen === 'partner' && useNavigationStore.getState().partnerFormDirty)
}

// Runs once a navigation is allowed: clears drafts that belong to the screen being left and closes the mobile menu.
export function prepareScreenChange(pathname: string) {
  const screen = screenFromPath(pathname)
  window.sessionStorage.removeItem(BOOKING_DRAFT_KEY)
  if (screen === 'booking') window.sessionStorage.removeItem(REPEAT_BOOKING_KEY)
  const { setMobileMenuOpen, setPartnerFormDirty } = useNavigationStore.getState()
  setMobileMenuOpen(false)
  if (screen !== 'partner') setPartnerFormDirty(false)
}

export function useAppNavigation() {
  const routerNavigate = useNavigate()
  const { pathname } = useLocation()
  const navigate = useCallback((screen: ScreenId, options?: { replace?: boolean }) => {
    const target = screenPath(screen)
    if (!needsLeaveConfirmation(window.location.pathname, target)) prepareScreenChange(target)
    routerNavigate(target, options)
  }, [routerNavigate])
  const openWorkspace = useCallback((role: WorkspaceRole, options?: { replace?: boolean }) => navigate(workspaceScreen(role), options), [navigate])
  return {
    activeScreen: screenFromPath(pathname),
    activeRole: roleFromPath(pathname) ?? 'customer',
    navigate,
    openWorkspace,
  }
}
