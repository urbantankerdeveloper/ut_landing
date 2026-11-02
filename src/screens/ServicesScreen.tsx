import { ArrowRight, Construction, Droplets, Factory, Gauge, Truck, Waves, type LucideIcon } from 'lucide-react'
import { useNavigationStore } from '../stores/navigationStore'
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

export default function ServicesScreen() {
  const navigate = useNavigationStore((state) => state.navigate)
  return (
    <section className="content-screen services-screen">
      <div className="section-intro">
        <p className="eyebrow">{c.intro.eyebrow}</p>
        <h1>{c.intro.title}</h1>
        <p>{c.intro.body}</p>
      </div>
      <div className="service-detail-grid">
        {c.items.map((item) => {
          const Icon = itemIcons[item.id]
          return (
            <article className="service-detail-card" key={item.id}>
              <div className="service-detail-visual">
                <span className="service-icon"><Icon size={30} /></span>
              </div>
              <div className="service-detail-body">
                <p className="service-category">{item.category}</p>
                <h2>{item.name}</h2>
                <p>{item.description}</p>
                <ul>
                  <li>{item.features}</li>
                  <li>{c.sharedFeature}</li>
                </ul>
                <button className="button button-primary" onClick={() => navigate('booking')}>
                  {c.requestService} <ArrowRight size={15} />
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
