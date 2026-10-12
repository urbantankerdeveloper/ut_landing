import { useState, type FormEvent } from 'react'
import { BarChart3, CheckCircle2, Download, FileText, RefreshCw, TrendingUp } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { downloadReportPdf } from '../utils/pdf'
import { downloadCsv } from '../utils/csv'

type ReportType = 'orders' | 'vendors' | 'revenue'
type ReportRow = { reference: string; label: string; category: string; status: string; amount: number; date: string }
type Props = { onNotice: (message: string) => void }
const reportRows: ReportRow[] = demoDataEnabled ? [
  { reference: 'UT-2412', label: 'Water tanker · 12 KL', category: 'Water', status: 'Awaiting vendor', amount: 2250, date: '2026-10-10' },
  { reference: 'UT-2411', label: 'Sewage tanker · 9 KL', category: 'Sewage', status: 'In progress', amount: 2900, date: '2026-10-09' },
  { reference: 'UT-2409', label: 'Tank cleaning', category: 'Cleaning', status: 'Delivered', amount: 2100, date: '2026-10-08' },
  { reference: 'UT-2404', label: 'Water tanker · 6 KL', category: 'Water', status: 'Delivered', amount: 1500, date: '2026-10-07' },
  { reference: 'UT-2398', label: 'Borewell inspection', category: 'Infrastructure', status: 'Delivered', amount: 4800, date: '2026-10-05' },
] : []
const trend = [{ label: '06 Oct', value: 54 }, { label: '07 Oct', value: 72 }, { label: '08 Oct', value: 61 }, { label: '09 Oct', value: 88 }, { label: '10 Oct', value: 76 }, { label: '11 Oct', value: 94 }, { label: '12 Oct', value: 82 }]

export default function AdminReportsScreen({ onNotice }: Props) {
  const [reportType, setReportType] = useState<ReportType>('orders')
  const [status, setStatus] = useState('all')
  const [category, setCategory] = useState('all')
  const [startDate, setStartDate] = useState('2026-10-01')
  const [endDate, setEndDate] = useState('2026-10-12')
  const [rows, setRows] = useState<ReportRow[]>(reportRows)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filteredRows = rows.filter((row) => (status === 'all' || row.status === status) && (category === 'all' || row.category === category) && row.date >= startDate && row.date <= endDate)
  const totalAmount = filteredRows.reduce((total, row) => total + row.amount, 0)
  const deliveredCount = filteredRows.filter((row) => row.status === 'Delivered').length
  const completionRate = filteredRows.length ? Math.round((deliveredCount / filteredRows.length) * 100) : 0

  function generateReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!startDate || !endDate || startDate > endDate) { setError('Choose a valid date range. The start date must be before the end date.'); return }
    setError(null)
    setRows([...reportRows])
    setGeneratedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    onNotice(`${reportType === 'orders' ? 'Orders' : reportType === 'vendors' ? 'Vendor performance' : 'Revenue'} report generated.`)
  }

  function exportCsv() {
    const headers = reportType === 'orders' ? ['Reference', 'Description', 'Service', 'Status', 'Amount', 'Date'] : reportType === 'vendors' ? ['Reference', 'Vendor', 'Service', 'Status', 'Amount', 'Date'] : ['Reference', 'Description', 'Category', 'Payment status', 'Amount', 'Date']
    const rows = filteredRows.map((row) => [row.reference, row.label, row.category, row.status, row.amount, row.date])
    downloadCsv(`urban-tanker-${reportType}-report-${endDate}.csv`, headers, rows)
    downloadReportPdf(reportType === 'orders' ? 'Orders report' : reportType === 'vendors' ? 'Vendor performance report' : 'Revenue reconciliation report', filteredRows, totalAmount)
    onNotice('CSV and PDF reports downloaded.')
  }

  return <section className="admin-reports-screen"><div className="reports-intro"><div><p className="eyebrow">REPORTS</p><h2>Operational intelligence for the team.</h2><p>Generate, inspect, and export platform reports without leaving the Admin workspace.</p></div><span className="reports-live"><i /> Data refreshed today</span></div><form className="report-filter-panel" onSubmit={generateReport}><div className="report-filter-grid"><label>Report type<select value={reportType} onChange={(event) => setReportType(event.target.value as ReportType)}><option value="orders">Orders by service</option><option value="vendors">Vendor performance</option><option value="revenue">Revenue reconciliation</option></select></label><label>From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label><label>To<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="Delivered">Delivered</option><option value="In progress">In progress</option><option value="Awaiting vendor">Awaiting vendor</option></select></label><label>Service<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All services</option><option value="Water">Water</option><option value="Sewage">Sewage</option><option value="Cleaning">Cleaning</option><option value="Infrastructure">Infrastructure</option></select></label></div>{error && <p className="report-error" role="alert">{error}</p>}<div className="report-filter-actions"><span>{generatedAt ? `Generated at ${generatedAt}` : 'Choose filters and generate a report'}</span><div><button className="button button-quiet" type="button" onClick={() => { setStatus('all'); setCategory('all'); setRows([...reportRows]); setError(null) }}><RefreshCw size={14} /> Reset</button><button className="button button-primary" type="submit"><BarChart3 size={15} /> Generate report</button></div></div></form><div className="report-kpi-grid"><ReportKpi icon={<FileText />} label="Records" value={String(filteredRows.length)} note="In selected period" /><ReportKpi icon={<TrendingUp />} label="Collection" value={`₹${totalAmount.toLocaleString('en-IN')}`} note="Gross reported value" /><ReportKpi icon={<CheckCircle2 />} label="Completion" value={`${completionRate}%`} note="Delivered records" /></div><div className="report-grid"><section className="report-surface"><div className="report-surface-heading"><div><p className="eyebrow">RESULTS</p><h3>{reportType === 'orders' ? 'Orders by service' : reportType === 'vendors' ? 'Vendor performance' : 'Revenue reconciliation'}</h3></div><button className="button button-quiet" type="button" onClick={exportCsv} disabled={!filteredRows.length}><Download size={14} /> Export CSV</button></div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>Reference</th><th>Description</th><th>Category</th><th>Status</th><th>Amount</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.reference}><td><b>{row.reference}</b><small>{row.date}</small></td><td>{row.label}</td><td>{row.category}</td><td><span className="status-tag">{row.status}</span></td><td>₹{row.amount.toLocaleString('en-IN')}</td></tr>)}</tbody></table>{!filteredRows.length && <div className="admin-empty-state">No records match the selected filters.</div>}</div></section><section className="report-surface report-trend"><p className="eyebrow">7-DAY ACTIVITY</p><h3>Reported volume</h3><div className="report-bars">{trend.map((point) => <div key={point.label}><span style={{ height: `${point.value}%` }} /><small>{point.label}</small></div>)}</div></section></div></section>
}
function ReportKpi({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) { return <article className="report-kpi"><span>{icon}</span><small>{label}</small><strong>{value}</strong><em>{note}</em></article> }
