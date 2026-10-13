import { Crown, ShieldCheck } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useCustomerMembership, useMembershipPlans, useRequestMembership } from '../hooks/useCustomerData'

type Props = { onNotice: (message: string) => void }
const demoPlans = [{ id: 'care', name: 'Care', description: 'Priority support and member pricing.', amount: 499, billing_period: 'monthly', benefits: ['Priority support', 'Member pricing'] }, { id: 'care-plus', name: 'Care Plus', description: 'Includes one scheduled service credit.', amount: 899, billing_period: 'monthly', benefits: ['Priority support', 'Member pricing', 'One service credit'] }]

export function CustomerMembershipPanel({ onNotice }: Props) {
  const plansQuery = useMembershipPlans()
  const membershipQuery = useCustomerMembership()
  const request = useRequestMembership()
  const plans = demoDataEnabled ? demoPlans : plansQuery.data ?? []
  const selectedPlan = membershipQuery.data?.plan_id
  function choose(planId: string) { if (demoDataEnabled) { onNotice('Membership plan selected for your next booking.'); return }; request.mutate(planId, { onSuccess: () => onNotice('Membership request submitted for review.'), onError: () => onNotice('Membership request could not be submitted.') }) }
  if (!demoDataEnabled && plansQuery.isLoading) return <section className="workspace-view-panel customer-operation-panel"><h2>Loading membership plans…</h2></section>
  if (!demoDataEnabled && plansQuery.isError) return <section className="workspace-view-panel customer-operation-panel"><h2>Membership plans are unavailable.</h2><button className="button button-primary" onClick={() => plansQuery.refetch()}>Retry</button></section>
  return <section className="workspace-view-panel customer-operation-panel"><div className="membership-banner"><Crown size={26} /><div><p className="eyebrow">MEMBERSHIP</p><h2>Benefits for every delivery.</h2><p>Choose a plan for priority support and member pricing.</p></div></div><div className="customer-card-grid membership-plan-grid">{plans.map((plan) => <article className={`customer-info-card membership-plan ${selectedPlan === plan.id ? 'is-selected' : ''}`} key={plan.id}><span><ShieldCheck size={18} /></span><b>{plan.name}</b><strong>INR {Number(plan.amount).toLocaleString('en-IN')} / {plan.billing_period}</strong><p>{plan.description}</p><ul>{plan.benefits.map((benefit) => <li key={benefit}>{benefit}</li>)}</ul><button className="button button-primary" disabled={request.isPending} onClick={() => choose(plan.id)}>{selectedPlan === plan.id ? 'Requested' : 'Choose plan'}</button></article>)}</div>{!plans.length && <div className="admin-empty-state">No membership plans are available.</div>}</section>
}
