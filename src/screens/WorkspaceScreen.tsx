import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { BarChart3, Bell, CalendarCheck, CircleDollarSign, ClipboardList, FileText, Gauge, House, LayoutDashboard, LogOut, MapPin, Menu, PanelLeftClose, PanelLeftOpen, Receipt, Repeat, Settings2, Tag, Truck, UserRound, UserPlus, Users, Wallet, X } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import { useNavigationStore, type WorkspaceRole } from '../stores/navigationStore'
import { WorkspaceContentSkeleton } from '../components/ScreenSkeleton'
import { MIN_SCREEN_LOADING_MS } from '../constants/loading'
import { useVendorOfflineSync } from '../hooks/useVendorData'

const WorkspaceContent = lazy(() => import('./WorkspaceContent').then(({ WorkspaceContent: content }) => ({ default: content })))

type NavItem = { label: string; icon: typeof House; key: string }
type RoleData = { caption: string; title: string; description: string; nav: NavItem[]; metrics: { label: string; value: string; note: string; icon: typeof ClipboardList }[] }
const roleData: Record<WorkspaceRole, RoleData> = {
  customer: { caption: 'YOUR URBAN TANKER', title: 'My account', description: 'Keep your requests, deliveries and plans in one place.', nav: [{ label: 'My account', icon: House, key: 'overview' }, { label: 'My Bookings', icon: ClipboardList, key: 'bookings' }, { label: 'Live tracking', icon: MapPin, key: 'tracking' }, { label: 'Saved addresses', icon: MapPin, key: 'addresses' }, { label: 'My profile', icon: UserRound, key: 'profile' }, { label: 'Wallet & bills', icon: Wallet, key: 'wallet' }, { label: 'Invoices', icon: Receipt, key: 'invoices' }, { label: 'Notifications', icon: Bell, key: 'notifications' }, { label: 'Support', icon: Bell, key: 'support' }, { label: 'Yearly contracts', icon: Repeat, key: 'contracts' }], metrics: [] },
  vendor: { caption: 'VENDOR WORKSPACE', title: 'Overview', description: 'Turn nearby demand into reliable, trackable delivery.', nav: [{ label: 'Overview', icon: LayoutDashboard, key: 'overview' }, { label: 'Orders', icon: ClipboardList, key: 'orders' }, { label: 'My services', icon: Gauge, key: 'services' }, { label: 'My vehicles', icon: Truck, key: 'vehicles' }, { label: 'Drivers', icon: Users, key: 'drivers' }, { label: 'Documents', icon: FileText, key: 'documents' }, { label: 'Attendance', icon: CalendarCheck, key: 'attendance' }, { label: 'Earnings', icon: CircleDollarSign, key: 'earnings' }, { label: 'Complaints', icon: Bell, key: 'complaints' }, { label: 'Notifications', icon: Bell, key: 'notifications' }], metrics: [{ label: 'Available orders', value: '12 nearby', note: 'Within your service radius', icon: ClipboardList }, { label: 'Active delivery', value: '2 en route', note: 'Live status enabled', icon: Truck }, { label: 'This month', value: '₹84,600', note: '+12.4% from last month', icon: CircleDollarSign }] },
  admin: { caption: 'ADMIN WORKSPACE', title: 'Dashboard', description: 'Monitor demand, resolve exceptions and keep the network moving.', nav: [{ label: 'Dashboard', icon: LayoutDashboard, key: 'overview' }, { label: 'Live operations', icon: MapPin, key: 'live' }, { label: 'Bookings', icon: ClipboardList, key: 'bookings' }, { label: 'Notifications', icon: Bell, key: 'notifications' }, { label: 'Reports', icon: FileText, key: 'reports' }, { label: 'Analytics', icon: BarChart3, key: 'analytics' }, { label: 'Vendors', icon: Users, key: 'vendors' }, { label: 'Tanker fleet', icon: Truck, key: 'fleet' }, { label: 'Drivers', icon: UserRound, key: 'drivers' }, { label: 'Customers', icon: Users, key: 'customers' }, { label: 'Onboard vendor', icon: UserPlus, key: 'onboarding' }, { label: 'Services', icon: Settings2, key: 'services' }, { label: 'Finance', icon: Wallet, key: 'finance' }, { label: 'Complaints', icon: Bell, key: 'complaints' }, { label: 'Alerts', icon: Bell, key: 'alerts' }, { label: 'Coupons', icon: Tag, key: 'coupons' }, { label: 'System health', icon: Settings2, key: 'system-health' }], metrics: [{ label: 'Orders today', value: '148', note: '+18.2% vs yesterday', icon: ClipboardList }, { label: 'Live deliveries', value: '26', note: '4 need attention', icon: Truck }, { label: 'Gross collection', value: '₹4.82L', note: '98.6% reconciled', icon: CircleDollarSign }] },
  dispatcher: { caption: 'DISPATCH WORKSPACE', title: 'Dispatch', description: 'Coordinate live bookings and delivery assignments.', nav: [{ label: 'Dashboard', icon: LayoutDashboard, key: 'overview' }, { label: 'Live operations', icon: MapPin, key: 'live' }, { label: 'Bookings', icon: ClipboardList, key: 'bookings' }, { label: 'Reports', icon: FileText, key: 'reports' }, { label: 'Alerts', icon: Bell, key: 'alerts' }], metrics: [{ label: 'Open bookings', value: 'Live', note: 'Dispatch queue', icon: ClipboardList }, { label: 'Active deliveries', value: 'Live', note: 'Realtime status', icon: Truck }, { label: 'Alerts', value: 'Live', note: 'Needs attention', icon: Bell }] },
}

export default function WorkspaceScreen() {
  const { activeRole, navigate } = useNavigationStore()
  useVendorOfflineSync(activeRole === 'vendor')
  const user = useAuthStore((state) => state.user)
  const signOut = useAuthStore((state) => state.signOut)
  const data = roleData[activeRole]
  const [activeItem, setActiveItem] = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [contentLoading, setContentLoading] = useState(activeRole === 'vendor' || activeRole === 'admin' || activeRole === 'dispatcher')
  const loadingTimer = useRef<number | null>(null)
  const [notices, setNotices] = useState<Array<{ id: number; message: string }>>([])
  const displayName = user?.name ?? (activeRole === 'admin' ? 'Operations team' : activeRole === 'dispatcher' ? 'Dispatch team' : activeRole === 'vendor' ? 'BlueDrop Services' : 'Customer')
  const selectItem = (key: string) => { setActiveItem(key); setNotices([]); setSidebarOpen(false); const shouldLoadSkeleton = activeRole === 'vendor' || activeRole === 'admin' || activeRole === 'dispatcher'; setContentLoading(shouldLoadSkeleton); if (loadingTimer.current) window.clearTimeout(loadingTimer.current); if (shouldLoadSkeleton) loadingTimer.current = window.setTimeout(() => setContentLoading(false), MIN_SCREEN_LOADING_MS) }
  const addNotice = (message: string) => { const id = Date.now() + Math.random(); setNotices((current) => [...current.slice(-4), { id, message }]); window.setTimeout(() => setNotices((current) => current.filter((notice) => notice.id !== id)), 5000) }
  const logout = () => { signOut(); navigate('home') }
  useEffect(() => {
    const shouldLoadSkeleton = activeRole === 'vendor' || activeRole === 'admin' || activeRole === 'dispatcher'
    const timer = window.setTimeout(() => setContentLoading(false), shouldLoadSkeleton ? MIN_SCREEN_LOADING_MS : 0)
    return () => window.clearTimeout(timer)
  }, [activeRole])

  return <section className={`workspace-app workspace-app-${activeRole} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
    <aside className={`workspace-sidebar-new ${sidebarOpen ? 'is-open' : ''}`}>
      <div className="sidebar-brand"><button className="brand" onClick={() => navigate('home')} aria-label="Urban Tanker home"><span className="brand-mark">UT</span><span>Urban <b>Tanker</b></span></button><button className="sidebar-collapse-toggle" onClick={() => setSidebarCollapsed(!sidebarCollapsed)} aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button><button className="sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar"><X size={17} /></button></div>
      <p className="workspace-caption-new">{data.caption}</p>
      <nav className="workspace-nav-new" aria-label={`${activeRole} workspace pages`}>{data.nav.map(({ label, icon: Icon, key }) => <button className={activeItem === key ? 'is-active' : ''} aria-current={activeItem === key ? 'page' : undefined} key={key} onClick={() => selectItem(key)} title={sidebarCollapsed ? label : undefined}><Icon size={16} /><span>{label}</span></button>)}</nav>
      <p className="workspace-caption-new sidebar-footer-label">URBAN TANKER · DEMO</p>
    </aside>
    {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar" />}
    <main className="workspace-main-new">
      <header className="workspace-topbar-new">
        <button className="sidebar-open" onClick={() => setSidebarOpen(true)} aria-label="Open sidebar"><Menu size={19} /></button>
        <span className="topbar-title">{activeItem === 'overview' ? data.title : data.nav.find((item) => item.key === activeItem)?.label}</span>
        <div className="topbar-identity">
          {activeRole === 'customer' && <button className="button button-primary" onClick={() => navigate('booking')}>New booking</button>}
          <button className="topbar-home" onClick={() => navigate('home')}>Home</button>
          <span className="workspace-avatar-new">{displayName.slice(0, 1)}</span><span className="topbar-person">{displayName}</span>
          <button className="button button-quiet topbar-logout" onClick={logout}><LogOut size={14} /> Log out</button>
        </div>
      </header>
      <div className="workspace-content-new">
        {contentLoading ? <WorkspaceContentSkeleton /> : <>
          {activeItem === 'overview' && <><div className="workspace-heading-new"><div><p className="eyebrow">{data.caption}</p><h1>{data.description}</h1></div><span className="workspace-status-new"><i /> Operational</span></div><div className="workspace-metrics-new">{data.metrics.map(({ label, value, note, icon: Icon }) => <article key={label}><span className="metric-icon"><Icon size={18} /></span><small>{label}</small><strong>{value}</strong><span className="metric-note">{note}</span></article>)}</div></>}
          <Suspense fallback={<WorkspaceContentSkeleton />}><WorkspaceContent role={activeRole} item={activeItem} onNavigate={(screen) => screen === 'booking' ? navigate('booking') : screen === 'offers' ? selectItem('offers') : navigate('home')} onNotice={addNotice} /></Suspense>
          {notices.length > 0 && <div className="workspace-notice-stack" aria-live="polite">{notices.map((notice) => <p className="workspace-notice-global" role="status" key={notice.id}>{notice.message}</p>)}</div>}
        </>}
      </div>
    </main>
  </section>
}
