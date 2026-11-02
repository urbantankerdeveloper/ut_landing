import { createBrowserRouter, Navigate } from 'react-router'
import { AppShell } from '../app/AppShell'
import { AppErrorFallback } from '../components/AppErrorBoundary'
import { ScreenRenderer, TrackingRoute, WorkspaceRoute } from '../components/ScreenRenderer'

// Screens are lazy-loaded inside ScreenRenderer. The shell stays mounted while the route changes.
// Deep links work because the Node server and .htaccess send index.html for any path that is not a file.
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <AppErrorFallback />,
    children: [
      { index: true, element: <ScreenRenderer screen="home" /> },
      { path: 'services', element: <ScreenRenderer screen="services" /> },
      { path: 'subscriptions', element: <ScreenRenderer screen="subscriptions" /> },
      { path: 'booking', element: <ScreenRenderer screen="booking" /> },
      { path: 'yearly-contract', element: <ScreenRenderer screen="yearly-contract" /> },
      { path: 'coupons', element: <ScreenRenderer screen="coupons" /> },
      { path: 'tracking', element: <ScreenRenderer screen="tracking" /> },
      { path: 'partner', element: <ScreenRenderer screen="partner" /> },
      { path: 'terms', element: <ScreenRenderer screen="terms" /> },
      { path: 'policy', element: <ScreenRenderer screen="policy" /> },
      { path: 'about', element: <ScreenRenderer screen="about" /> },
      { path: 'account', element: <ScreenRenderer screen="account" /> },
      { path: 'login', element: <ScreenRenderer screen="login" /> },
      { path: 'workspace/:role', element: <WorkspaceRoute /> },
      { path: 'track/:token', element: <TrackingRoute /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
