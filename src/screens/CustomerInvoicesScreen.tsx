import { Download, FileText, Receipt } from 'lucide-react'
import { customerDemoDataEnabled } from '../constants/demo'
import { downloadInvoicePdf, type InvoicePdf } from '../utils/pdf'
import { useCustomerInvoices } from '../hooks/useCustomerData'
import { normalizeInvoice } from '../utils/customerData'
import { customerContent as c } from '../content/customer'

const invoices: InvoicePdf[] = customerDemoDataEnabled ? [...c.invoices.demoInvoices] : []

export default function CustomerInvoicesScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const invoiceQuery = useCustomerInvoices()
  const invoiceList = customerDemoDataEnabled ? invoices : (invoiceQuery.data ?? []).map(normalizeInvoice)
  async function download(invoice: InvoicePdf) { try { const liveInvoice = !customerDemoDataEnabled && invoiceQuery.data?.find((item) => item.number === invoice.number && item.id)?.id ? await import('../api/customer').then(({ customerApi }) => customerApi.downloadInvoice(invoiceQuery.data?.find((item) => item.number === invoice.number)?.id as string)) : invoice; downloadInvoicePdf(normalizeInvoice(liveInvoice)); onNotice(c.invoices.downloaded(invoice.number)) } catch { onNotice(c.invoices.downloadFailed) } }
  if (!customerDemoDataEnabled && invoiceQuery.isLoading) return <section className="customer-invoices-screen"><div className="admin-empty-state" role="status">{c.invoices.loading}</div></section>
  if (!customerDemoDataEnabled && invoiceQuery.isError) return <section className="customer-invoices-screen"><div className="admin-empty-state" role="alert"><p>{c.invoices.unavailable}</p><button className="button button-primary" onClick={() => invoiceQuery.refetch()}>{c.invoices.retry}</button></div></section>
  return <section className="customer-invoices-screen"><div className="invoice-page-hero"><div><p className="eyebrow">{c.invoices.eyebrow}</p><h1>{c.invoices.title}</h1><p>{c.invoices.intro}</p></div><span className="invoice-hero-icon"><Receipt size={30} /></span></div><div className="invoice-summary"><div><small>{c.invoices.totalPaid}</small><strong>{invoiceList.length}</strong></div><div><small>{c.invoices.billingAccount}</small><strong>{invoiceList[0]?.customer ?? c.common.urbanTankerCustomer}</strong></div><div><small>{c.invoices.paymentStatus}</small><strong>{invoiceList.every((invoice) => invoice.status.toLowerCase() === 'paid') ? c.invoices.allSettled : c.invoices.reviewNeeded}</strong></div></div><section className="invoice-list-surface"><div className="invoice-list-heading"><div><p className="eyebrow">{c.invoices.historyEyebrow}</p><h2>{c.invoices.historyTitle}</h2></div><span>{c.invoices.records(invoiceList.length)}</span></div>{invoiceList.length ? <div className="invoice-card-list">{invoiceList.map((invoice) => <article className="invoice-card" key={invoice.number}><span className="invoice-card-icon"><FileText size={18} /></span><div><b>{invoice.number}</b><p>{c.invoices.serviceLocation(invoice.service, invoice.location)}</p><small>{c.invoices.dateStatus(invoice.date, invoice.status)}</small></div><strong>{c.common.inr(invoice.amount.toLocaleString('en-IN'))}</strong><button className="button button-quiet" onClick={() => download(invoice)}><Download size={14} /> {c.invoices.pdf}</button></article>)}</div> : <div className="admin-empty-state">{c.invoices.emptyState}</div>}</section></section>
}
