import { ArrowRight, Check, Construction, Droplets, Factory, Gauge, Truck, Waves, type LucideIcon } from 'lucide-react'
import { useAppNavigation } from '../routing/useAppNavigation'
import { servicesContent as c } from '../content/services'

type ItemId = (typeof c.items)[number]['id']

const itemIcons: Record<ItemId, LucideIcon> = {
  water: Droplets,
  sewage: Waves,
  borewell: Factory,
  rmc: Construction,
  emptyTanker: Truck,
  tankCleaning: Gauge,
}

export default function MarketingServicesScreen() {
  const { navigate } = useAppNavigation()

  return (
    <div className="marketing-page">
      <section className="marketing-page-hero marketing-shell">
        <p className="marketing-eyebrow">{c.intro.eyebrow}</p>
        <h1>{c.intro.title}</h1>
        <p>{c.intro.body}</p>
        <button className="button button-primary" onClick={() => navigate('booking')}>
          {c.requestService} <ArrowRight size={15} />
        </button>
      </section>
      <section className="marketing-section marketing-services">
        <div className="marketing-shell">
          <div className="marketing-service-grid marketing-service-grid-detail">
            {c.items.map((item) => {
              const Icon = itemIcons[item.id]
              return (
                <article className="marketing-service-card marketing-service-card-detail" key={item.id}>
                  <span className="marketing-service-icon"><Icon size={24} /></span>
                  <p className="marketing-card-kicker">{item.category}</p>
                  <h2>{item.name}</h2>
                  <p>{item.description}</p>
                  <ul>
                    <li><Check size={15} />{item.features}</li>
                    <li><Check size={15} />{c.sharedFeature}</li>
                  </ul>
                  <button className="marketing-inline-link" onClick={() => navigate('booking')}>
                    {c.requestService} <ArrowRight size={14} />
                  </button>
                </article>
              )
            })}
          </div>
        </div>
      </section>
      <section className="marketing-bottom-cta">
        <div className="marketing-shell">
          <div>
            <p className="marketing-eyebrow">HAVE A SITE REQUIREMENT?</p>
            <h2>Start with the service that fits.</h2>
            <p>Share your location and requirements to begin a booking.</p>
          </div>
          <button className="button button-primary" onClick={() => navigate('booking')}>
            Book a service <ArrowRight size={15} />
          </button>
        </div>
      </section>
    </div>
  )
}
