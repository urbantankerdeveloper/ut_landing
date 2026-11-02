import { RouterProvider } from 'react-router/dom'
import { AppProviders } from './providers/AppProviders'
import { AppErrorBoundary } from './components/AppErrorBoundary'
import { router } from './routing/routes'
import './styles/app.scss'

export default function App() {
  return <AppErrorBoundary><AppProviders><RouterProvider router={router} /></AppProviders></AppErrorBoundary>
}
