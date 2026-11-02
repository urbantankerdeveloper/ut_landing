import { bookingContent as c } from '../../content/booking'

export function BookingHero({ onBack }: { onBack: () => void }) {
  return <section className="booking-hero">
    <div className="booking-hero-copy">
      <button className="booking-back" type="button" onClick={onBack}>{c.hero.backToHome}</button>
      <p className="eyebrow">{c.hero.eyebrow}</p>
      <h1>{c.hero.titleLead}<br /><em>{c.hero.titleEmphasis}</em></h1>
      <p>{c.hero.intro}</p>
    </div>
    <div className="booking-hero-promise" aria-label={c.hero.benefitsLabel}>
      {c.hero.benefits.map((benefit) => <span key={benefit.number}><b>{benefit.number}</b> {benefit.label}</span>)}
    </div>
  </section>
}

export function BookingSection({ number, title, description, children }: { number: string; title: string; description: string; children: React.ReactNode }) {
  return <section className="surface booking-surface">
    <div className="surface-heading booking-section-heading">
      <span className="section-number">{number}</span>
      <div><h2>{title}</h2><p>{description}</p></div>
    </div>
    {children}
  </section>
}

export function BookingProgress({ activeStep }: { activeStep: 1 | 2 | 3 }) {
  return <div className="booking-progress" aria-label={c.progress.label}>
    {c.progress.steps.map((item, index) => <div className={activeStep === index + 1 ? 'active' : ''} key={item.title}>
      <i>{index + 1}</i><span><b>{item.title}</b><small>{item.detail}</small></span>
    </div>).flatMap((step, index) => index < c.progress.steps.length - 1 ? [step, <span className="booking-progress-line" key={`line-${index}`} />] : [step])}
  </div>
}

export type BookingSummaryItem = { id: string; label: string; detail: string; amount: number; estimatePending?: boolean }

const assuranceGlyphs: Record<(typeof c.summary.assurances)[number]['id'], string> = {
  clearBeforeConfirmation: '✓',
  oneSharedSlot: '⌖',
}

export function BookingSummary({ items, total }: { items: BookingSummaryItem[]; total: number }) {
  const pending = items.some((item) => item.estimatePending)
  const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
  const knownTotal = items.reduce((sum, item) => sum + (item.estimatePending ? 0 : item.amount), 0)

  return <aside className="surface booking-summary">
    <p className="eyebrow">{c.summary.eyebrow}</p>
    <h2>{c.summary.heading}</h2>
    <p className="muted">{c.summary.intro}</p>
    <div className="booking-summary-items">
      {items.map((item) => <div className="summary-line" key={item.id}>
        <span>{item.label}<small>{item.detail}</small></span>
        <b>{item.estimatePending ? c.serviceSummary.quotePending : formatter.format(item.amount)}</b>
      </div>)}
      <div className="summary-total">
        <span>{pending ? c.summary.knownEstimates : c.summary.estimatedTotal}</span>
        <strong>{formatter.format(pending ? knownTotal : total)}</strong>
      </div>
      {pending && <p className="muted booking-summary-note">{c.summary.quotesPendingNote}</p>}
    </div>
    {c.summary.assurances.map((assurance) => <div className="booking-assurance" key={assurance.id}><span>{assuranceGlyphs[assurance.id]}</span><div><b>{assurance.title}</b><small>{assurance.detail}</small></div></div>)}
  </aside>
}
