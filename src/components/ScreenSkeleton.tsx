type Props = { workspace: boolean }

export function ScreenSkeleton({ workspace }: Props) {
  return workspace ? <WorkspaceSkeleton /> : <PublicSkeleton />
}

export function LoadingStatus() {
  return <span className="skeleton-status" role="status" aria-live="polite">Loading your workspace…</span>
}

export function WorkspaceContentSkeleton() {
  return <div className="workspace-content-skeleton" aria-label="Loading workspace content"><SkeletonBlock className="skeleton-eyebrow" /><SkeletonBlock className="skeleton-heading" /><SkeletonBlock className="skeleton-copy" /><div className="skeleton-metrics">{Array.from({ length: 3 }, (_, index) => <SkeletonBlock className="skeleton-metric" key={index} />)}</div><div className="skeleton-panels"><SkeletonBlock className="skeleton-panel-large" /><SkeletonBlock className="skeleton-panel-side" /></div></div>
}

function WorkspaceSkeleton() {
  return <section className="screen-skeleton workspace-skeleton" aria-label="Loading workspace"><aside className="skeleton-sidebar"><SkeletonBlock className="skeleton-logo" /><SkeletonBlock className="skeleton-caption" />{Array.from({ length: 8 }, (_, index) => <SkeletonBlock className="skeleton-nav-item" key={index} />)}</aside><div className="skeleton-workspace-main"><div className="skeleton-topbar"><SkeletonBlock className="skeleton-topbar-title" /><SkeletonBlock className="skeleton-avatar" /></div><div className="skeleton-content"><SkeletonBlock className="skeleton-eyebrow" /><SkeletonBlock className="skeleton-heading" /><SkeletonBlock className="skeleton-copy" /><div className="skeleton-metrics">{Array.from({ length: 3 }, (_, index) => <SkeletonBlock className="skeleton-metric" key={index} />)}</div><div className="skeleton-panels"><SkeletonBlock className="skeleton-panel-large" /><SkeletonBlock className="skeleton-panel-side" /></div></div></div></section>
}

function PublicSkeleton() {
  return <section className="screen-skeleton public-skeleton" aria-label="Loading page"><div className="skeleton-public-hero"><div><SkeletonBlock className="skeleton-eyebrow" /><SkeletonBlock className="skeleton-public-heading" /><SkeletonBlock className="skeleton-public-copy" /><SkeletonBlock className="skeleton-button" /></div><SkeletonBlock className="skeleton-hero-card" /></div><div className="skeleton-public-grid">{Array.from({ length: 6 }, (_, index) => <SkeletonBlock className="skeleton-card" key={index} />)}</div></section>
}

function SkeletonBlock({ className }: { className: string }) { return <span className={`skeleton-block ${className}`} aria-hidden="true" /> }
