export function getServiceFallback(photoLoaded: boolean, svgLoaded = true): 'photo' | 'svg' | 'gradient' {
  if (photoLoaded) return 'photo'
  if (svgLoaded) return 'svg'
  return 'gradient'
}
