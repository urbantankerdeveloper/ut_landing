/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react'
import { CircleDollarSign, Gauge, Save, Truck, UserRound } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useVendorAttendance, useVendorDrivers, useVendorPayouts, useVendorServices, useVendorVehicles } from '../hooks/useVendorData'

type Mode = 'services' | 'earnings' | 'attendance'
type Props = { mode: Mode; onNotice: (message: string) => void }

export function VendorManagementPanel({ mode, onNotice }: Props) {
  const services = useVendorServices()
  const vehicles = useVendorVehicles()
  const drivers = useVendorDrivers()
  const payouts = useVendorPayouts()
  const attendance = useVendorAttendance()
  const [driverId, setDriverId] = useState('')
  const [attendanceStatus, setAttendanceStatus] = useState('present')
  const [attendanceDate, setAttendanceDate] = useState(new Date().toISOString().slice(0, 10))
  if (!demoDataEnabled && mode === 'services' && services.isLoading) return <Loading label="services" />
  if (!demoDataEnabled && mode === 'earnings' && payouts.isLoading) return <Loading label="earnings" />
  if (!demoDataEnabled && mode === 'attendance' && drivers.isLoading) return <Loading label="drivers" />
  if (!demoDataEnabled && (services.isError || payouts.isError || drivers.isError || vehicles.isError)) return <Retry onRetry={() => { void services.refetch(); void payouts.refetch(); void drivers.refetch(); void vehicles.refetch() }} />
  if (mode === 'services') return <section className="workspace-view-panel vendor-management-panel"><PanelHeading eyebrow="MY SERVICES" title="Live service catalogue." /><div className="vendor-service-list">{(services.data ?? []).map((service: any) => <article key={service.id ?? service.code}><span><Gauge size={18} /></span><div><b>{service.name}</b><p>{service.description ?? service.code}</p></div><strong>INR {(Number(service.base_price_paise ?? 0) / 100).toLocaleString('en-IN')}</strong></article>)}{!services.data?.length && <Empty label="No active services found." />}</div></section>
  if (mode === 'earnings') return <section className="workspace-view-panel vendor-management-panel"><PanelHeading eyebrow="EARNINGS & PAYOUTS" title="Live payout records." /><div className="vendor-earning-metrics"><article><CircleDollarSign size={20} /><small>Completed payouts</small><strong>{payouts.data?.length ?? 0}</strong></article><article><Truck size={20} /><small>Fleet vehicles</small><strong>{vehicles.data?.length ?? 0}</strong></article><article><UserRound size={20} /><small>Drivers</small><strong>{drivers.data?.length ?? 0}</strong></article></div><div className="vendor-payout-list">{(payouts.data ?? []).map((payout: any) => <div key={payout.id}><span><b>INR {Number(payout.amount ?? 0).toLocaleString('en-IN')}</b><small>{payout.period_start} - {payout.period_end}</small></span><em>{payout.status}</em></div>)}{!payouts.data?.length && <Empty label="No payouts found." />}</div></section>
  return <section className="workspace-view-panel vendor-management-panel"><PanelHeading eyebrow="ATTENDANCE" title="Record driver availability." /><form className="attendance-form" onSubmit={(event) => { event.preventDefault(); attendance.mutate({ driverId, status: attendanceStatus, date: attendanceDate }, { onSuccess: () => onNotice('Attendance saved.'), onError: () => onNotice('Attendance could not be saved.') }) }}><label>Driver<select value={driverId} onChange={(event) => setDriverId(event.target.value)} required><option value="" disabled>Select driver</option>{(drivers.data ?? []).map((driver: any) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select></label><label>Status<select value={attendanceStatus} onChange={(event) => setAttendanceStatus(event.target.value)}><option value="present">Present</option><option value="absent">Absent</option><option value="on_leave">On leave</option></select></label><label>Date<input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)} required /></label><button className="button button-primary" disabled={attendance.isPending}><Save size={15} /> Save attendance</button></form></section>
}
function PanelHeading({ eyebrow, title }: { eyebrow: string; title: string }) { return <div className="view-panel-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div></div> }
function Loading({ label }: { label: string }) { return <section className="workspace-view-panel"><h2>Loading {label}...</h2></section> }
function Retry({ onRetry }: { onRetry: () => void }) { return <section className="workspace-view-panel"><h2>Vendor data is unavailable.</h2><button className="button button-primary" onClick={onRetry}>Retry</button></section> }
function Empty({ label }: { label: string }) { return <div className="admin-empty-state">{label}</div> }
