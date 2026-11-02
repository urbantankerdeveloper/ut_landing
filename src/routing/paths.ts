import type { ScreenId, WorkspaceRole } from '../stores/navigationStore'

// Every screen has one URL. Paths not listed here fall back to the router's catch-all route.
export const screenPaths: Record<ScreenId, string> = {
  home: '/',
  services: '/services',
  subscriptions: '/subscriptions',
  booking: '/booking',
  'yearly-contract': '/yearly-contract',
  coupons: '/coupons',
  tracking: '/tracking',
  partner: '/partner',
  terms: '/terms',
  policy: '/policy',
  about: '/about',
  account: '/account',
  login: '/login',
  'customer-workspace': '/workspace/customer',
  'vendor-workspace': '/workspace/vendor',
  'admin-workspace': '/workspace/admin',
  'dispatcher-workspace': '/workspace/dispatcher',
}

// Screens that search engines may index. Account, sign-in, workspace and tracking-token pages are kept out of the index.
export const publicScreens = new Set<ScreenId>(['home', 'services', 'subscriptions', 'booking', 'yearly-contract', 'coupons', 'tracking', 'partner', 'terms', 'policy', 'about'])

const workspaceRoles: WorkspaceRole[] = ['customer', 'vendor', 'admin', 'dispatcher']

export function isWorkspaceRole(value: string | undefined): value is WorkspaceRole {
  return workspaceRoles.includes(value as WorkspaceRole)
}

export function workspaceScreen(role: WorkspaceRole): ScreenId {
  return `${role}-workspace` as ScreenId
}

export function screenPath(screen: ScreenId) {
  return screenPaths[screen]
}

export function screenFromPath(pathname: string): ScreenId {
  if (pathname.startsWith('/track/')) return 'tracking'
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const screen = (Object.keys(screenPaths) as ScreenId[]).find((id) => screenPaths[id] === path)
  return screen ?? 'home'
}

export function roleFromPath(pathname: string): WorkspaceRole | null {
  const role = pathname.match(/^\/workspace\/([a-z]+)\/?$/)?.[1]
  return isWorkspaceRole(role) ? role : null
}
