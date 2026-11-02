import { useLayoutEffect } from 'react'
import { chromeContent as c } from '../content/chrome'
import type { ScreenId } from '../stores/navigationStore'
import { publicScreens, screenFromPath, screenPath } from './paths'

const SITE_ORIGIN = 'https://urbantanker.com'
const INDEXABLE_ROBOTS = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'

const titles: Record<ScreenId, string> = {
  home: c.appShell.documentTitles.home,
  services: c.appShell.documentTitles.services,
  subscriptions: c.appShell.documentTitles.subscriptions,
  booking: c.appShell.documentTitles.booking,
  'yearly-contract': c.appShell.documentTitles.yearlyContract,
  coupons: c.appShell.documentTitles.coupons,
  tracking: c.appShell.documentTitles.tracking,
  partner: c.appShell.documentTitles.partner,
  terms: c.appShell.documentTitles.terms,
  policy: c.appShell.documentTitles.policy,
  account: c.appShell.documentTitles.account,
  login: c.appShell.documentTitles.login,
  about: c.appShell.documentTitles.about,
  'customer-workspace': c.appShell.documentTitles.customerWorkspace,
  'vendor-workspace': c.appShell.documentTitles.vendorWorkspace,
  'admin-workspace': c.appShell.documentTitles.adminWorkspace,
  'dispatcher-workspace': c.appShell.documentTitles.dispatcherWorkspace,
}

function setHeadElement(selector: string, create: () => HTMLElement, apply: (element: HTMLElement) => void) {
  let element = document.head.querySelector<HTMLElement>(selector)
  if (!element) {
    element = create()
    document.head.appendChild(element)
  }
  apply(element)
}

function setMeta(name: string, content: string) {
  setHeadElement(`meta[name="${name}"]`, () => Object.assign(document.createElement('meta'), { name }), (element) => element.setAttribute('content', content))
}

// Sets the title, description, robots and canonical URL for the current route. Crawlers that do not run JavaScript still see the index.html defaults.
export function useDocumentMeta(pathname: string) {
  useLayoutEffect(() => {
    const screen = screenFromPath(pathname)
    const isPublic = publicScreens.has(screen) && !pathname.startsWith('/track/')
    document.title = titles[screen] ?? c.appShell.documentTitles.fallback
    setMeta('description', c.appShell.metaDescriptions[screen] ?? c.appShell.metaDescriptions.fallback)
    setMeta('robots', isPublic ? INDEXABLE_ROBOTS : 'noindex,nofollow')
    setMeta('googlebot', isPublic ? INDEXABLE_ROBOTS : 'noindex,nofollow')
    const canonicalHref = `${SITE_ORIGIN}${isPublic ? screenPath(screen) : '/'}`
    setHeadElement('link[rel="canonical"]', () => Object.assign(document.createElement('link'), { rel: 'canonical' }), (element) => element.setAttribute('href', canonicalHref))
  }, [pathname])
}
