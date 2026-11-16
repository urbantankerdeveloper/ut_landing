import { useState } from 'react'
import { Gauge } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useUpdateVendorServiceAvailability, useVendorServices } from '../hooks/useVendorData'
import { vendorContent as c } from '../content/vendor'

export function VendorServicesPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const query = useVendorServices()
  const update = useUpdateVendorServiceAvailability()
  if (!demoDataEnabled && query.isLoading) return <section className="workspace-view-panel" role="status"><h2>{c.services.loading}</h2></section>
  if (!demoDataEnabled && query.isError) return <section className="workspace-view-panel" role="alert"><h2>{c.services.unavailable}</h2><button className="button button-primary" onClick={() => query.refetch()}>{c.common.retry}</button></section>
  const services = (query.data ?? []) as Array<{ code?: string; name?: string; description?: string; base_price_paise?: number; is_active?: boolean; vendor_enabled?: boolean }>
  return <section className="workspace-view-panel vendor-management-panel"><div className="view-panel-heading"><div><p className="eyebrow">{c.services.eyebrow}</p><h2>{c.services.heading}</h2></div></div><div className="vendor-service-list">{services.map((service) => { const code = service.code ?? service.name ?? ''; const enabled = service.vendor_enabled ?? service.is_active ?? false; return <article key={code}><span><Gauge size={18} /></span><div><b>{service.name ?? code}</b><p>{service.description ?? c.services.fallbackDescription}</p><strong>{c.common.inr((Number(service.base_price_paise ?? 0) / 100).toLocaleString('en-IN'))}</strong></div><button className="button button-quiet" disabled={pendingCode === code} onClick={() => { setPendingCode(code); update.mutate({ code, enabled: !enabled }, { onSuccess: () => { setPendingCode(null); onNotice(c.services.availabilityUpdated(service.name ?? code)) }, onError: () => { setPendingCode(null); onNotice(c.services.availabilityFailed) } }) }}>{pendingCode === code ? c.services.updating : enabled ? c.services.pause : c.services.enable}</button></article> })}</div>{!services.length && <div className="admin-empty-state">{c.services.empty}</div>}</section>
}

