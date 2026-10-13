/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FormEvent } from 'react'
import { CircleDollarSign } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useRequestVendorPayout, useVendorPayouts } from '../hooks/useVendorData'

export function VendorPayoutPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const query = useVendorPayouts()
  const request = useRequestVendorPayout()
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const values = new FormData(event.currentTarget); const amount = Number(values.get('amount')); if (!Number.isFinite(amount) || amount <= 0) return; request.mutate({ amount, periodStart: String(values.get('periodStart') || '') || undefined, periodEnd: String(values.get('periodEnd') || '') || undefined }, { onSuccess: () => { event.currentTarget.reset(); onNotice('Payout request submitted.') }, onError: () => onNotice('Payout request could not be submitted.') }) }
  if (!demoDataEnabled && query.isLoading) return <section className="workspace-view-panel"><h2>Loading payouts...</h2></section>
  if (!demoDataEnabled && query.isError) return <section className="workspace-view-panel"><h2>Payouts are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>
  return <section className="workspace-view-panel vendor-management-panel"><div className="view-panel-heading"><div><p className="eyebrow">EARNINGS & PAYOUTS</p><h2>Request a vendor payout.</h2></div></div><form className="customer-inline-form" onSubmit={submit}><label>Amount<input name="amount" type="number" min="1" required placeholder="Amount in INR" /></label><label>Period start<input name="periodStart" type="date" /></label><label>Period end<input name="periodEnd" type="date" /></label><button className="button button-primary" disabled={request.isPending}><CircleDollarSign size={15} /> Request payout</button></form><div className="vendor-payout-list">{(query.data ?? []).map((payout: any) => <div key={payout.id}><span><b>INR {Number(payout.amount ?? 0).toLocaleString('en-IN')}</b><small>{payout.period_start ?? 'Current period'} - {payout.period_end ?? 'Today'}</small></span><em>{payout.status}</em></div>)}{!query.data?.length && <div className="admin-empty-state">No payout records found.</div>}</div></section>
}
