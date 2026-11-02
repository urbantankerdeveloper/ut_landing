import { useState, type FormEvent } from 'react'
import { BarChart3, CheckCircle2, Download, FileText, RefreshCw, TrendingUp } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { downloadReportPdf } from '../utils/pdf'
import { downloadCsv } from '../utils/csv'
import { adminOperationsContent as c } from '../content/admin-operations'

type ReportType = 'orders' | 'vendors' | 'revenue'
type ReportRow = { reference: string; label: string; category: string; status: string; amount: number; date: string }
type Props = { onNotice: (message: string) => void }
const reportRows: ReportRow[] = demoDataEnabled ? [
  { reference: 'UT-2412', label: c.reports.demoLabels.waterTanker12Kl, category: 'Water', status: 'Awaiting vendor', amount: 2250, date: '2026-10-10' },
  { reference: 'UT-2411', label: c.reports.demoLabels.sewageTanker9Kl, category: 'Sewage', status: 'In progress', amount: 2900, date: '2026-10-09' },
  { reference: 'UT-2409', label: c.reports.demoLabels.tankCleaning, category: 'Cleaning', status: 'Delivered', amount: 2100, date: '2026-10-08' },
  { reference: 'UT-2404', label: c.reports.demoLabels.waterTanker6Kl, category: 'Water', status: 'Delivered', amount: 1500, date: '2026-10-07' },
  { reference: 'UT-2398', label: c.reports.demoLabels.borewellInspection, category: 'Infrastructure', status: 'Delivered', amount: 4800, date: '2026-10-05' },
] : []
const trend = [{ label: c.reports.trendLabels.oct06, value: 54 }, { label: c.reports.trendLabels.oct07, value: 72 }, { label: c.reports.trendLabels.oct08, value: 61 }, { label: c.reports.trendLabels.oct09, value: 88 }, { label: c.reports.trendLabels.oct10, value: 76 }, { label: c.reports.trendLabels.oct11, value: 94 }, { label: c.reports.trendLabels.oct12, value: 82 }]

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
    if (!startDate || !endDate || startDate > endDate) { setError(c.reports.invalidRange); return }
    setError(null)
    setRows([...reportRows])
    setGeneratedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    onNotice(c.reports.generatedNotice(c.reports.reportTypes[reportType].shortLabel))
  }

  function exportCsv() {
    const headers = [...c.reports.reportTypes[reportType].csvHeaders]
    const rows = filteredRows.map((row) => [row.reference, row.label, row.category, row.status, row.amount, row.date])
    downloadCsv(`urban-tanker-${reportType}-report-${endDate}.csv`, headers, rows)
    downloadReportPdf(c.reports.reportTypes[reportType].pdfTitle, filteredRows, totalAmount)
    onNotice(c.reports.downloadedNotice)
  }

  return <section className="admin-reports-screen"><div className="reports-intro"><div><p className="eyebrow">{c.reports.eyebrow}</p><h2>{c.reports.title}</h2><p>{c.reports.intro}</p></div><span className="reports-live"><i /> {c.reports.dataRefreshed}</span></div><form className="report-filter-panel" onSubmit={generateReport}><div className="report-filter-grid"><label>{c.reports.reportTypeLabel}<select value={reportType} onChange={(event) => setReportType(event.target.value as ReportType)}><option value="orders">{c.reports.reportTypes.orders.label}</option><option value="vendors">{c.reports.reportTypes.vendors.label}</option><option value="revenue">{c.reports.reportTypes.revenue.label}</option></select></label><label>{c.reports.from}<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label><label>{c.reports.to}<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label><label>{c.reports.status}<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{c.reports.statusOptions.all}</option><option value="Delivered">{c.reports.statusOptions.delivered}</option><option value="In progress">{c.reports.statusOptions.inProgress}</option><option value="Awaiting vendor">{c.reports.statusOptions.awaitingVendor}</option></select></label><label>{c.reports.service}<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">{c.reports.serviceOptions.all}</option><option value="Water">{c.reports.serviceOptions.water}</option><option value="Sewage">{c.reports.serviceOptions.sewage}</option><option value="Cleaning">{c.reports.serviceOptions.cleaning}</option><option value="Infrastructure">{c.reports.serviceOptions.infrastructure}</option></select></label></div>{error && <p className="report-error" role="alert">{error}</p>}<div className="report-filter-actions"><span>{generatedAt ? c.reports.generatedAt(generatedAt) : c.reports.chooseFilters}</span><div><button className="button button-quiet" type="button" onClick={() => { setStatus('all'); setCategory('all'); setRows([...reportRows]); setError(null) }}><RefreshCw size={14} /> {c.reports.reset}</button><button className="button button-primary" type="submit"><BarChart3 size={15} /> {c.reports.generate}</button></div></div></form><div className="report-kpi-grid"><ReportKpi icon={<FileText />} label={c.reports.kpi.records} value={String(filteredRows.length)} note={c.reports.kpi.recordsNote} /><ReportKpi icon={<TrendingUp />} label={c.reports.kpi.collection} value={c.common.currency(totalAmount.toLocaleString('en-IN'))} note={c.reports.kpi.collectionNote} /><ReportKpi icon={<CheckCircle2 />} label={c.reports.kpi.completion} value={c.reports.kpi.percent(completionRate)} note={c.reports.kpi.completionNote} /></div><div className="report-grid"><section className="report-surface"><div className="report-surface-heading"><div><p className="eyebrow">{c.reports.results}</p><h3>{c.reports.reportTypes[reportType].label}</h3></div><button className="button button-quiet" type="button" onClick={exportCsv} disabled={!filteredRows.length}><Download size={14} /> {c.reports.exportCsv}</button></div><div className="report-table-wrap"><table className="report-table"><thead><tr><th>{c.reports.tableHeaders.reference}</th><th>{c.reports.tableHeaders.description}</th><th>{c.reports.tableHeaders.category}</th><th>{c.reports.tableHeaders.status}</th><th>{c.reports.tableHeaders.amount}</th></tr></thead><tbody>{filteredRows.map((row) => <tr key={row.reference}><td><b>{row.reference}</b><small>{row.date}</small></td><td>{row.label}</td><td>{row.category}</td><td><span className="status-tag">{row.status}</span></td><td>{c.common.currency(row.amount.toLocaleString('en-IN'))}</td></tr>)}</tbody></table>{!filteredRows.length && <div className="admin-empty-state">{c.reports.noRecords}</div>}</div></section><section className="report-surface report-trend"><p className="eyebrow">{c.reports.trendEyebrow}</p><h3>{c.reports.trendTitle}</h3><div className="report-bars">{trend.map((point) => <div key={point.label}><span style={{ height: `${point.value}%` }} /><small>{point.label}</small></div>)}</div></section></div></section>
}
function ReportKpi({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) { return <article className="report-kpi"><span>{icon}</span><small>{label}</small><strong>{value}</strong><em>{note}</em></article> }
