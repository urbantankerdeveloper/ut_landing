import { useState } from 'react'
import { BarChart3, Download, FileSpreadsheet, FileText, RefreshCw } from 'lucide-react'
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

export default function AdminReportsLiveScreen({ onNotice }: Props) {
  const generate = useGenerateAdminReport()
  const [type, setType] = useState<ReportType>('orders')
  const [customerType, setCustomerType] = useState<CustomerTypeFilter>('')
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10))
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<ReportRow[]>([])
  const [total, setTotal] = useState(0)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    generate.mutate(
      { type, from, to, ...(customerType ? { customerType } : {}) },
      {
        onSuccess: (result) => {
          setRows(result.rows as ReportRow[])
          setTotal(result.total)
          onNotice(c.reportsLive.notices.generated)
        },
        onError: () => onNotice(c.reportsLive.notices.generateFailed),
      },
    )
  }

  function exportReport() {
    if (type === 'vendors') {
      downloadCsv(
        `urban-tanker-vendors-report-${to}.csv`,
        [...c.reportsLive.vendorCsvHeaders],
        rows.map((row) => [
          row.business_name ?? 'Vendor name unavailable',
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
          row.reference ?? 'Booking reference unavailable',
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
          row.business_name ?? 'Vendor name unavailable',
          row.booking_count ?? 0,
          row.completed_count ?? 0,
          Number(row.quoted_amount_paise ?? 0) / 100,
        ])
        : rows.map((row) => [
          row.reference ?? 'Booking reference unavailable',
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
            ? row.business_name ?? 'Vendor name unavailable'
            : row.reference ?? 'Booking reference unavailable',
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

  return (
    <section className="admin-reports-screen">
      <div className="reports-intro">
        <div>
          <p className="eyebrow">{c.reportsLive.eyebrow}</p>
          <h2>{c.reportsLive.title}</h2>
          <p>{c.reportsLive.intro}</p>
        </div>
        <span className="reports-live"><i /> {c.reportsLive.apiConnected}</span>
      </div>

      <form className="report-filter-panel" onSubmit={submit}>
        <div className="report-filter-grid">
          <label>
            {c.reportsLive.reportTypeLabel}
            <select value={type} onChange={(event) => setType(event.target.value as ReportType)}>
              <option value="orders">{c.reportsLive.typeOptions.orders}</option>
              <option value="vendors">{c.reportsLive.typeOptions.vendors}</option>
              <option value="revenue">{c.reportsLive.typeOptions.revenue}</option>
            </select>
          </label>
          <label>
            {c.reportsLive.customer}
            <select value={customerType} onChange={(event) => setCustomerType(event.target.value as CustomerTypeFilter)}>
              <option value="">{c.reportsLive.customerOptions.all}</option>
              <option value="registered">{c.reportsLive.customerOptions.registered}</option>
              <option value="guest">{c.reportsLive.customerOptions.guest}</option>
            </select>
          </label>
          <label>{c.reportsLive.from}<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></label>
          <label>{c.reportsLive.to}<input type="date" value={to} onChange={(event) => setTo(event.target.value)} required /></label>
        </div>
        <div className="report-filter-actions">
          <span>{rows.length ? c.reportsLive.summary(rows.length, total.toLocaleString('en-IN')) : c.reportsLive.chooseRange}</span>
          <div>
            <button className="button button-quiet" type="button" onClick={() => { setRows([]); setTotal(0) }}>
              <RefreshCw size={14} /> {c.reportsLive.reset}
            </button>
            <button className="button button-primary" type="submit" disabled={generate.isPending}>
              {generate.isPending ? c.reportsLive.generating : c.reportsLive.generate} <BarChart3 size={14} />
            </button>
          </div>
        </div>
      </form>

      <section className="report-surface">
        <div className="report-surface-heading">
          <div>
            <p className="eyebrow">{c.reportsLive.results}</p>
            <h3>{c.reportsLive.resultsTitle}</h3>
          </div>
          <div className="report-export-actions">
            <button className="button button-quiet" type="button" disabled={!rows.length} onClick={exportReport}>
              <Download size={14} /> {c.reportsLive.exportCsv}
            </button>
            <button className="button button-quiet" type="button" disabled={!rows.length || exportingExcel} onClick={() => { void exportExcel() }} aria-busy={exportingExcel}>
              <FileSpreadsheet size={14} /> {exportingExcel ? c.reportsLive.exportingExcel : c.reportsLive.exportExcel}
            </button>
            <button className="button button-quiet" type="button" disabled={!rows.length || exportingPdf} onClick={() => { void exportPdf() }} aria-busy={exportingPdf}>
              <FileText size={14} /> {exportingPdf ? c.reportsLive.exportingPdf : c.reportsLive.exportPdf}
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
                      <td>{row.business_name ?? 'Vendor name unavailable'}</td>
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
                      <td>{row.reference ?? 'Booking reference unavailable'}</td>
                      <td>{row.customer_type === 'guest' ? c.reportsLive.customerTypes.guest : c.reportsLive.customerTypes.registered}</td>
                      <td>{row.service_code}</td>
                      <td>{row.status}</td>
                      <td>{row.address_text}</td>
                      <td>{c.reportsLive.inr((Number(row.quoted_amount_paise ?? 0) / 100).toLocaleString('en-IN'))}</td>
                    </tr>
                  ))}</tbody>
                </>
              )}
            </table>
          </div>
        ) : <div className="admin-empty-state">{c.reportsLive.noReport}</div>}
      </section>
    </section>
  )
}
