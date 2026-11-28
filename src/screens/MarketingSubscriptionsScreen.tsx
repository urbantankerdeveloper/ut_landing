import { ArrowRight, CalendarClock, PauseCircle, ShieldCheck, type LucideIcon } from 'lucide-react'
import { useAppNavigation } from '../routing/useAppNavigation'
import { subscriptionsContent as c } from '../content/subscriptions'
import { Reveal } from '../components/landing/Reveal'

type FeatureId = (typeof c.features)[number]['id']

const featureIcons: Record<FeatureId, LucideIcon> = {
  predictable: CalendarClock,
  flexible: PauseCircle,
  fulfilment: ShieldCheck,
}

export default function MarketingSubscriptionsScreen() {
  const { navigate } = useAppNavigation()

  return (
    <div className="marketing-page">
      <Reveal as="section" className="marketing-page-hero marketing-shell" variant="fade-in">
        <p className="marketing-eyebrow">{c.intro.eyebrow}</p>
        <h1>{c.intro.title}</h1>
        <p>{c.intro.body}</p>
      </Reveal>
      <section className="marketing-section marketing-pricing">
        <div className="marketing-shell">
          <div className="marketing-plan-grid">
            {c.plans.map((plan, index) => (
              <Reveal as="article" className={`marketing-plan-card plan-card-fan-${index} ${plan.featured ? 'is-featured' : ''}`} key={plan.id} variant="scale-in">
                {plan.featured && <span className="marketing-plan-badge">{c.featuredBadge}</span>}
                <h2>{plan.name}</h2>
                <p>{plan.detail}</p>
                <strong>{plan.price}<small>{!plan.isCustomPrice && c.priceSuffix}</small></strong>
                <button className={`button ${plan.featured ? 'marketing-button-light' : 'button-primary'}`} onClick={() => navigate('booking')}>
                  {c.choosePlan} <ArrowRight size={15} />
                </button>
              </Reveal>
            ))}
          </div>
          <div className="marketing-feature-grid">
            {c.features.map((feature) => {
              const Icon = featureIcons[feature.id]
              return (
                <article key={feature.id}>
                  <Icon size={21} />
                  <div><h3>{feature.title}</h3><p>{feature.copy}</p></div>
                </article>
              )
            })}
          </div>
        </div>
      </section>
      <section className="marketing-bottom-cta">
        <div className="marketing-shell">
          <div>
            <p className="marketing-eyebrow">A DIFFERENT SCHEDULE?</p>
            <h2>Need a plan tailored to your site?</h2>
            <p>Share your requirements and start a service request.</p>
          </div>
          <button className="button button-primary" onClick={() => navigate('booking')}>
            Request a custom plan <ArrowRight size={15} />
          </button>
        </div>
      </section>
    </div>
  )
}
