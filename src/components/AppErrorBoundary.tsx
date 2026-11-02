import { ErrorBoundary, type FallbackProps } from 'react-error-boundary'
import { chromeContent as c } from '../content/chrome'

function Fallback({ resetErrorBoundary }: FallbackProps) {
  return <main className="error-boundary-screen" role="alert"><div><p className="eyebrow">{c.errorBoundary.eyebrow}</p><h1>{c.errorBoundary.title}</h1><p>{c.errorBoundary.copy}</p><div><button className="button button-primary" onClick={resetErrorBoundary}>{c.errorBoundary.tryAgain}</button><button className="button button-quiet" onClick={() => window.location.assign('/')}>{c.errorBoundary.returnHome}</button></div></div></main>
}

export function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary FallbackComponent={Fallback} onReset={() => window.location.reload()}>{children}</ErrorBoundary>
}
