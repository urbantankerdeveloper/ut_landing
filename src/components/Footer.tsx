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

export function Footer() {
  const navigate = useNavigationStore((state) => state.navigate)
  return <footer className="site-footer"><div className="footer-brand-wrap"><button className="brand" onClick={() => navigate('home')}><span className="brand-mark">UT</span><span>Urban <b>Tanker</b></span></button><p>One app. All water services. Your complete water solutions partner.</p></div><div className="footer-grid">{columns.map(({ title, links }) => <div key={title}><h3>{title}</h3><ul>{links.map(({ label, screen }) => <li key={label}><button onClick={() => navigate(screen)}>{label}</button></li>)}</ul></div>)}<div className="social-card"><h3>FOLLOW US</h3><div className="social-links"><a href="https://instagram.com" target="_blank" rel="noreferrer" aria-label="Instagram" title="Instagram"><Instagram size={22} /></a><a href="https://facebook.com" target="_blank" rel="noreferrer" aria-label="Facebook" title="Facebook"><Facebook size={22} /></a><a href="https://x.com" target="_blank" rel="noreferrer" aria-label="X / Twitter" title="X / Twitter"><Twitter size={22} /></a><a href="https://linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn" title="LinkedIn"><Linkedin size={22} /></a></div><div className="qr-block"><div className="mini-qr" aria-hidden="true">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div><div><strong>DOWNLOAD THE URBAN TANKER APP</strong><small>Store listings coming soon</small></div></div></div></div><div className="footer-bottom"><p>© 2026 Urban Tanker. All rights reserved.</p></div></footer>
}
