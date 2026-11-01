import { Instagram, Linkedin, Facebook, Twitter } from 'lucide-react'
import { useNavigationStore, type ScreenId } from '../stores/navigationStore'

type FooterLink = { label: string; screen: ScreenId }

const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: 'Water services',
    links: ['Water tanker', 'Sewage tanker', 'Tank and sump cleaning', 'Borewell services', 'RMC mixer trucks', 'Empty tanker hire'].map((label) => ({ label, screen: 'booking' })),
  },
  {
    title: 'Company',
    links: [
      { label: 'About us', screen: 'about' },
      { label: 'Subscriptions', screen: 'subscriptions' },
      { label: 'Become a partner', screen: 'partner' },
      { label: 'My account', screen: 'account' },
    ],
  },
  {
    title: 'Policies and help',
    links: [
      { label: 'Terms and conditions', screen: 'terms' },
      { label: 'Privacy policy', screen: 'policy' },
      { label: 'Book a tanker', screen: 'booking' },
      { label: 'Track your booking', screen: 'tracking' },
      { label: 'Contact support', screen: 'account' },
    ],
  },
]

function PlayStoreIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path className="play-blue" d="M3 2.5 13.5 12 3 21.5Z" /><path className="play-green" d="M3 2.5 16.5 9 13.5 12Z" /><path className="play-yellow" d="M16.5 9 20.5 11.25Q21.5 12 20.5 12.75L16.5 15 13.5 12Z" /><path className="play-red" d="M3 21.5 13.5 12 16.5 15Z" /></svg>
}

export function Footer() {
  const navigate = useNavigationStore((state) => state.navigate)
  return <footer className="site-footer"><div className="footer-brand-wrap"><button className="brand" onClick={() => navigate('home')}><img className="brand-wordmark footer-wordmark" src="/urban-tanker-wordmark.png" alt="Urban Tanker" /></button><p>One app. All water services. Your complete water solutions partner.</p></div><div className="footer-grid">{columns.map(({ title, links }) => <div key={title}><h3>{title}</h3><ul>{links.map(({ label, screen }) => <li key={label}><button onClick={() => navigate(screen)}>{label}</button></li>)}</ul></div>)}<div className="social-card"><h3>FOLLOW US</h3><svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}><defs><linearGradient id="instagram-gradient" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#fed575" /><stop offset=".5" stopColor="#d62976" /><stop offset="1" stopColor="#962fbf" /></linearGradient></defs></svg><div className="social-links"><a className="social-instagram" href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram" title="Instagram"><Instagram size={22} /></a><a className="social-facebook" href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook" title="Facebook"><Facebook size={22} /></a><a className="social-x" href="https://x.com" target="_blank" rel="noreferrer" aria-label="X / Twitter" title="X / Twitter"><Twitter size={22} /></a><a className="social-linkedin" href="https://linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn" title="LinkedIn"><Linkedin size={22} /></a><a className="social-play-store" href="https://play.google.com/store" target="_blank" rel="noreferrer" aria-label="Google Play Store" title="Google Play Store"><PlayStoreIcon /></a></div><div className="qr-block"><div className="mini-qr" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div><div><strong>DOWNLOAD THE URBAN TANKER APP</strong><small>Store listings coming soon</small></div></div></div></div><div className="footer-bottom"><p>© 2026 Urban Tanker. All rights reserved.</p></div></footer>
}
