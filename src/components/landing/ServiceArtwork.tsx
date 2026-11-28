import { useState } from 'react'

export type ServiceArtworkSlot =
  | 'services-hero' | 'water-tanker' | 'sewage-septic' | 'empty-tanker'
  | 'rmc-mixer' | 'borewell' | 'tank-cleaning'

type Props = { slot: ServiceArtworkSlot; className?: string; eager?: boolean; alt?: string }


function ArtworkSvg({ slot, className }: { slot: ServiceArtworkSlot; className?: string }) {
  const variant = slot
  const vehicle = variant === 'rmc-mixer'
    ? <><path d="M48 126h64l14-42h58l16 42h18v20H48z" fill="#eefcf9"/><circle cx="78" cy="148" r="18" fill="#163c3a"/><circle cx="180" cy="148" r="18" fill="#163c3a"/><path d="M126 84h74l-14 42h-60z" fill="#27b5a8"/></>
    : variant === 'borewell'
      ? <><path d="M90 145V52h16v93M106 52l64 93M106 52l-42 93" stroke="#163c3a" strokeWidth="10"/><path d="M48 145h180v16H48z" fill="#f0c978"/></>
      : variant === 'tank-cleaning'
        ? <><circle cx="92" cy="82" r="18" fill="#f0c978"/><circle cx="156" cy="92" r="16" fill="#f0c978"/><path d="M58 145v-42h68v42M122 145v-28h68v28" fill="#27b5a8"/><path d="M82 103h20v42H82zM146 117h20v28h-20z" fill="#163c3a"/></>
        : <><path d="M35 112h145l22 20v18H35z" fill="#eefcf9"/><ellipse cx="120" cy="112" rx="72" ry="42" fill="#27b5a8"/><path d="M48 112h144" stroke="#163c3a" strokeWidth="8"/><circle cx="70" cy="150" r="18" fill="#163c3a"/><circle cx="176" cy="150" r="18" fill="#163c3a"/><path d="M180 132h42v18h-42z" fill="#f0c978"/></>

  return (
    <svg className={className} viewBox="0 0 320 180" role="img" aria-label={`${slot} illustrated fallback`} preserveAspectRatio="xMidYMid slice">
      <defs><linearGradient id="sky" x2="0" y2="1"><stop stopColor="#8ed8cf"/><stop offset="1" stopColor="#eefcf9"/></linearGradient></defs>
      <rect width="320" height="180" fill="url(#sky)"/><circle cx="260" cy="38" r="20" fill="#f0c978"/>
      <path d="M0 112c45-30 82-18 130 0 44 17 88-22 190 4v64H0z" fill="#5a9b82"/>
      <rect y="150" width="320" height="30" fill="#163c3a"/>{vehicle}
    </svg>
  )
}

export function ServiceArtwork({ slot, className = '', eager = false, alt = '' }: Props) {
  const [photoFailed, setPhotoFailed] = useState(false)
  const base = `/assets/landing/${slot}`
  return (
    <div className={`service-artwork ${className}`} style={{ background: '#163c3a' }}>
      {!photoFailed ? (
        <picture>
          <source type="image/avif" srcSet={`${base}-640.avif 640w, ${base}-960.avif 960w, ${base}-1280.avif 1280w, ${base}-1920.avif 1920w`} sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 1920px" />
          <source type="image/webp" srcSet={`${base}-640.webp 640w, ${base}-960.webp 960w, ${base}-1280.webp 1280w, ${base}-1920.webp 1920w`} sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 1920px" />
          <img src={`${base}-1920.webp`} width={1920} height={1080} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} decoding="async" alt={alt} onError={() => setPhotoFailed(true)} />
        </picture>
      ) : <ArtworkSvg slot={slot} className="service-artwork-svg" />}
    </div>
  )
}
