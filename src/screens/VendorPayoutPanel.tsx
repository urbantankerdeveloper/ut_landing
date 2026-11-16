/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FormEvent } from 'react'
import { CircleDollarSign } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useRequestVendorPayout, useVendorAccruedEarnings, useVendorPayouts } from '../hooks/useVendorData'
import { vendorContent as c } from '../content/vendor'
import { useFeatureFlags } from '../hooks/useFeatureFlags'

export function VendorPayoutPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const query = useVendorPayouts()
  const request = useRequestVendorPayout()
  const featureFlags = useFeatureFlags()
  const earningsEnabled = featureFlags.data?.vendor_earnings_realtime_enabled === true
  const accrued = useVendorAccruedEarnings(earningsEnabled)
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const values = new FormData(event.currentTarget); const amount = Number(values.get('amount')); if (!Number.isFinite(amount) || amount <= 0) return; request.mutate({ amount, periodStart: String(values.get('periodStart') || '') || undefined, periodEnd: String(values.get('periodEnd') || '') || undefined }, { onSuccess: () => { event.currentTarget.reset(); onNotice(c.payouts.requested) }, onError: () => onNotice(c.payouts.requestFailed) }) }
  if (!demoDataEnabled && query.isLoading) return <section className="workspace-view-panel" role="status"><h2>{c.payouts.loading}</h2></section>
  if (!demoDataEnabled && query.isError) return <section className="workspace-view-panel" role="alert"><h2>{c.payouts.unavailable}</h2><button className="button button-primary" onClick={() => query.refetch()}>{c.common.retry}</button></section>
  return <section className="workspace-view-panel vendor-management-panel"><div className="view-panel-heading"><div><p className="eyebrow">{c.payouts.eyebrow}</p><h2>{c.payouts.heading}</h2></div></div>{earningsEnabled && <section aria-label={c.payouts.accruedTitle}><h3>{c.payouts.accruedTitle}</h3>{accrued.isLoading && <p role="status">{c.payouts.accruedLoading}</p>}{accrued.isError && <p role="alert">{c.payouts.accruedUnavailable} <button type="button" className="button button-quiet" onClick={() => void accrued.refetch()}>{c.common.retry}</button></p>}{accrued.data && <><p><strong>{c.common.inr((accrued.data.totalAmountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }))}</strong> · {accrued.data.totalCount} delivered {accrued.data.totalCount === 1 ? 'order' : 'orders'}</p><p>{c.payouts.accruedNote}</p>{accrued.data.rows.length > 0 && <div className="vendor-payout-list">{accrued.data.rows.map((row) => <div key={row.id}><span><b>{row.reference} · {row.serviceCode.replace(/_/g, ' ')}</b><small>{c.payouts.deliveredAt}: {new Date(row.deliveredAt).toLocaleDateString()}</small></span><strong>{c.common.inr((row.amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 }))}</strong></div>)}</div>}{accrued.data.totalCount === 0 && <p>{c.payouts.accruedEmpty}</p>}</>}</section>}<form className="customer-inline-form" onSubmit={submit}><label>{c.payouts.amount}<input name="amount" type="number" min="1" required placeholder={c.payouts.amountPlaceholder} /></label><label>{c.payouts.periodStart}<input name="periodStart" type="date" /></label><label>{c.payouts.periodEnd}<input name="periodEnd" type="date" /></label><button className="button button-primary" disabled={request.isPending}><CircleDollarSign size={15} /> {c.payouts.requestPayout}</button></form><div className="vendor-payout-list">{(query.data ?? []).map((payout: any) => <div key={payout.id}><span><b>{c.common.inr(Number(payout.amount ?? 0).toLocaleString('en-IN'))}</b><small>{payout.period_start ?? c.payouts.currentPeriod}{c.payouts.periodSeparator}{payout.period_end ?? c.payouts.today}</small></span><em>{payout.status}</em></div>)}{!query.data?.length && <div className="admin-empty-state">{c.payouts.empty}</div>}</div></section>
}

