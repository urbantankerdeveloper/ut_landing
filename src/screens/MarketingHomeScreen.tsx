import { ArrowRight, Check, Construction, Droplets, LocateFixed, ShieldCheck, Truck, Waves, type LucideIcon } from 'lucide-react'
import { useAppNavigation } from '../routing/useAppNavigation'
import { DeliveryLocationChip } from '../components/DeliveryLocationChip'
import { useAuthStore } from '../stores/authStore'
import { shouldShowBookingButton } from '../constants/publicFeatures'
import { homeContent as c } from '../content/home'

type ServiceId = (typeof c.services)[number]['id']
type BenefitId = (typeof c.benefits)[number]['id']

const heroSrc = '/assets/urban-tanker-hero-1920.webp'
const heroSrcSet = '/assets/urban-tanker-hero-960.webp 960w, /assets/urban-tanker-hero-1280.webp 1280w, /assets/urban-tanker-hero-1920.webp 1920w'

const serviceIcons: Record<ServiceId, LucideIcon> = {
  water: Droplets,
  sewage: Waves,
  infrastructure: LocateFixed,
  rmc: Construction,
  emptyTanker: Truck,
}

const benefitIcons: Record<BenefitId, LucideIcon> = {
  trusted: ShieldCheck,
  schedule: Truck,
  loop: LocateFixed,
}

const processIcons: Record<(typeof c.process.steps)[number]['id'], LucideIcon> = {
  request: ArrowRight,
  match: Truck,
  track: Check,
}

export default function MarketingHomeScreen() {
  const { navigate } = useAppNavigation()
  const user = useAuthStore((state) => state.user)
  const showBookingButton = shouldShowBookingButton(user?.role)

  return (
    <div className="marketing-home">
      <link rel="preload" as="image" href={heroSrc} imageSrcSet={heroSrcSet} imageSizes="100vw" fetchPriority="high" />
      <section className="marketing-hero">
        <img className="marketing-hero-image" src={heroSrc} srcSet={heroSrcSet} sizes="100vw" width={1920} height={960} fetchPriority="high" decoding="async" alt="" />
        <div className="marketing-hero-content marketing-shell">
          <div className="marketing-hero-copy">
            <DeliveryLocationChip />
            <p className="marketing-eyebrow">{c.hero.eyebrow}</p>
            <h1>{c.hero.titleLead} <em>{c.hero.titleEmphasis}</em></h1>
            <p className="marketing-hero-lede">{c.hero.lede}</p>
            <div className="marketing-actions">
              {showBookingButton && <button className="button button-primary" onClick={() => navigate('booking')}>
                {c.hero.primaryCta} <ArrowRight size={16} />
              </button>}
              <button className="button marketing-button-light" onClick={() => navigate('services')}>
                {c.hero.secondaryCta}
              </button>
            </div>
            <div className="marketing-trust-row">
              {c.trust.items.map((item) => (
                <span key={item.id}><Check size={15} /><b>{item.emphasis}</b> {item.label}</span>
              ))}
            </div>
          </div>
          <aside className="marketing-hero-note">
            <span className="marketing-note-mark"><Droplets size={18} /></span>
            <p className="marketing-eyebrow">ONE PLACE FOR YOUR SITE</p>
            <strong>Water, sanitation and more.</strong>
            <p>Explore services for homes, apartments, businesses and project sites.</p>
            <button className="marketing-inline-link" onClick={() => navigate('services')}>
              See all services <ArrowRight size={14} />
            </button>
          </aside>
        </div>
      </section>

      <section className="marketing-section marketing-services">
        <div className="marketing-shell">
          <div className="marketing-section-heading">
            <div>
              <p className="marketing-eyebrow">{c.showcase.eyebrow}</p>
              <h2>{c.showcase.title}</h2>
              <p>{c.showcase.intro}</p>
            </div>
            <button className="marketing-inline-link" onClick={() => navigate('services')}>
              {c.showcase.exploreAll} <ArrowRight size={15} />
            </button>
          </div>
          <div className="marketing-service-grid">
            {c.services.map((service) => {
              const Icon = serviceIcons[service.id]
              return (
                <article className="marketing-service-card" key={service.id}>
                  <span className="marketing-service-icon"><Icon size={23} /></span>
                  <p className="marketing-card-kicker">{service.category}</p>
                  <h3>{service.title}</h3>
                  <p>{service.copy}</p>
                  <div className="marketing-facts">{service.facts.map((fact) => <span key={fact}>{fact}</span>)}</div>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section className="marketing-process">
        <div className="marketing-shell">
          <div className="marketing-section-heading">
            <div>
              <p className="marketing-eyebrow">{c.process.eyebrow}</p>
              <h2>{c.process.title}</h2>
            </div>
          </div>
          <div className="marketing-step-grid">
            {c.process.steps.map((step, index) => {
              const Icon = processIcons[step.id]
              return (
                <article className="marketing-step" key={step.id}>
                  <span className="marketing-step-number">0{index + 1}</span>
                  <span className="marketing-step-icon"><Icon size={20} /></span>
                  <h3>{step.title}</h3>
                  <p>{step.copy}</p>
                </article>
              )
            })}
          </div>
        </div>
      </section>

      <section className="marketing-benefits marketing-shell">
        {c.benefits.map((benefit) => {
          const Icon = benefitIcons[benefit.id]
          return (
            <article key={benefit.id}>
              <Icon size={22} />
              <div><h3>{benefit.title}</h3><p>{benefit.copy}</p></div>
            </article>
          )
        })}
      </section>

      <section className="marketing-plan-cta">
        <div className="marketing-shell marketing-plan-cta-inner">
          <div>
            <p className="marketing-eyebrow">{c.subscriptionTeaser.eyebrow}</p>
            <h2>{c.subscriptionTeaser.title}</h2>
            <p>{c.subscriptionTeaser.body}</p>
          </div>
          <button className="button marketing-button-light" onClick={() => navigate('subscriptions')}>
            Explore subscriptions <ArrowRight size={15} />
          </button>
        </div>
      </section>

      <section className="marketing-closing marketing-shell">
        <div>
          <p className="marketing-eyebrow">{c.closing.eyebrow}</p>
          <h2>{c.closing.title}</h2>
          <p>{c.closing.body}</p>
        </div>
        {showBookingButton && <button className="button button-primary" onClick={() => navigate('booking')}>
          {c.closing.cta} <ArrowRight size={15} />
        </button>}
      </section>
    </div>
  )
}
