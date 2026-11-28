import { ArrowRight, FileText, Tag, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useAppNavigation } from '../routing/useAppNavigation'
import { legalContent as l } from '../content/legal'
import { referenceContent as r } from '../content/reference'
import { Reveal } from '../components/landing/Reveal'
import PublicOrderTrackingLookup from './PublicOrderTrackingLookup'

export default function PublicReferenceScreen() {
  const { activeScreen: screen } = useAppNavigation()
  const { navigate } = useAppNavigation()
  if (screen === 'tracking') return <section className="content-screen public-reference-screen"><PageIntro eyebrow={r.tracking.eyebrow} title={<>{r.tracking.titleLead} <em>{r.tracking.titleEmphasis}</em></>} copy={r.tracking.copy} /><PublicOrderTrackingLookup /></section>
  if (screen === 'terms' || screen === 'policy') {
    const legal = screen === 'terms' ? l.terms : l.privacy
    return <section className="content-screen public-reference-screen"><Reveal variant="fade-in"><PageIntro eyebrow={legal.eyebrow} title={<>{legal.titleLead} <em>{legal.titleEmphasis}</em></>} copy={legal.intro} /></Reveal><Reveal as="article" variant="fade-in" className="reference-copy-card"><h2>{legal.cardTitle}</h2><p>{legal.cardCopy}</p><button className="text-button" onClick={() => navigate('account')}>{l.common.openAccount} <ArrowRight size={14} /></button></Reveal></section>
  }
  return <section className="content-screen public-reference-screen"><PageIntro eyebrow={r.coupons.eyebrow} title={<>{r.coupons.titleLead} <em>{r.coupons.titleEmphasis}</em></>} copy={r.coupons.copy} /><div className="public-reference-grid"><ReferenceCard icon={Tag} title={r.coupons.offerTitle} copy={r.coupons.offerCopy} action={r.coupons.offerAction} onAction={() => navigate('booking')} /><ReferenceCard icon={FileText} title={r.coupons.termsTitle} copy={r.coupons.termsCopy} action={r.coupons.termsAction} onAction={() => navigate('booking')} /></div></section>
}

function PageIntro({ eyebrow, title, copy }: { eyebrow: string; title: ReactNode; copy: string }) { return <div className="section-intro"><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></div> }
function ReferenceCard({ icon: Icon, title, copy, action, onAction }: { icon: LucideIcon; title: string; copy: string; action?: string; onAction?: () => void }) { return <article className="reference-copy-card"><span className="reference-card-icon"><Icon size={22} /></span><h2>{title}</h2><p>{copy}</p>{action && <button className="button button-primary" onClick={onAction}>{action} <ArrowRight size={14} /></button>}</article> }
