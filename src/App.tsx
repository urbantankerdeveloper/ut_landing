import { AppShell } from './app/AppShell'
import { AppProviders } from './providers/AppProviders'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import './styles/app.scss'

export default function App() {
  return <AppErrorBoundary><AppProviders><AppShell /></AppProviders></AppErrorBoundary>
}
