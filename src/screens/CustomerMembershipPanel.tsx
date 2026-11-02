import { Crown, ShieldCheck } from 'lucide-react'
import { customerDemoDataEnabled } from '../constants/demo'
import { useCustomerMembership, useMembershipPlans, useRequestMembership, useUpdateMembership } from '../hooks/useCustomerData'
import { customerContent as c } from '../content/customer'

type Props = { onNotice: (message: string) => void }
const demoPlans = c.membership.demoPlans.map((plan) => ({ ...plan, benefits: [...plan.benefits] }))

export function CustomerMembershipPanel({ onNotice }: Props) {
  const plansQuery = useMembershipPlans()
  const membershipQuery = useCustomerMembership()
  const request = useRequestMembership()
  const update = useUpdateMembership()
  const plans = customerDemoDataEnabled ? demoPlans : plansQuery.data ?? []
  const selectedPlan = membershipQuery.data?.plan_id
  function choose(planId: string) { if (customerDemoDataEnabled) { onNotice(c.membership.planSelectedNext); return }; request.mutate(planId, { onSuccess: () => onNotice(c.membership.submitted), onError: () => onNotice(c.membership.submitFailed) }) }
  function changeStatus() { const next = membershipQuery.data?.status === 'paused' ? 'active' : membershipQuery.data?.status === 'active' ? 'paused' : 'cancelled'; update.mutate(next, { onSuccess: () => onNotice(c.membership.statusUpdated), onError: () => onNotice(c.membership.statusFailed) }) }
  if (!customerDemoDataEnabled && plansQuery.isLoading) return <section className="workspace-view-panel customer-operation-panel" role="status"><h2>{c.membership.loading}</h2></section>
  if (!customerDemoDataEnabled && plansQuery.isError) return <section className="workspace-view-panel customer-operation-panel" role="alert"><h2>{c.membership.unavailable}</h2><button className="button button-primary" onClick={() => plansQuery.refetch()}>{c.common.retry}</button></section>
  return <section className="workspace-view-panel customer-operation-panel"><div className="membership-banner"><Crown size={26} /><div><p className="eyebrow">{c.membership.eyebrow}</p><h2>{c.membership.title}</h2><p>{c.membership.intro}</p></div></div>{membershipQuery.data && <div className="membership-status-bar"><span>{c.membership.currentStatus}<b>{membershipQuery.data.status}</b></span>{membershipQuery.data.status !== 'cancelled' && <button className="button button-quiet" disabled={update.isPending} onClick={changeStatus}>{membershipQuery.data.status === 'active' ? c.membership.pauseMembership : membershipQuery.data.status === 'paused' ? c.membership.resumeMembership : c.membership.cancelRequest}</button>}</div>}<div className="customer-card-grid membership-plan-grid">{plans.map((plan) => <article className={`customer-info-card membership-plan ${selectedPlan === plan.id ? 'is-selected' : ''}`} key={plan.id}><span><ShieldCheck size={18} /></span><b>{plan.name}</b><strong>{c.membership.planPrice(Number(plan.amount).toLocaleString('en-IN'), plan.billing_period)}</strong><p>{plan.description}</p><ul>{plan.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul><button className="button button-primary" disabled={request.isPending} onClick={() => choose(plan.id)}>{selectedPlan === plan.id ? c.membership.requested : c.membership.choosePlan}</button></article>)}</div>{!plans.length && <div className="admin-empty-state">{c.membership.noPlans}</div>}</section>
}
