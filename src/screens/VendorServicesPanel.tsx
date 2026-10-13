import { Gauge } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useUpdateVendorServiceAvailability, useVendorServices } from '../hooks/useVendorData'

export function VendorServicesPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const query = useVendorServices()
  const update = useUpdateVendorServiceAvailability()
  if (!demoDataEnabled && query.isLoading) return <section className="workspace-view-panel"><h2>Loading services...</h2></section>
  if (!demoDataEnabled && query.isError) return <section className="workspace-view-panel"><h2>Services are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>
  const services = (query.data ?? []) as Array<{ code?: string; name?: string; description?: string; base_price_paise?: number; is_active?: boolean; vendor_enabled?: boolean }>
  return <section className="workspace-view-panel vendor-management-panel"><div className="view-panel-heading"><div><p className="eyebrow">MY SERVICES</p><h2>Control your available services.</h2></div></div><div className="vendor-service-list">{services.map((service) => { const code = service.code ?? service.name ?? ''; const enabled = service.vendor_enabled ?? service.is_active ?? false; return <article key={code}><span><Gauge size={18} /></span><div><b>{service.name ?? code}</b><p>{service.description ?? 'Available service'}</p><strong>INR {(Number(service.base_price_paise ?? 0) / 100).toLocaleString('en-IN')}</strong></div><button className="button button-quiet" disabled={update.isPending} onClick={() => update.mutate({ code, enabled: !enabled }, { onSuccess: () => onNotice(`${service.name ?? code} availability updated.`), onError: () => onNotice('Service availability could not be updated.') })}>{enabled ? 'Pause' : 'Enable'}</button></article> })}</div>{!services.length && <div className="admin-empty-state">No services found.</div>}</section>
}
