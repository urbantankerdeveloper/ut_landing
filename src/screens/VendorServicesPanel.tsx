import { useState } from 'react'
import { Gauge } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useCreateVendorService, useUpdateVendorServiceAvailability, useVendorServices } from '../hooks/useVendorData'
import { vendorContent as c } from '../content/vendor'

export function VendorServicesPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const [pendingCode, setPendingCode] = useState<string | null>(null)
  const query = useVendorServices()
  const update = useUpdateVendorServiceAvailability()
  const create = useCreateVendorService()
  if (!demoDataEnabled && query.isLoading) return <section className="workspace-view-panel"><h2>{c.services.loading}</h2></section>
  if (!demoDataEnabled && query.isError) return <section className="workspace-view-panel"><h2>{c.services.unavailable}</h2><button className="button button-primary" onClick={() => query.refetch()}>{c.common.retry}</button></section>
  const services = (query.data ?? []) as Array<{ code?: string; name?: string; description?: string; base_price_paise?: number; is_active?: boolean; vendor_enabled?: boolean }>
  return <section className="workspace-view-panel vendor-management-panel"><div className="view-panel-heading"><div><p className="eyebrow">{c.services.eyebrow}</p><h2>{c.services.heading}</h2></div></div><form className="vendor-create-form" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); create.mutate({ code: String(values.get('code')), name: String(values.get('name')), description: String(values.get('description') || ''), basePricePaise: Math.round(Number(values.get('basePrice')) * 100) }, { onSuccess: () => { event.currentTarget.reset(); onNotice(c.services.created) }, onError: () => onNotice(c.services.createFailed) }) }}><label>{c.services.code}<input name="code" placeholder={c.services.codePlaceholder} required /></label><label>{c.services.name}<input name="name" placeholder={c.services.namePlaceholder} required /></label><label>{c.services.description}<input name="description" placeholder={c.services.descriptionPlaceholder} /></label><label>{c.services.price}<input name="basePrice" type="number" min="0" step="0.01" required /></label><button className="button button-primary" disabled={create.isPending}>{c.services.addService}</button></form><div className="vendor-service-list">{services.map((service) => { const code = service.code ?? service.name ?? ''; const enabled = service.vendor_enabled ?? service.is_active ?? false; return <article key={code}><span><Gauge size={18} /></span><div><b>{service.name ?? code}</b><p>{service.description ?? c.services.fallbackDescription}</p><strong>{c.common.inr((Number(service.base_price_paise ?? 0) / 100).toLocaleString('en-IN'))}</strong></div><button className="button button-quiet" disabled={pendingCode === code} onClick={() => { setPendingCode(code); update.mutate({ code, enabled: !enabled }, { onSuccess: () => { setPendingCode(null); onNotice(c.services.availabilityUpdated(service.name ?? code)) }, onError: () => { setPendingCode(null); onNotice(c.services.availabilityFailed) } }) }}>{pendingCode === code ? c.services.updating : enabled ? c.services.pause : c.services.enable}</button></article> })}</div>{!services.length && <div className="admin-empty-state">{c.services.empty}</div>}</section>
}

