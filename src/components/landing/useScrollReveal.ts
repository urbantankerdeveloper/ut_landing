import { useEffect } from 'react'

type RevealOptions = { once?: boolean; threshold?: number; rootMargin?: string }
const observers = new Map<string, IntersectionObserver>()
const callbacks = new WeakMap<Element, Set<(visible: boolean) => void>>()

export function isLandingAnimationEnabled() {
  return import.meta.env.VITE_LANDING_SCROLL_ANIMATIONS !== 'false'
}

export function useScrollReveal(
  ref: React.RefObject<Element | null>,
  { once = true, threshold = 0.12, rootMargin = '0px 0px -8% 0px' }: RevealOptions = {},
) {
  useEffect(() => {
    const element = ref.current
    if (!element || typeof IntersectionObserver === 'undefined') return
    const key = `${threshold}:${rootMargin}`
    let observer = observers.get(key)
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          callbacks.get(entry.target)?.forEach((callback) => callback(entry.isIntersecting))
        }
      }, { threshold, rootMargin })
      observers.set(key, observer)
    }
    const callback = (visible: boolean) => {
      if (visible) {
        element.classList.add('is-revealed')
        if (once) observer?.unobserve(element)
      } else if (!once) element.classList.remove('is-revealed')
    }
    const registered = callbacks.get(element) ?? new Set()
    registered.add(callback)
    callbacks.set(element, registered)
    observer.observe(element)
    return () => {
      observer?.unobserve(element)
      registered.delete(callback)
      if (registered.size === 0) callbacks.delete(element)
    }
  }, [once, rootMargin, threshold, ref])
}
