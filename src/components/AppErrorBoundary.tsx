import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'

function Fallback({ resetErrorBoundary }: FallbackProps) {
  return <main className="error-boundary-screen" role="alert"><div><p className="eyebrow">TEMPORARY ISSUE</p><h1>We could not load this screen.</h1><p>Try again, or return to the Urban Tanker home screen.</p><div><button className="button button-primary" onClick={resetErrorBoundary}>Try again</button><button className="button button-quiet" onClick={() => window.location.assign('/')}>Return home</button></div></div></main>
}

export function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary FallbackComponent={Fallback} onReset={() => window.location.reload()}>{children}</ErrorBoundary>
}
