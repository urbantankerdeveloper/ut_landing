import { ArrowRight, CalendarClock, PauseCircle, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useAppNavigation } from '../routing/useAppNavigation'
import { subscriptionsContent as c } from '../content/subscriptions'

type FeatureId = (typeof c.features)[number]['id']

const featureIcons: Record<FeatureId, LucideIcon> = {
  predictable: CalendarClock,
  flexible: PauseCircle,
  fulfilment: ShieldCheck,
}

export default function SubscriptionsScreen() {
  const { navigate } = useAppNavigation()
  return (
    <section className="content-screen subscriptions-screen">
      <div className="section-intro">
        <p className="eyebrow">{c.intro.eyebrow}</p>
        <h1>{c.intro.title}</h1>
        <p>{c.intro.body}</p>
      </div>
      <div className="plan-grid">
        {c.plans.map((plan) => (
          <article className={`plan-card ${plan.featured ? 'is-featured' : ''}`} key={plan.id}>
            {plan.featured && <span className="plan-badge">{c.featuredBadge}</span>}
            <h2>{plan.name}</h2>
            <p>{plan.detail}</p>
            <strong>{plan.price}<small>{!plan.isCustomPrice && c.priceSuffix}</small></strong>
            <button className="button button-primary" onClick={() => navigate('booking')}>
              {c.choosePlan} <ArrowRight size={15} />
            </button>
          </article>
        ))}
      </div>
      <div className="feature-strip">
        {c.features.map((feature) => {
          const Icon = featureIcons[feature.id]
          return (
            <div key={feature.id}>
              <Icon size={20} />
              <b>{feature.title}</b>
              <span>{feature.copy}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
