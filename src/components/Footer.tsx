import { Instagram, Linkedin, Facebook, Twitter } from 'lucide-react'
import { type ScreenId } from '../stores/navigationStore'
import { useAppNavigation } from '../routing/useAppNavigation'
import { chromeContent as c } from '../content/chrome'

type FooterLinkId = (typeof c.footer.columns)[number]['links'][number]['id']

const linkScreens: Record<FooterLinkId, ScreenId> = {
  'water-tanker': 'booking',
  'sewage-tanker': 'booking',
  'tank-and-sump-cleaning': 'booking',
  'borewell-services': 'booking',
  'rmc-mixer-trucks': 'booking',
  'empty-tanker-hire': 'booking',
  'about-us': 'about',
  subscriptions: 'subscriptions',
  'become-a-partner': 'partner',
  'my-account': 'account',
  terms: 'terms',
  privacy: 'policy',
  'book-a-tanker': 'booking',
  'track-your-booking': 'tracking',
  'contact-support': 'account',
}

function PlayStoreIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path className="play-blue" d="M3 2.5 13.5 12 3 21.5Z" /><path className="play-green" d="M3 2.5 16.5 9 13.5 12Z" /><path className="play-yellow" d="M16.5 9 20.5 11.25Q21.5 12 20.5 12.75L16.5 15 13.5 12Z" /><path className="play-red" d="M3 21.5 13.5 12 16.5 15Z" /></svg>
}

export function Footer() {
  const { navigate } = useAppNavigation()
  return <footer className="site-footer"><div className="footer-brand-wrap"><button className="brand" onClick={() => navigate('home')}><img className="brand-wordmark footer-wordmark" src="/urban-tanker-wordmark.webp" width={380} height={59} loading="lazy" decoding="async" alt={c.footer.logoAlt} /></button><p>{c.footer.tagline}</p></div><div className="footer-grid">{c.footer.columns.map((column) => <div key={column.id}><h2>{column.title}</h2><ul>{column.links.map((link) => <li key={link.id}><button onClick={() => navigate(linkScreens[link.id])}>{link.label}</button></li>)}</ul></div>)}<div className="social-card"><h2>{c.footer.followUs}</h2><svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}><defs><linearGradient id="instagram-gradient" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#fed575" /><stop offset=".5" stopColor="#d62976" /><stop offset="1" stopColor="#962fbf" /></linearGradient></defs></svg><div className="social-links"><a className="social-instagram" href="https://instagram.com" target="_blank" rel="noreferrer" aria-label={c.footer.social.instagram} title={c.footer.social.instagram}><Instagram size={22} /></a><a className="social-facebook" href="https://facebook.com" target="_blank" rel="noreferrer" aria-label={c.footer.social.facebook} title={c.footer.social.facebook}><Facebook size={22} /></a><a className="social-x" href="https://x.com" target="_blank" rel="noreferrer" aria-label={c.footer.social.x} title={c.footer.social.x}><Twitter size={22} /></a><a className="social-linkedin" href="https://linkedin.com" target="_blank" rel="noreferrer" aria-label={c.footer.social.linkedin} title={c.footer.social.linkedin}><Linkedin size={22} /></a><a className="social-play-store" href="https://play.google.com/store" target="_blank" rel="noreferrer" aria-label={c.footer.social.playStore} title={c.footer.social.playStore}><PlayStoreIcon /></a></div><div className="qr-block"><div className="mini-qr" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div><div><strong>{c.footer.downloadApp}</strong><small>{c.footer.storeListingsSoon}</small></div></div></div></div><div className="footer-bottom"><p>{c.footer.copyright}</p></div></footer>
}
