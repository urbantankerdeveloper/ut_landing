import { lazy, Suspense, useCallback, useState } from 'react'
import { BarChart3, Bell, CalendarCheck, ChevronDown, CircleDollarSign, ClipboardList, FileText, Gauge, House, LayoutDashboard, LogOut, MapPin, Menu, PanelLeftClose, PanelLeftOpen, Receipt, Repeat, Settings2, Tag, Truck, UserRound, UserPlus, Users, Wallet, X } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useNavigationStore, type WorkspaceRole } from '../stores/navigationStore'
import { WorkspaceContentSkeleton } from '../components/ScreenSkeleton'
import { useVendorOfflineSync } from '../hooks/useVendorData'

const WorkspaceContent = lazy(() => import('./WorkspaceContent').then(({ WorkspaceContent: content }) => ({ default: content })))

type NavItem = { label: string; icon: typeof House; key: string }
type RoleData = { caption: string; title: string; description: string; nav: NavItem[]; metrics: { label: string; value: string; note: string; icon: typeof ClipboardList }[] }
const adminNavGroups = [
  { label: 'Bookings & dispatch', icon: ClipboardList, keys: ['live', 'bookings', 'notifications', 'complaints', 'alerts'] },
  { label: 'People & fleet', icon: Users, keys: ['vendors', 'onboarding', 'fleet', 'drivers', 'customers'] },
  { label: 'Finance & promos', icon: Wallet, keys: ['finance', 'coupons'] },
  { label: 'Reports & setup', icon: Settings2, keys: ['reports', 'analytics', 'services', 'system-health'] },
]
const vendorNavGroups = [
  { label: 'Orders & support', icon: ClipboardList, keys: ['orders', 'complaints', 'notifications'] },
  { label: 'Services & team', icon: Users, keys: ['services', 'location', 'vehicles', 'drivers', 'documents', 'attendance'] },
  { label: 'Earnings', icon: Wallet, keys: ['earnings'] },
]
const dispatcherNavGroups = [
  { label: 'Dispatch operations', icon: ClipboardList, keys: ['live', 'bookings'] },
  { label: 'Reports & alerts', icon: Bell, keys: ['reports', 'alerts'] },
]
const roleData: Record<WorkspaceRole, RoleData> = {
  customer: { caption: 'YOUR URBAN TANKER', title: 'My account', description: 'Keep your requests, deliveries and plans in one place.', nav: [{ label: 'My account', icon: House, key: 'overview' }, { label: 'My Bookings', icon: ClipboardList, key: 'bookings' }, { label: 'Live tracking', icon: MapPin, key: 'tracking' }, { label: 'Saved addresses', icon: MapPin, key: 'addresses' }, { label: 'My profile', icon: UserRound, key: 'profile' }, { label: 'Wallet & bills', icon: Wallet, key: 'wallet' }, { label: 'Invoices', icon: Receipt, key: 'invoices' }, { label: 'Notifications', icon: Bell, key: 'notifications' }, { label: 'Support', icon: Bell, key: 'support' }, { label: 'Yearly contracts', icon: Repeat, key: 'contracts' }], metrics: [] },
  vendor: { caption: 'VENDOR WORKSPACE', title: 'Overview', description: 'Turn nearby demand into reliable, trackable delivery.', nav: [{ label: 'Overview', icon: LayoutDashboard, key: 'overview' }, { label: 'Orders', icon: ClipboardList, key: 'orders' }, { label: 'My services', icon: Gauge, key: 'services' }, { label: 'Service location', icon: MapPin, key: 'location' }, { label: 'My vehicles', icon: Truck, key: 'vehicles' }, { label: 'Drivers', icon: Users, key: 'drivers' }, { label: 'Documents', icon: FileText, key: 'documents' }, { label: 'Attendance', icon: CalendarCheck, key: 'attendance' }, { label: 'Earnings', icon: CircleDollarSign, key: 'earnings' }, { label: 'Complaints', icon: Bell, key: 'complaints' }, { label: 'Notifications', icon: Bell, key: 'notifications' }], metrics: [] },
  admin: { caption: 'ADMIN WORKSPACE', title: 'Dashboard', description: 'Monitor demand, resolve exceptions and keep the network moving.', nav: [{ label: 'Dashboard', icon: LayoutDashboard, key: 'overview' }, { label: 'Live operations', icon: MapPin, key: 'live' }, { label: 'Bookings', icon: ClipboardList, key: 'bookings' }, { label: 'Notifications', icon: Bell, key: 'notifications' }, { label: 'Reports', icon: FileText, key: 'reports' }, { label: 'Analytics', icon: BarChart3, key: 'analytics' }, { label: 'Vendors', icon: Users, key: 'vendors' }, { label: 'Tanker fleet', icon: Truck, key: 'fleet' }, { label: 'Drivers', icon: UserRound, key: 'drivers' }, { label: 'Customers', icon: Users, key: 'customers' }, { label: 'Onboard vendor', icon: UserPlus, key: 'onboarding' }, { label: 'Services', icon: Settings2, key: 'services' }, { label: 'Finance', icon: Wallet, key: 'finance' }, { label: 'Complaints', icon: Bell, key: 'complaints' }, { label: 'Alerts', icon: Bell, key: 'alerts' }, { label: 'Coupons', icon: Tag, key: 'coupons' }, { label: 'System health', icon: Settings2, key: 'system-health' }], metrics: [] },
  dispatcher: { caption: 'DISPATCH WORKSPACE', title: 'Dispatch', description: 'Coordinate live bookings and delivery assignments.', nav: [{ label: 'Dashboard', icon: LayoutDashboard, key: 'overview' }, { label: 'Live operations', icon: MapPin, key: 'live' }, { label: 'Bookings', icon: ClipboardList, key: 'bookings' }, { label: 'Reports', icon: FileText, key: 'reports' }, { label: 'Alerts', icon: Bell, key: 'alerts' }], metrics: [] },
}

export default function WorkspaceScreen() {
  const activeRole = useNavigationStore((state) => state.activeRole)
  const navigate = useNavigationStore((state) => state.navigate)
  useVendorOfflineSync(activeRole === 'vendor')
  const user = useAuthStore((state) => state.user)
  const signOut = useAuthStore((state) => state.signOut)
  const data = roleData[activeRole]
  const [activeItem, setActiveItem] = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [expandedAdminGroups, setExpandedAdminGroups] = useState<Set<string>>(() => new Set())
  const [notices, setNotices] = useState<Array<{ id: number; message: string }>>([])
  const displayName = user?.name ?? (activeRole === 'admin' ? 'Admin account' : activeRole === 'dispatcher' ? 'Dispatch account' : activeRole === 'vendor' ? 'Vendor account' : 'Customer account')
  const navigationGroups = activeRole === 'admin' ? adminNavGroups : activeRole === 'vendor' ? vendorNavGroups : dispatcherNavGroups
  const selectItem = useCallback((key: string) => { setActiveItem(key); const group = navigationGroups.find((item) => item.keys.includes(key)); if (group) setExpandedAdminGroups(new Set([group.label])); setNotices([]); setSidebarOpen(false) }, [navigationGroups])
  const addNotice = useCallback((message: string) => { const id = Date.now() + Math.random(); setNotices((current) => [...current.slice(-4), { id, message }]); window.setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), 5000) }, [])
  const navigateContent = useCallback((screen: 'booking' | 'bookings' | 'offers' | 'home') => screen === 'booking' ? navigate('booking') : screen === 'offers' ? selectItem('offers') : navigate('home'), [navigate, selectItem])
  const logout = () => { signOut(); navigate('home') }
  const renderNavItem = ({ label, icon: Icon, key }: NavItem) => <button className={activeItem === key ? 'is-active' : ''} aria-current={activeItem === key ? 'page' : undefined} key={key} onClick={() => selectItem(key)} title={sidebarCollapsed ? label : undefined}><Icon size={16} /><span>{label}</span></button>
  const renderNavGroups = (groups: typeof adminNavGroups) => <>
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
      <div className="sidebar-brand"><button className="brand" onClick={() => navigate('home')} aria-label="Urban Tanker home"><img className="brand-wordmark workspace-wordmark" src="/urban-tanker-wordmark-white.png" alt="Urban Tanker" /></button><button className="sidebar-collapse-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button><button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={17} /></button></div>
      <p className="workspace-caption-new">{data.caption}</p>
      <nav className="workspace-nav-new" aria-label={`${activeRole} workspace pages`}>
        {activeRole === 'admin' || activeRole === 'vendor' || activeRole === 'dispatcher'
          ? renderNavGroups(navigationGroups)
          : data.nav.map(renderNavItem)}
      </nav>
      <p className="workspace-caption-new sidebar-footer-label">URBAN TANKER</p>
    </aside>
    {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />}
    <main className="workspace-main-new">
      <header className="workspace-topbar-new">
        <button className="sidebar-open" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar"><Menu size={19} /></button>
        <span className="topbar-title">{activeItem === 'overview' ? data.title : data.nav.find((item) => item.key === activeItem)?.label}</span>
        <div className="topbar-identity">
          <button className="topbar-home" onClick={() => navigate('home')}>Home</button>
          <span className="workspace-avatar-new">{displayName.slice(0, 1)}</span><span className="topbar-person">{displayName}</span>
          <button className="button button-quiet topbar-logout" onClick={logout}><LogOut size={14} /> Log out</button>
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
