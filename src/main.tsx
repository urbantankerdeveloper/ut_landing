import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './theme/fonts'
import App from './App.tsx'
import { registerServiceWorker } from './pwa/register'
import './components/landing/Reveal.css'

document.documentElement.classList.add('js-reveal')
const serviceBackgroundsEnabled = import.meta.env.VITE_SERVICE_BACKGROUNDS === 'true'
if (serviceBackgroundsEnabled) {
  document.documentElement.classList.add('service-backgrounds-enabled')
}

if (import.meta.env.VITE_LANDING_3D_EFFECTS === 'false') {
  document.documentElement.classList.add('landing-3d-disabled')
}

if (import.meta.env.VITE_LANDING_3D_EFFECTS !== 'false'
  && window.matchMedia('(hover: hover) and (pointer: fine)').matches
  && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const tiltTargets = [
    ...(serviceBackgroundsEnabled ? ['.marketing-service-card'] : []),
    '.marketing-plan-card',
    '.marketing-about-card',
  ].join(', ')
  document.addEventListener('pointermove', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(tiltTargets)
    if (!target) return
    const rect = target.getBoundingClientRect()
    const x = (event.clientX - rect.left) / rect.width
    const y = (event.clientY - rect.top) / rect.height
    target.style.setProperty('--tilt-x', `${((0.5 - y) * 6).toFixed(2)}deg`)
    target.style.setProperty('--tilt-y', `${((x - 0.5) * 8).toFixed(2)}deg`)
    target.style.setProperty('--highlight-x', `${((x - 0.5) * 100).toFixed(0)}%`)
    target.style.setProperty('--highlight-y', `${((y - 0.5) * 100).toFixed(0)}%`)
  })
  document.addEventListener('pointerout', (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(tiltTargets)
    target?.style.setProperty('--tilt-x', '0deg')
    target?.style.setProperty('--tilt-y', '0deg')
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerServiceWorker()
