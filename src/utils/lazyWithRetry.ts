import { lazy, type ComponentType } from 'react'

export const CHUNK_RELOAD_FLAG = 'urban-tanker-chunk-reload'

// A deploy replaces the hashed chunk files. A tab opened before the deploy then fails to load a screen on click.
// Reload once to pick up the new build; a second failure is shown to the user by the error boundary.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const module = await load()
      sessionStorage.removeItem(CHUNK_RELOAD_FLAG)
      return module
    } catch (error) {
      if (sessionStorage.getItem(CHUNK_RELOAD_FLAG)) throw error
      sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1')
      window.location.reload()
      return new Promise<{ default: T }>(() => {})
    }
  })
}
