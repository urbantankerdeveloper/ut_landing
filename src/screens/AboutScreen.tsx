import { Check, Droplets, ShieldCheck, Truck, type LucideIcon } from 'lucide-react'
import { aboutContent as c } from '../content/about'

type CardId = (typeof c.cards)[number]['id']

const cardIcons: Record<CardId, LucideIcon> = {
  builtAroundJob: Droplets,
  clearFromStart: Truck,
  madeToBeTrusted: ShieldCheck,
}

export default function AboutScreen() {
  return (
    <section className="content-screen about-screen">
      <div className="section-intro">
        <p className="eyebrow">{c.intro.eyebrow}</p>
        <h1>{c.intro.title}</h1>
        <p>{c.intro.body}</p>
      </div>
      <div className="about-story">
        {c.cards.map((card) => {
          const Icon = cardIcons[card.id]
          return (
            <div className="about-card" key={card.id}>
              <Icon size={24} />
              <h2>{card.title}</h2>
              <p>{card.body}</p>
            </div>
          )
        })}
      </div>
      <ul className="check-list">
        {c.checklist.map((item) => (
          <li key={item.id}><Check size={16} /> {item.text}</li>
        ))}
      </ul>
    </section>
  )
}
