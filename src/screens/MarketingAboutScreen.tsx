import { ArrowRight, Check, Droplets, ShieldCheck, Truck, type LucideIcon } from 'lucide-react'
import { useAppNavigation } from '../routing/useAppNavigation'
import { aboutContent as c } from '../content/about'
import { Reveal } from '../components/landing/Reveal'

type CardId = (typeof c.cards)[number]['id']

const cardIcons: Record<CardId, LucideIcon> = {
  builtAroundJob: Droplets,
  clearFromStart: Truck,
  madeToBeTrusted: ShieldCheck,
}

export default function MarketingAboutScreen() {
  const { navigate } = useAppNavigation()

  return (
    <div className="marketing-page">
      <Reveal as="section" className="marketing-page-hero marketing-shell" variant="fade-in">
        <p className="marketing-eyebrow">{c.intro.eyebrow}</p>
        <h1>{c.intro.title}</h1>
        <p>{c.intro.body}</p>
        <button className="button button-primary" onClick={() => navigate('services')}>
          Explore our services <ArrowRight size={15} />
        </button>
      </Reveal>
      <section className="marketing-about-section">
        <div className="marketing-shell">
          <div className="marketing-section-heading">
            <div>
              <p className="marketing-eyebrow">HOW WE WORK</p>
              <h2>Practical service, with the details in view.</h2>
            </div>
          </div>
          <div className="marketing-about-grid">
            {c.cards.map((card) => {
              const Icon = cardIcons[card.id]
              return (
                <Reveal as="article" className="marketing-about-card" key={card.id} variant="slide-right" stagger={140}>
                  <span className="marketing-service-icon"><Icon size={22} /></span>
                  <h3>{card.title}</h3>
                  <p>{card.body}</p>
                </Reveal>
              )
            })}
          </div>
          <div className="marketing-about-promise">
            <div>
              <p className="marketing-eyebrow">BUILT FOR REAL-WORLD NEEDS</p>
              <h2>One place to coordinate the work.</h2>
            </div>
            <ul className="marketing-check-list">
              {c.checklist.map((item) => <li key={item.id}><Check size={16} />{item.text}</li>)}
            </ul>
          </div>
        </div>
      </section>
      <section className="marketing-bottom-cta">
        <div className="marketing-shell">
          <div>
            <p className="marketing-eyebrow">LET'S GET STARTED</p>
            <h2>Tell us what you need.</h2>
            <p>Find the service that fits your property or project.</p>
          </div>
          <button className="button button-primary" onClick={() => navigate('booking')}>
            Book a service <ArrowRight size={15} />
          </button>
        </div>
      </section>
    </div>
  )
}
