import { Suspense, useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { lazyWithRetry } from '../utils/lazyWithRetry'
import { BarChart3, Bell, CalendarCheck, ChevronDown, CircleDollarSign, ClipboardList, FileText, Gauge, House, LayoutDashboard, LogOut, MapPin, Menu, MessageSquare, PanelLeftClose, PanelLeftOpen, Receipt, Repeat, Settings2, Tag, Truck, UserRound, UserPlus, Users, Wallet, X } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useNavigationStore, type WorkspaceRole } from '../stores/navigationStore'
import { WorkspaceContentSkeleton } from '../components/ScreenSkeleton'
import { useVendorOfflineSync } from '../hooks/useVendorData'
import { authApi } from '../api/auth'
import { clearOfflineQueue } from '../services/offlineMutationQueue'
import { BOOKING_DRAFT_KEY, REPEAT_BOOKING_KEY } from '../constants/bookingDraft'
import { workspaceContent as w } from '../content/workspace'

const WorkspaceContent = lazyWithRetry(() => import('./WorkspaceContent').then(({ WorkspaceContent: content }) => ({ default: content })))

type NavItem = { label: string; icon: typeof House; key: string }
type NavGroup = { label: string; icon: typeof House; keys: string[] }
type RoleData = { caption: string; title: string; description: string; nav: NavItem[]; metrics: { label: string; value: string; note: string; icon: typeof ClipboardList }[] }
const adminNavGroups: NavGroup[] = [
  { label: w.navGroups.admin.bookingsDispatch, icon: ClipboardList, keys: ['live', 'bookings', 'notifications', 'complaints', 'alerts'] },
  { label: w.navGroups.admin.peopleFleet, icon: Users, keys: ['vendors', 'onboarding', 'fleet', 'drivers', 'customers'] },
  { label: w.navGroups.admin.financePromos, icon: Wallet, keys: ['finance', 'coupons'] },
  { label: w.navGroups.admin.reportsSetup, icon: Settings2, keys: ['reports', 'analytics', 'services', 'system-health'] },
]
const vendorNavGroups: NavGroup[] = [
  { label: w.navGroups.vendor.ordersSupport, icon: ClipboardList, keys: ['orders', 'complaints', 'notifications'] },
  { label: w.navGroups.vendor.servicesTeam, icon: Users, keys: ['services', 'location', 'vehicles', 'drivers', 'documents', 'attendance'] },
  { label: w.navGroups.vendor.earnings, icon: Wallet, keys: ['earnings'] },
]
const dispatcherNavGroups: NavGroup[] = [
  { label: w.navGroups.dispatcher.dispatchOperations, icon: ClipboardList, keys: ['live', 'bookings'] },
  { label: w.navGroups.dispatcher.reportsAlerts, icon: Bell, keys: ['reports', 'alerts'] },
]
const roleData: Record<WorkspaceRole, RoleData> = {
  customer: { caption: w.roles.customer.caption, title: w.roles.customer.title, description: w.roles.customer.description, nav: [{ label: w.nav.customer.overview, icon: House, key: 'overview' }, { label: w.nav.customer.bookings, icon: ClipboardList, key: 'bookings' }, { label: w.nav.customer.tracking, icon: MapPin, key: 'tracking' }, { label: w.nav.customer.addresses, icon: MapPin, key: 'addresses' }, { label: w.nav.customer.profile, icon: UserRound, key: 'profile' }, { label: w.nav.customer.wallet, icon: Wallet, key: 'wallet' }, { label: w.nav.customer.invoices, icon: Receipt, key: 'invoices' }, { label: w.nav.customer.notifications, icon: Bell, key: 'notifications' }, { label: w.nav.customer.support, icon: Bell, key: 'support' }, { label: w.nav.customer.contracts, icon: Repeat, key: 'contracts' }], metrics: [] },
  vendor: { caption: w.roles.vendor.caption, title: w.roles.vendor.title, description: w.roles.vendor.description, nav: [{ label: w.nav.vendor.overview, icon: LayoutDashboard, key: 'overview' }, { label: w.nav.vendor.orders, icon: ClipboardList, key: 'orders' }, { label: w.nav.vendor.services, icon: Gauge, key: 'services' }, { label: w.nav.vendor.location, icon: MapPin, key: 'location' }, { label: w.nav.vendor.vehicles, icon: Truck, key: 'vehicles' }, { label: w.nav.vendor.drivers, icon: Users, key: 'drivers' }, { label: w.nav.vendor.documents, icon: FileText, key: 'documents' }, { label: w.nav.vendor.attendance, icon: CalendarCheck, key: 'attendance' }, { label: w.nav.vendor.earnings, icon: CircleDollarSign, key: 'earnings' }, { label: w.nav.vendor.complaints, icon: Bell, key: 'complaints' }, { label: w.nav.vendor.notifications, icon: Bell, key: 'notifications' }], metrics: [] },
  admin: { caption: w.roles.admin.caption, title: w.roles.admin.title, description: w.roles.admin.description, nav: [{ label: w.nav.admin.overview, icon: LayoutDashboard, key: 'overview' }, { label: w.nav.admin.live, icon: MapPin, key: 'live' }, { label: w.nav.admin.bookings, icon: ClipboardList, key: 'bookings' }, { label: w.nav.admin.notifications, icon: Bell, key: 'notifications' }, { label: w.nav.admin.reports, icon: FileText, key: 'reports' }, { label: w.nav.admin.analytics, icon: BarChart3, key: 'analytics' }, { label: w.nav.admin.vendors, icon: Users, key: 'vendors' }, { label: w.nav.admin.fleet, icon: Truck, key: 'fleet' }, { label: w.nav.admin.drivers, icon: UserRound, key: 'drivers' }, { label: w.nav.admin.customers, icon: Users, key: 'customers' }, { label: w.nav.admin.onboarding, icon: UserPlus, key: 'onboarding' }, { label: w.nav.admin.services, icon: Settings2, key: 'services' }, { label: w.nav.admin.finance, icon: Wallet, key: 'finance' }, { label: w.nav.admin.complaints, icon: Bell, key: 'complaints' }, { label: w.nav.admin.alerts, icon: Bell, key: 'alerts' }, { label: w.nav.admin.coupons, icon: Tag, key: 'coupons' }, { label: w.nav.admin.smsTemplates, icon: MessageSquare, key: 'sms-templates' }, { label: w.nav.admin.systemHealth, icon: Settings2, key: 'system-health' }], metrics: [] },
  dispatcher: { caption: w.roles.dispatcher.caption, title: w.roles.dispatcher.title, description: w.roles.dispatcher.description, nav: [{ label: w.nav.dispatcher.overview, icon: LayoutDashboard, key: 'overview' }, { label: w.nav.dispatcher.live, icon: MapPin, key: 'live' }, { label: w.nav.dispatcher.bookings, icon: ClipboardList, key: 'bookings' }, { label: w.nav.dispatcher.reports, icon: FileText, key: 'reports' }, { label: w.nav.dispatcher.alerts, icon: Bell, key: 'alerts' }], metrics: [] },
}

export default function WorkspaceScreen() {
  const activeRole = useNavigationStore((state) => state.activeRole)
  const navigate = useNavigationStore((state) => state.navigate)
  useVendorOfflineSync(activeRole === 'vendor')
  const user = useAuthStore((state) => state.user)
  const signOut = useAuthStore((state) => state.signOut)
  const queryClient = useQueryClient()
  const data = roleData[activeRole]
  const [activeItem, setActiveItem] = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedAdminGroups, setExpandedAdminGroups] = useState<Set<string>>(() => new Set())
  const [notices, setNotices] = useState<Array<{ id: number; message: string }>>([])
  const displayName = user?.name ?? (activeRole === 'admin' ? w.shell.displayName.admin : activeRole === 'dispatcher' ? w.shell.displayName.dispatcher : activeRole === 'vendor' ? w.shell.displayName.vendor : w.shell.displayName.customer)
  const navigationGroups = activeRole === 'admin' ? adminNavGroups : activeRole === 'vendor' ? vendorNavGroups : dispatcherNavGroups
  const selectItem = useCallback((key: string) => { setActiveItem(key); const group = navigationGroups.find((item) => item.keys.includes(key)); if (group) setExpandedAdminGroups(new Set([group.label])); setNotices([]); setSidebarOpen(false) }, [navigationGroups])
  const addNotice = useCallback((message: string) => { const id = Date.now() + Math.random(); setNotices((current) => [...current.slice(-4), { id, message }]); window.setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), 5000) }, [])
  const navigateContent = useCallback((screen: 'booking' | 'bookings' | 'offers' | 'home') => screen === 'booking' ? navigate('booking') : screen === 'offers' ? selectItem('offers') : navigate('home'), [navigate, selectItem])
  const logout = async () => {
    await authApi.logout().catch(() => undefined)
    queryClient.clear()
    clearOfflineQueue()
    sessionStorage.removeItem(BOOKING_DRAFT_KEY)
    sessionStorage.removeItem(REPEAT_BOOKING_KEY)
    signOut()
    navigate('home')
  }
  const renderNavItem = ({ label, icon: Icon, key }: NavItem) => <button className={activeItem === key ? 'is-active' : ''} aria-current={activeItem === key ? 'page' : undefined} key={key} onClick={() => selectItem(key)} title={sidebarCollapsed ? label : undefined}><Icon size={16} /><span>{label}</span></button>
  const renderNavGroups = (groups: NavGroup[]) => <>
    {data.nav.filter((item) => item.key === 'overview').map(renderNavItem)}
    {groups.map((group) => {
      const GroupIcon = group.icon
      const isExpanded = expandedAdminGroups.has(group.label)
      const items = data.nav.filter((item) => group.keys.includes(item.key))
      return <div className="workspace-nav-group" key={group.label}>
        <button className="workspace-nav-group-toggle" type="button" aria-expanded={isExpanded} onClick={() => setExpandedAdminGroups((current) => current.has(group.label) ? new Set() : new Set([group.label]))} title={sidebarCollapsed ? group.label : undefined}>
          <GroupIcon size={16} /><span>{group.label}</span><ChevronDown className="workspace-nav-group-chevron" size={14} />
        </button>
        <div className={`workspace-nav-group-items ${isExpanded ? 'is-expanded' : ''}`}>
          {items.map(renderNavItem)}
        </div>
      </div>
    })}
  </>
  return <section className={`workspace-app workspace-app-${activeRole} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className={`workspace-sidebar-new ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="sidebar-brand"><button className="brand" onClick={() => navigate('home')} aria-label={w.shell.homeAria}><img className="brand-wordmark workspace-wordmark" src="/urban-tanker-wordmark-white.png" alt={w.shell.brandAlt} /></button><button className="sidebar-collapse-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed ? w.shell.expandSidebar : w.shell.collapseSidebar} title={sidebarCollapsed ? w.shell.expandSidebar : w.shell.collapseSidebar}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button><button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label={w.shell.closeSidebar}><X size={17} /></button></div>
      <p className="workspace-caption-new">{data.caption}</p>
      <nav className="workspace-nav-new" aria-label={w.shell.workspacePagesAria(activeRole)}>
        {activeRole === 'admin' || activeRole === 'vendor' || activeRole === 'dispatcher'
          ? renderNavGroups(navigationGroups)
          : data.nav.map(renderNavItem)}
      </nav>
      <p className="workspace-caption-new sidebar-footer-label">{w.shell.footerLabel}</p>
    </aside>
    {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label={w.shell.closeSidebar} />}
    <main className="workspace-main-new">
      <header className="workspace-topbar-new">
        <button className="sidebar-open" onClick={() => setSidebarOpen(true)} aria-label={w.shell.openSidebar}><Menu size={19} /></button>
        <span className="topbar-title">{activeItem === 'overview' ? data.title : data.nav.find((item) => item.key === activeItem)?.label}</span>
        <div className="topbar-identity">
          <button className="topbar-home" onClick={() => navigate('home')}>{w.shell.home}</button>
          <span className="workspace-avatar-new">{displayName.slice(0, 1)}</span><span className="topbar-person">{displayName}</span>
          <button className="button button-quiet topbar-logout" onClick={logout}><LogOut size={14} /> {w.shell.logOut}</button>
        </div>
      </header>
      <div className="workspace-content-new">
        {activeItem === 'overview' && <><div className="workspace-heading-new"><div><p className="eyebrow">{data.caption}</p><h1>{data.description}</h1></div></div><div className="workspace-metrics-new">{data.metrics.map(({ label, value, note, icon: Icon }) => <article key={label}><span className="metric-icon"><Icon size={18} /></span><small>{label}</small><strong>{value}</strong><span className="metric-note">{note}</span></article>)}</div></>}
        <Suspense fallback={<WorkspaceContentSkeleton />}><WorkspaceContent role={activeRole} item={activeItem} onNavigate={navigateContent} onNotice={addNotice} /></Suspense>
        {notices.length > 0 && <div className="workspace-notice-stack" aria-live="polite">{notices.map((notice) => <p className="workspace-notice-global" role="status" key={notice.id}>{notice.message}</p>)}</div>}
      </div>
    </main>
  </section>
}
