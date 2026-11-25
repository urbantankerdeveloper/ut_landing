import { useState, type FormEvent, type ReactNode } from 'react'
import { BarChart3, CheckCircle2, Download, FileSpreadsheet, FileText, PackageCheck, RefreshCw, Rows3, TrendingUp } from 'lucide-react'
import { useGenerateAdminReport } from '../hooks/useAdminData'
import { downloadCsv } from '../utils/csv'
import { adminOperationsContent as c } from '../content/admin-operations'

type Props = { onNotice: (message: string) => void }
type ReportType = 'orders' | 'vendors' | 'revenue'
type CustomerTypeFilter = '' | 'registered' | 'guest'
type ReportRow = {
  id?: string
  reference?: string
  service_code?: string
  status?: string
  address_text?: string
  quoted_amount_paise?: number
  customer_type?: string
  created_at?: string
  vendor_id?: string
  business_name?: string
  booking_count?: number
  completed_count?: number
}

function defaultDateRange() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(end.getDate() - 30)
  const toInputValue = (date: Date) => {
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${date.getFullYear()}-${month}-${day}`
  }
  return { from: toInputValue(start), to: toInputValue(end) }
}

function ReportMetric({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
  return (
    <article className="report-metric">
      <span className="report-metric-icon">{icon}</span>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
        <small>{note}</small>
      </div>
    </article>
  )
}

export default function AdminReportsLiveScreen({ onNotice }: Props) {
  const generate = useGenerateAdminReport()
  const [type, setType] = useState<ReportType>('orders')
  const [customerType, setCustomerType] = useState<CustomerTypeFilter>('')
  const [dateRange, setDateRange] = useState(defaultDateRange)
  const [rows, setRows] = useState<ReportRow[]>([])
  const [total, setTotal] = useState(0)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [hasGenerated, setHasGenerated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestFailed, setRequestFailed] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const { from, to } = dateRange

  const bookingCount = type === 'vendors'
    ? rows.reduce((count, row) => count + Number(row.booking_count ?? 0), 0)
    : rows.length
  const completedCount = type === 'vendors'
    ? rows.reduce((count, row) => count + Number(row.completed_count ?? 0), 0)
    : rows.filter((row) => row.status?.toLowerCase() === 'delivered').length
  const completionRate = bookingCount ? Math.round((completedCount / bookingCount) * 100) : 0

  function clearReport() {
    setRows([])
    setTotal(0)
    setGeneratedAt(null)
    setHasGenerated(false)
    setError(null)
    setRequestFailed(false)
  }

  function resetFilters() {
    setType('orders')
    setCustomerType('')
    setDateRange(defaultDateRange())
    clearReport()
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!from || !to || from > to) {
      setRequestFailed(false)
      setError(c.reportsLive.invalidRange)
      return
    }
    setError(null)
    setRequestFailed(false)
    generate.mutate(
      { type, from, to, ...(customerType ? { customerType } : {}) },
      {
        onSuccess: (result) => {
          setRows(result.rows as ReportRow[])
          setTotal(result.total)
          setGeneratedAt(result.generatedAt)
          setHasGenerated(true)
          setRequestFailed(false)
          onNotice(c.reportsLive.notices.generated)
        },
        onError: (requestError) => {
          setError(requestError instanceof Error ? requestError.message : c.common.apiRequestFailed)
          setRequestFailed(true)
          onNotice(c.reportsLive.notices.generateFailed)
        },
      },
    )
  }

  function exportReport() {
    if (type === 'vendors') {
      downloadCsv(
        `urban-tanker-vendors-report-${to}.csv`,
        [...c.reportsLive.vendorCsvHeaders],
        rows.map((row) => [
          row.business_name ?? c.reportsLive.vendorNameUnavailable,
          row.booking_count ?? 0,
          row.completed_count ?? 0,
          (Number(row.quoted_amount_paise ?? 0) / 100).toFixed(2),
        ]),
      )
    } else {
      downloadCsv(
        `urban-tanker-${type}-report-${to}.csv`,
        [...c.reportsLive.csvHeaders],
        rows.map((row) => [
          row.reference ?? c.reportsLive.referenceUnavailable,
          row.customer_type ?? '',
          row.service_code ?? '',
          row.status ?? '',
          row.address_text ?? '',
          (Number(row.quoted_amount_paise ?? 0) / 100).toFixed(2),
          row.created_at ?? '',
        ]),
      )
    }
    onNotice(c.reportsLive.notices.exported)
  }

  async function exportExcel() {
    setExportingExcel(true)
    try {
      const vendorReport = type === 'vendors'
      const headers = vendorReport ? [...c.reportsLive.vendorCsvHeaders] : [...c.reportsLive.csvHeaders]
      const exportRows = vendorReport
        ? rows.map((row) => [
          row.business_name ?? c.reportsLive.vendorNameUnavailable,
          row.booking_count ?? 0,
          row.completed_count ?? 0,
          Number(row.quoted_amount_paise ?? 0) / 100,
        ])
        : rows.map((row) => [
          row.reference ?? c.reportsLive.referenceUnavailable,
          row.customer_type ?? '',
          row.service_code ?? '',
          row.status ?? '',
          row.address_text ?? '',
          Number(row.quoted_amount_paise ?? 0) / 100,
          row.created_at ?? '',
        ])
      const { reportsLive } = c
      if (import.meta.env.VITE_ADMIN_EXPORT_LIGHT === 'true') {
        const { downloadCsv } = await import('../utils/csv')
        downloadCsv(`urban-tanker-${type}-report-${to}.csv`, headers, exportRows)
      } else {
        const { downloadXlsx } = await import('../utils/xlsx')
        await downloadXlsx(
          `urban-tanker-${type}-report-${to}.xlsx`,
          `${reportsLive.typeOptions[type]} report`,
          `${reportsLive.from}: ${from} ${reportsLive.to.toLowerCase()}: ${to}`,
          headers,
          exportRows,
          vendorReport ? 4 : 6,
        )
      }
      onNotice(reportsLive.notices.exported)
    } catch {
      onNotice(c.reportsLive.notices.excelExportFailed)
    } finally {
      setExportingExcel(false)
    }
  }

  async function exportPdf() {
    setExportingPdf(true)
    try {
      const { downloadReportPdf } = await import('../utils/pdf')
      downloadReportPdf(
        `${c.reportsLive.typeOptions[type]} report`,
        rows.map((row) => ({
          reference: type === 'vendors'
            ? row.business_name ?? c.reportsLive.vendorNameUnavailable
            : row.reference ?? c.reportsLive.referenceUnavailable,
          label: type === 'vendors'
            ? `${row.booking_count ?? 0} bookings; ${row.completed_count ?? 0} completed`
            : row.service_code ?? '',
          category: type === 'vendors' ? 'Vendor' : row.customer_type ?? '',
          status: type === 'vendors' ? 'Vendor activity' : row.status ?? '',
          amount: Number(row.quoted_amount_paise ?? 0) / 100,
          date: row.created_at?.slice(0, 10) ?? '',
        })),
        total,
      )
      onNotice(c.reportsLive.notices.exported)
    } catch {
      onNotice(c.reportsLive.notices.exportFailed)
    } finally {
      setExportingPdf(false)
    }
  }

  const generatedLabel = generatedAt
    ? c.reportsLive.generatedAt(new Date(generatedAt).toLocaleString())
    : generate.isPending
      ? c.reportsLive.generating
      : c.reportsLive.chooseRange

  return (
    <section className="admin-reports-screen">
      <header className="reports-intro">
        <div>
          <p className="eyebrow">{c.reportsLive.eyebrow}</p>
          <h2>{c.reportsLive.title}</h2>
          <p>{c.reportsLive.intro}</p>
        </div>
        <span className={`reports-live${generate.isPending ? ' is-loading' : ''}${requestFailed ? ' is-error' : ''}${error && !requestFailed ? ' is-warning' : ''}`}>
          <i /> {generate.isPending ? c.reportsLive.generating : requestFailed ? c.reportsLive.reportUnavailable : error ? c.reportsLive.reviewFilters : hasGenerated ? c.reportsLive.reportReady : c.reportsLive.readyToGenerate}
        </span>
      </header>

      <form className="report-filter-panel" onSubmit={submit}>
        <div className="report-panel-heading">
          <div>
            <p className="eyebrow">{c.reportsLive.configurationEyebrow}</p>
            <h3>{c.reportsLive.configurationTitle}</h3>
          </div>
          <p>{c.reportsLive.configurationHint}</p>
        </div>
        <div className="report-filter-grid">
          <label>
            <span>{c.reportsLive.reportTypeLabel}</span>
            <select value={type} onChange={(event) => { setType(event.target.value as ReportType); clearReport() }} disabled={generate.isPending}>
              <option value="orders">{c.reportsLive.typeOptions.orders}</option>
              <option value="vendors">{c.reportsLive.typeOptions.vendors}</option>
              <option value="revenue">{c.reportsLive.typeOptions.revenue}</option>
            </select>
          </label>
          <label>
            <span>{c.reportsLive.customer}</span>
            <select value={customerType} onChange={(event) => { setCustomerType(event.target.value as CustomerTypeFilter); clearReport() }} disabled={generate.isPending}>
              <option value="">{c.reportsLive.customerOptions.all}</option>
              <option value="registered">{c.reportsLive.customerOptions.registered}</option>
              <option value="guest">{c.reportsLive.customerOptions.guest}</option>
            </select>
          </label>
          <label>
            <span>{c.reportsLive.from}</span>
            <input type="date" value={from} max={to} onChange={(event) => { setDateRange((range) => ({ ...range, from: event.target.value })); clearReport() }} required disabled={generate.isPending} />
          </label>
          <label>
            <span>{c.reportsLive.to}</span>
            <input type="date" value={to} min={from} onChange={(event) => { setDateRange((range) => ({ ...range, to: event.target.value })); clearReport() }} required disabled={generate.isPending} />
          </label>
        </div>
        {error && <p className="report-error" role="alert">{error}</p>}
        <div className="report-filter-actions">
          <span>{generatedLabel}</span>
          <div>
            <button className="button button-quiet" type="button" onClick={resetFilters} disabled={generate.isPending}>
              <RefreshCw size={15} /> {c.reportsLive.reset}
            </button>
            <button className="button button-primary" type="submit" disabled={generate.isPending}>
              {generate.isPending ? c.reportsLive.generating : c.reportsLive.generate} <BarChart3 size={15} />
            </button>
          </div>
        </div>
      </form>

      {hasGenerated && (
        <div className="report-metric-grid" aria-label={c.reportsLive.summaryMetrics}>
          <ReportMetric icon={<Rows3 size={19} />} label={c.reportsLive.metrics.records} value={rows.length.toLocaleString('en-IN')} note={c.reportsLive.metrics.recordsNote} />
          <ReportMetric icon={<PackageCheck size={19} />} label={c.reportsLive.metrics.bookings} value={bookingCount.toLocaleString('en-IN')} note={c.reportsLive.metrics.bookingsNote} />
          <ReportMetric icon={<CheckCircle2 size={19} />} label={c.reportsLive.metrics.completion} value={`${completionRate}%`} note={c.reportsLive.metrics.completionNote(completedCount)} />
          <ReportMetric icon={<TrendingUp size={19} />} label={c.reportsLive.metrics.value} value={c.reportsLive.inr(total.toLocaleString('en-IN'))} note={c.reportsLive.metrics.valueNote} />
        </div>
      )}

      <section className="report-surface">
        <div className="report-surface-heading">
          <div>
            <p className="eyebrow">{c.reportsLive.results}</p>
            <h3>{c.reportsLive.typeOptions[type]}</h3>
            {hasGenerated && <p className="report-result-meta">{c.reportsLive.summary(rows.length, total.toLocaleString('en-IN'))}</p>}
          </div>
          <div className="report-export-actions">
            <button className="button button-quiet" type="button" disabled={!hasGenerated || !rows.length} onClick={exportReport}>
              <Download size={15} /> {c.reportsLive.exportCsv}
            </button>
            <button className="button button-quiet" type="button" disabled={!hasGenerated || !rows.length || exportingExcel} onClick={() => { void exportExcel() }} aria-busy={exportingExcel}>
              <FileSpreadsheet size={15} /> {exportingExcel ? c.reportsLive.exportingExcel : c.reportsLive.exportExcel}
            </button>
            <button className="button button-quiet" type="button" disabled={!hasGenerated || !rows.length || exportingPdf} onClick={() => { void exportPdf() }} aria-busy={exportingPdf}>
              <FileText size={15} /> {exportingPdf ? c.reportsLive.exportingPdf : c.reportsLive.exportPdf}
            </button>
          </div>
        </div>
        {rows.length ? (
          <div className="report-table-wrap">
            <table className="report-table">
              {type === 'vendors' ? (
                <>
                  <thead><tr>
                    <th scope="col">{c.reportsLive.vendorTableHeaders.vendor}</th>
                    <th scope="col">{c.reportsLive.vendorTableHeaders.orders}</th>
                    <th scope="col">{c.reportsLive.vendorTableHeaders.completed}</th>
                    <th scope="col">{c.reportsLive.vendorTableHeaders.quotedValue}</th>
                  </tr></thead>
                  <tbody>{rows.map((row, index) => (
                    <tr key={row.vendor_id ?? index}>
                      <td><strong>{row.business_name ?? c.reportsLive.vendorNameUnavailable}</strong></td>
                      <td>{row.booking_count ?? 0}</td>
                      <td>{row.completed_count ?? 0}</td>
                      <td>{c.reportsLive.inr((Number(row.quoted_amount_paise ?? 0) / 100).toLocaleString('en-IN'))}</td>
                    </tr>
                  ))}</tbody>
                </>
              ) : (
                <>
                  <thead><tr>
                    <th scope="col">{c.reportsLive.tableHeaders.reference}</th>
                    <th scope="col">{c.reportsLive.tableHeaders.customer}</th>
                    <th scope="col">{c.reportsLive.tableHeaders.service}</th>
                    <th scope="col">{c.reportsLive.tableHeaders.status}</th>
                    <th scope="col">{c.reportsLive.tableHeaders.location}</th>
                    <th scope="col">{c.reportsLive.tableHeaders.amount}</th>
                  </tr></thead>
                  <tbody>{rows.map((row, index) => (
                    <tr key={row.id ?? row.reference ?? index}>
                      <td><strong>{row.reference ?? c.reportsLive.referenceUnavailable}</strong><small>{row.created_at?.slice(0, 10) ?? ''}</small></td>
                      <td>{row.customer_type === 'guest' ? c.reportsLive.customerTypes.guest : c.reportsLive.customerTypes.registered}</td>
                      <td>{row.service_code ?? c.common.notProvided}</td>
                      <td><span className="report-status">{row.status ?? c.common.notProvided}</span></td>
                      <td className="report-location">{row.address_text ?? c.common.notProvided}</td>
                      <td>{c.reportsLive.inr((Number(row.quoted_amount_paise ?? 0) / 100).toLocaleString('en-IN'))}</td>
                    </tr>
                  ))}</tbody>
                </>
              )}
            </table>
          </div>
        ) : (
          <div className="report-empty-state">
            <span><BarChart3 size={24} /></span>
            <h4>{hasGenerated ? c.reportsLive.emptyTitle : c.reportsLive.noReport}</h4>
            <p>{hasGenerated ? c.reportsLive.emptyHint : c.reportsLive.noReportHint}</p>
          </div>
        )}
      </section>
    </section>
  )
}
