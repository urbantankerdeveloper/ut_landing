import { Activity, AlertTriangle, BriefcaseBusiness, CircleDollarSign, RefreshCw, Truck, Users } from 'lucide-react'
import { useAdminAvailabilityByArea, useAdminDashboardSummary } from '../hooks/useAdminData'

const orderStatuses = [
  ['pending_vendor', 'Awaiting assignment'],
  ['vendor_assigned', 'Vendor assigned'],
  ['accepted', 'Accepted'],
  ['en_route', 'En route'],
  ['arrived', 'Arrived'],
] as const

type Props = { areaAvailabilityEnabled: boolean }

export function AdminDashboardV2({ areaAvailabilityEnabled }: Props) {
  const summaryQuery = useAdminDashboardSummary()
  const areasQuery = useAdminAvailabilityByArea(areaAvailabilityEnabled)

  if (summaryQuery.isLoading) {
    return <section className="admin-view-panel" role="status"><p className="eyebrow">OPERATIONS DASHBOARD</p><h2>Loading today's operations…</h2></section>
  }
  if (summaryQuery.isError || !summaryQuery.data) {
    return <section className="admin-view-panel" role="alert"><p className="eyebrow">OPERATIONS DASHBOARD</p><h2>Dashboard data is unavailable.</h2><button className="button button-primary" type="button" onClick={() => void summaryQuery.refetch()}>Retry</button></section>
  }

  const summary = summaryQuery.data
  const metrics = [
    { label: "Today's revenue captured", value: `₹${(summary.todayRevenuePaise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`, note: 'Payments captured since midnight IST', icon: CircleDollarSign },
    { label: 'Pending partner applications', value: summary.pendingPartnerApplications, note: 'Submitted or under review', icon: BriefcaseBusiness },
    { label: 'Vendors online', value: summary.onlineVendors, note: 'Approved vendors marked online', icon: Users },
    { label: 'Drivers active', value: summary.activeDrivers, note: 'Approved drivers marked active', icon: Truck },
    { label: 'Open order alerts', value: summary.openOrderAlerts, note: 'Unresolved dispatcher alerts', icon: AlertTriangle },
    { label: 'Failed payments', value: summary.failedPayments, note: 'Payment records requiring attention', icon: CircleDollarSign },
    { label: 'Orders unchanged for 2+ hours', value: summary.stuckOrders, note: 'Active orders by last update time', icon: Activity },
  ]

  return <section className="admin-view-panel admin-dashboard-v2">
    <div className="view-panel-heading">
      <div><p className="eyebrow">ADMIN OVERVIEW</p><h2>Operations dashboard</h2></div>
      <button className="button button-quiet" type="button" onClick={() => { void summaryQuery.refetch(); if (areaAvailabilityEnabled) void areasQuery.refetch() }} disabled={summaryQuery.isFetching || areasQuery.isFetching}>
        <RefreshCw size={14} /> Refresh
      </button>
    </div>
    <div className="admin-summary-grid">
      {metrics.map(({ label, value, note, icon: Icon }) => <article key={label}>
        <span className="admin-dashboard-metric-icon"><Icon size={16} /></span>
        <small>{label}</small>
        <strong>{value}</strong>
        <span className="admin-dashboard-metric-note">{note}</span>
      </article>)}
    </div>
    <section className="admin-dashboard-statuses" aria-label="Active orders by status">
      <div className="admin-dashboard-section-heading"><h3>Active orders by status</h3><span>{Object.values(summary.activeOrdersByStatus).reduce((total, count) => total + count, 0)} active</span></div>
      <div className="admin-dashboard-status-grid">
        {orderStatuses.map(([status, label]) => <article key={status}><span>{label}</span><strong>{summary.activeOrdersByStatus[status] ?? 0}</strong></article>)}
      </div>
    </section>
    {areaAvailabilityEnabled && <section className="admin-dashboard-areas" aria-label="Availability by service area">
      <div className="admin-dashboard-section-heading"><h3>Availability by service area</h3><span>Area names use vendor service-zone entries</span></div>
      {areasQuery.isLoading ? <p role="status">Loading area availability…</p> : areasQuery.isError ? <div role="alert"><p>Area availability is unavailable.</p><button className="button button-quiet" type="button" onClick={() => void areasQuery.refetch()}>Retry</button></div> : areasQuery.data?.length ? <div className="admin-dashboard-area-table">
        <div className="admin-dashboard-area-row admin-dashboard-area-header"><span>Service area</span><span>Vendors online</span><span>Vehicles active</span><span>Drivers active</span></div>
        {areasQuery.data.map((area) => <div className="admin-dashboard-area-row" key={area.area}><strong>{area.area}</strong><span>{area.onlineVendors}</span><span>{area.activeVehicles}</span><span>{area.activeDrivers}</span></div>)}
      </div> : <p>No service-area availability is available yet.</p>}
    </section>}
    <p className="admin-dashboard-updated">Updated {new Date(summary.generatedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</p>
  </section>
}
