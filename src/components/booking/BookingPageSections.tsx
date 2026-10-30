export function BookingHero({ onBack }: { onBack: () => void }) {
  return <section className="booking-hero">
    <div className="booking-hero-copy">
      <button className="booking-back" type="button" onClick={onBack}>Back to home</button>
      <p className="eyebrow">BOOK URBAN TANKER</p>
      <h1>One booking.<br /><em>Every service you need.</em></h1>
      <p>Add multiple services, choose one convenient slot and submit everything as a single coordinated request.</p>
    </div>
    <div className="booking-hero-promise" aria-label="Booking benefits">
      <span><b>01</b> Add services</span>
      <span><b>02</b> Choose one slot</span>
      <span><b>03</b> Review &amp; submit</span>
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

const progressItems = [
  { title: 'Requirements', detail: 'Add every service' },
  { title: 'Shared slot', detail: 'Location, date & time' },
  { title: 'Confirmation', detail: 'Review one request' },
]

export function BookingProgress({ activeStep }: { activeStep: 1 | 2 | 3 }) {
  return <div className="booking-progress" aria-label="Booking progress">
    {progressItems.map((item, index) => <div className={activeStep === index + 1 ? 'active' : ''} key={item.title}>
      <i>{index + 1}</i><span><b>{item.title}</b><small>{item.detail}</small></span>
    </div>).flatMap((step, index) => index < progressItems.length - 1 ? [step, <span className="booking-progress-line" key={`line-${index}`} />] : [step])}
  </div>
}

export type BookingSummaryItem = { id: string; label: string; detail: string; amount: number; estimatePending?: boolean }

export function BookingSummary({ items, total }: { items: BookingSummaryItem[]; total: number }) {
  const pending = items.some((item) => item.estimatePending)
  const formatter = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
  const knownTotal = items.reduce((sum, item) => sum + (item.estimatePending ? 0 : item.amount), 0)

  return <aside className="surface booking-summary">
    <p className="eyebrow">LIVE SUMMARY</p>
    <h2>Your booking</h2>
    <p className="muted">Each service becomes a trackable order under one booking reference.</p>
    <div className="booking-summary-items">
      {items.map((item) => <div className="summary-line" key={item.id}>
        <span>{item.label}<small>{item.detail}</small></span>
        <b>{item.estimatePending ? 'Quote pending' : formatter.format(item.amount)}</b>
      </div>)}
      <div className="summary-total">
        <span>{pending ? 'Known estimates' : 'Estimated total'}</span>
        <strong>{formatter.format(pending ? knownTotal : total)}</strong>
      </div>
      {pending && <p className="muted booking-summary-note">Project quotes will be added after review.</p>}
    </div>
    <div className="booking-assurance"><span>✓</span><div><b>Clear before confirmation</b><small>Known estimates and coupon savings update as you make changes.</small></div></div>
    <div className="booking-assurance"><span>⌖</span><div><b>One shared slot</b><small>Your location, date and time apply to every selected service.</small></div></div>
  </aside>
}