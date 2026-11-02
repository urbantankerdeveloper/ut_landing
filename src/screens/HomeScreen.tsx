import { useEffect, useState } from 'react'
import { ArrowRight, Check, Construction, Droplets, LocateFixed, ShieldCheck, Truck, Waves, type LucideIcon } from 'lucide-react'
import { useNavigationStore } from '../stores/navigationStore'
import { reverseGeocodeApproximate } from '../services/geocoding'
import { homeContent as c } from '../content/home'

type ServiceId = (typeof c.services)[number]['id']
type BenefitId = (typeof c.benefits)[number]['id']

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

export default function HomeScreen() {
  const navigate = useNavigationStore((state) => state.navigate)
  const supportsGeolocation = typeof navigator !== 'undefined' && Boolean(navigator.geolocation)
  const [locationLabel, setLocationLabel] = useState<string>(c.location.defaultLabel)
  const [locationState, setLocationState] = useState<'idle' | 'loading' | 'ready' | 'unavailable'>('idle')

  useEffect(() => {
    // Detect the visitor's area once on load; the chip stays clickable to retry.
    detectLocation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function detectLocation() {
    if (!supportsGeolocation || locationState === 'loading') return
    setLocationState('loading')
    setLocationLabel(c.location.locating)
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      try {
        const area = await reverseGeocodeApproximate({ lat: coords.latitude, lng: coords.longitude })
        setLocationLabel(area)
        setLocationState('ready')
      } catch (error) {
        setLocationLabel(c.location.unableToDetermine)
        setLocationState('unavailable')
        console.warn(JSON.stringify({ event: 'home.location_reverse_geocode_failed', error: error instanceof Error ? error.message : 'Unknown error' }))
      }
    }, () => {
      setLocationLabel(c.location.unavailable)
      setLocationState('unavailable')
    }, { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 })
  }

  return (
    <div className="home-screen">
      <section className="hero hero-photo">
        <div className="hero-copy">
          <button
            type="button"
            className={`location-chip ${locationState === 'unavailable' ? 'location-chip-unavailable' : ''}`}
            onClick={detectLocation}
            disabled={!supportsGeolocation || locationState === 'loading'}
            aria-live="polite"
            aria-busy={locationState === 'loading'}
          >
            <LocateFixed size={13} /> <span>{locationState === 'ready' ? c.location.deliveringTo : locationState === 'loading' ? c.location.locatingLabel : supportsGeolocation ? c.location.useMyLocation : c.location.areaLabel}</span> <strong>{locationState === 'loading' ? c.location.locating : locationLabel}</strong>
          </button>
          <p className="eyebrow">{c.hero.eyebrow}</p>
          <h1>
            {c.hero.titleLead} <em>{c.hero.titleEmphasis}</em>
          </h1>
          <p className="hero-lede">{c.hero.lede}</p>
          <div className="hero-actions">
            <button className="button button-primary hero-primary" onClick={() => navigate('booking')}>
              {c.hero.primaryCta} <ArrowRight size={16} />
            </button>
            <button className="button button-quiet hero-secondary" onClick={() => navigate('services')}>
              {c.hero.secondaryCta}
            </button>
          </div>
          <div className="trust-row">
            {c.trust.items.map((item) => (
              <span key={item.id}>
                <Check size={14} />
                <b>{item.emphasis}</b> {item.label}
              </span>
            ))}
          </div>
        </div>
      </section>
      <section className="home-subscription-teaser">
        <div>
          <p className="eyebrow">{c.subscriptionTeaser.eyebrow}</p>
          <h2>{c.subscriptionTeaser.title}</h2>
          <p>{c.subscriptionTeaser.body}</p>
        </div>
        <div className="teaser-plan">
          <small>{c.subscriptionTeaser.planLabel}</small>
          <strong>
            {c.subscriptionTeaser.planTitle} <span>{c.subscriptionTeaser.planTitleEmphasis}</span>
          </strong>
          <p>{c.subscriptionTeaser.planBody}</p>
          <button className="button button-primary" onClick={() => navigate('booking')}>
            {c.subscriptionTeaser.cta} <ArrowRight size={15} />
          </button>
        </div>
      </section>
      <section className="reference-showcase">
        <div className="reference-header">
          <div>
            <p className="eyebrow">{c.showcase.eyebrow}</p>
            <h2>{c.showcase.title}</h2>
          </div>
          <button className="text-button" onClick={() => navigate('services')}>
            {c.showcase.exploreAll} <ArrowRight size={14} />
          </button>
        </div>
        <p className="service-explorer-intro">{c.showcase.intro}</p>
        <div className="service-showcase-grid">
          {c.services.map((service) => {
            const Icon = serviceIcons[service.id]
            return (
              <article className="service-showcase-card" key={service.id}>
                <div className="service-card-top">
                  <span className="service-category">{service.category}</span>
                  <span className="service-icon"><Icon size={23} /></span>
                </div>
                <h3>{service.title}</h3>
                <p>{service.copy}</p>
                <div className="service-facts">
                  {service.facts.map((fact) => <span key={fact}>{fact}</span>)}
                </div>
                <details className="service-disclosure">
                  <summary>{c.showcase.discoverLabel} <span aria-hidden="true">{c.showcase.disclosureMarker}</span></summary>
                  <p>{service.detail}</p>
                  <button className="text-button" onClick={() => navigate('booking')}>
                    {c.showcase.bookService} <ArrowRight size={13} />
                  </button>
                </details>
              </article>
            )
          })}
        </div>
      </section>
      <section className="benefit-strip">
        {c.benefits.map((benefit) => {
          const Icon = benefitIcons[benefit.id]
          return (
            <div key={benefit.id}>
              <Icon size={20} />
              <span>
                <b>{benefit.title}</b>
                <small>{benefit.copy}</small>
              </span>
            </div>
          )
        })}
      </section>
    </div>
  )
}
