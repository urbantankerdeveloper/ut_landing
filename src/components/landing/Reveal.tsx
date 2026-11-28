import { useRef, type CSSProperties, type ReactNode } from 'react'
import { isLandingAnimationEnabled, useScrollReveal } from './useScrollReveal'

export type RevealVariant = 'fade-up' | 'fade-in' | 'slide-left' | 'slide-right' | 'scale-in' | 'blur-in'

type RevealProps = {
  children: ReactNode
  as?: 'div' | 'section' | 'article' | 'header' | 'aside'
  variant?: RevealVariant
  delay?: number
  stagger?: number
  once?: boolean
  threshold?: number
  rootMargin?: string
  className?: string
}

export function Reveal({
  children,
  as: Tag = 'div',
  variant = 'fade-up',
  delay = 0,
  stagger = 0,
  once = true,
  threshold = 0.12,
  rootMargin = '0px 0px -8% 0px',
  className = '',
}: RevealProps) {
  const ref = useRef<HTMLElement>(null)
  const enabled = isLandingAnimationEnabled()
  useScrollReveal(ref, { once, threshold, rootMargin })
  const staggerStyle = stagger > 0 ? { '--reveal-stagger': `${stagger}ms` } as CSSProperties : undefined
  return (
    <Tag
      ref={ref as never}
      className={`landing-reveal reveal-${variant}${enabled ? '' : ' reveal-disabled'} ${className}`.trim()}
      style={{ ...staggerStyle, transitionDelay: enabled && delay ? `${delay}ms` : '0ms' }}
    >
      {children}
    </Tag>
  )
}
