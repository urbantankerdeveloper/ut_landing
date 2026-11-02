/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FormEvent } from 'react'
import { CircleDollarSign } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useRequestVendorPayout, useVendorPayouts } from '../hooks/useVendorData'
import { vendorContent as c } from '../content/vendor'

export function VendorPayoutPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const query = useVendorPayouts()
  const request = useRequestVendorPayout()
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const values = new FormData(event.currentTarget); const amount = Number(values.get('amount')); if (!Number.isFinite(amount) || amount <= 0) return; request.mutate({ amount, periodStart: String(values.get('periodStart') || '') || undefined, periodEnd: String(values.get('periodEnd') || '') || undefined }, { onSuccess: () => { event.currentTarget.reset(); onNotice(c.payouts.requested) }, onError: () => onNotice(c.payouts.requestFailed) }) }
  if (!demoDataEnabled && query.isLoading) return <section className="workspace-view-panel"><h2>{c.payouts.loading}</h2></section>
  if (!demoDataEnabled && query.isError) return <section className="workspace-view-panel"><h2>{c.payouts.unavailable}</h2><button className="button button-primary" onClick={() => query.refetch()}>{c.common.retry}</button></section>
  return <section className="workspace-view-panel vendor-management-panel"><div className="view-panel-heading"><div><p className="eyebrow">{c.payouts.eyebrow}</p><h2>{c.payouts.heading}</h2></div></div><form className="customer-inline-form" onSubmit={submit}><label>{c.payouts.amount}<input name="amount" type="number" min="1" required placeholder={c.payouts.amountPlaceholder} /></label><label>{c.payouts.periodStart}<input name="periodStart" type="date" /></label><label>{c.payouts.periodEnd}<input name="periodEnd" type="date" /></label><button className="button button-primary" disabled={request.isPending}><CircleDollarSign size={15} /> {c.payouts.requestPayout}</button></form><div className="vendor-payout-list">{(query.data ?? []).map((payout: any) => <div key={payout.id}><span><b>{c.common.inr(Number(payout.amount ?? 0).toLocaleString('en-IN'))}</b><small>{payout.period_start ?? c.payouts.currentPeriod}{c.payouts.periodSeparator}{payout.period_end ?? c.payouts.today}</small></span><em>{payout.status}</em></div>)}{!query.data?.length && <div className="admin-empty-state">{c.payouts.empty}</div>}</div></section>
}

