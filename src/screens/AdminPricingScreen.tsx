import { useState, type FormEvent } from 'react'
import { adminApi, type AdminService, type AdminServicePricingHistory } from '../api/admin'
import { useAdminServices } from '../hooks/useAdminData'
import { adminOperationsContent as c } from '../content/admin-operations'

type Draft = {
  id?: string
  code: string
  name: string
  price: number
  from: string
  to: string
  capacityOptions: string
  detailOptions: string
  waterTypeOptions: string
  tankerCountOptions: string
  optionSurchargesPaise: string
}

type HistoryView = { service: AdminService; entries: AdminServicePricingHistory[] }

const emptyDraft: Draft = {
  code: '',
  name: '',
  price: 0,
  from: '',
  to: '',
  capacityOptions: '',
  detailOptions: '',
  waterTypeOptions: '',
  tankerCountOptions: '',
  optionSurchargesPaise: '{}',
}

function effectiveWindow(config: Record<string, unknown> | null) {
  const from = typeof config?.effectiveFrom === 'string' ? config.effectiveFrom : ''
  const to = typeof config?.effectiveTo === 'string' ? config.effectiveTo : ''
  return from || to ? `${from || '—'} ${c.pricing.to} ${to || '—'}` : c.pricing.noEffectiveWindow
}

function formattedPrice(amountPaise: number) {
  return `INR ${(amountPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function AdminPricingScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const query = useAdminServices()
  const [editing, setEditing] = useState<Draft>(emptyDraft)
  const [history, setHistory] = useState<HistoryView | null>(null)
  const [historyLoadingId, setHistoryLoadingId] = useState<string | null>(null)

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (editing.from && editing.to && editing.from > editing.to) {
      onNotice(c.pricing.notices.invalidRange)
      return
    }

    const values = (input: string) => input.split('\n').map((item) => item.trim()).filter(Boolean)
    let optionSurchargesPaise: Record<string, Record<string, number>>
    try {
      optionSurchargesPaise = JSON.parse(editing.optionSurchargesPaise) as Record<string, Record<string, number>>
      if (!optionSurchargesPaise || Array.isArray(optionSurchargesPaise) || typeof optionSurchargesPaise !== 'object') throw new Error('Expected an object')
    } catch {
      onNotice(c.pricing.notices.invalidSurcharges)
      return
    }

    try {
      await adminApi.saveService({
        code: editing.code || undefined,
        name: editing.name,
        basePricePaise: editing.price,
        isActive: true,
        effectiveFrom: editing.from || undefined,
        effectiveTo: editing.to || undefined,
        capacityOptions: values(editing.capacityOptions),
        detailOptions: values(editing.detailOptions),
        waterTypeOptions: values(editing.waterTypeOptions),
        tankerCountOptions: values(editing.tankerCountOptions),
        optionSurchargesPaise,
      }, editing.id)
      setEditing(emptyDraft)
      setHistory(null)
      await query.refetch()
      onNotice(c.pricing.notices.saved)
    } catch {
      onNotice(c.pricing.notices.saveFailed)
    }
  }

  async function showHistory(service: AdminService) {
    setHistoryLoadingId(service.id)
    try {
      setHistory({ service, entries: await adminApi.servicePricingHistory(service.id) })
    } catch {
      onNotice(c.pricing.notices.historyFailed)
    } finally {
      setHistoryLoadingId(null)
    }
  }

  function editService(service: AdminService) {
    setHistory(null)
    setEditing({
      id: service.id,
      code: service.code,
      name: service.name,
      price: service.base_price_paise,
      from: service.config?.effectiveFrom ?? '',
      to: service.config?.effectiveTo ?? '',
      capacityOptions: service.config?.capacityOptions?.join('\n') ?? '',
      detailOptions: service.config?.detailOptions?.join('\n') ?? '',
      waterTypeOptions: service.config?.waterTypeOptions?.join('\n') ?? '',
      tankerCountOptions: service.config?.tankerCountOptions?.join('\n') ?? '',
      optionSurchargesPaise: JSON.stringify(service.config?.optionSurchargesPaise ?? {}, null, 2),
    })
  }

  if (query.isLoading) return <section className="admin-view-panel" role="status"><h2>{c.pricing.loading}</h2></section>
  if (query.isError) return <section className="admin-view-panel" role="alert"><h2>{c.pricing.unavailable}</h2><button className="button button-primary" onClick={() => query.refetch()}>{c.common.retry}</button></section>

  return (
    <section className="admin-view-panel">
      <div className="view-panel-heading">
        <div><p className="eyebrow">{c.pricing.eyebrow}</p><h2>{c.pricing.title}</h2></div>
      </div>
      <form className="modal-form" onSubmit={(event) => void save(event)}>
        <div className="modal-form-row">
          <label>{c.pricing.code}<input required value={editing.code} disabled={Boolean(editing.id)} onChange={(event) => setEditing({ ...editing, code: event.target.value })} /></label>
          <label>{c.pricing.name}<input required value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
        </div>
        <label>{c.pricing.basePrice}<input type="number" min="0" step="1" required value={editing.price} onChange={(event) => setEditing({ ...editing, price: Number(event.target.value) })} /></label>
        <div className="modal-form-row">
          <label>{c.pricing.effectiveFrom}<input type="date" value={editing.from} onChange={(event) => setEditing({ ...editing, from: event.target.value })} /></label>
          <label>{c.pricing.effectiveTo}<input type="date" value={editing.to} onChange={(event) => setEditing({ ...editing, to: event.target.value })} /></label>
        </div>
        <p>{c.pricing.optionsIntro}</p>
        <div className="modal-form-row">
          <label>{c.pricing.capacity}<textarea value={editing.capacityOptions} onChange={(event) => setEditing({ ...editing, capacityOptions: event.target.value })} /></label>
          <label>{c.pricing.details}<textarea value={editing.detailOptions} onChange={(event) => setEditing({ ...editing, detailOptions: event.target.value })} /></label>
        </div>
        <div className="modal-form-row">
          <label>{c.pricing.waterType}<textarea value={editing.waterTypeOptions} onChange={(event) => setEditing({ ...editing, waterTypeOptions: event.target.value })} /></label>
          <label>{c.pricing.tankerCount}<textarea value={editing.tankerCountOptions} onChange={(event) => setEditing({ ...editing, tankerCountOptions: event.target.value })} /></label>
        </div>
        <label>{c.pricing.surcharges}
          <textarea value={editing.optionSurchargesPaise} placeholder={c.pricing.surchargesPlaceholder} onChange={(event) => setEditing({ ...editing, optionSurchargesPaise: event.target.value })} />
          <small>{c.pricing.surchargesHint}</small>
        </label>
        <button className="button button-primary" type="submit">{c.pricing.save}</button>
      </form>

      {history && (
        <section className="admin-view-panel" aria-live="polite">
          <div className="view-panel-heading">
            <div><p className="eyebrow">{c.pricing.historyEyebrow}</p><h3>{c.pricing.historyTitle(history.service.name)}</h3></div>
            <button className="button button-quiet" type="button" onClick={() => setHistory(null)}>{c.pricing.closeHistory}</button>
          </div>
          {history.entries.length ? history.entries.map((entry) => (
            <article className="admin-entity-row" key={entry.id}>
              <div className="admin-entity-copy">
                <b>{entry.action === 'created' ? c.pricing.created : c.pricing.updated}</b>
                <p>{c.pricing.historyChangedBy(entry.changed_by_name ?? c.pricing.unknownEditor)} · {new Date(entry.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
                <p>{entry.old_base_price_paise === null
                  ? c.pricing.initialPrice(formattedPrice(entry.new_base_price_paise))
                  : c.pricing.priceChange(formattedPrice(entry.old_base_price_paise), formattedPrice(entry.new_base_price_paise))}</p>
                <small>{c.pricing.effectiveWindow(effectiveWindow(entry.new_config))}</small>
              </div>
            </article>
          )) : <div className="admin-empty-state">{c.pricing.historyEmpty}</div>}
        </section>
      )}

      <div className="admin-entity-list">
        {(query.data ?? []).map((service) => (
          <article key={service.id}>
            <div className="admin-entity-copy">
              <b>{service.name}</b>
              <p>{c.pricing.meta(service.code, (service.base_price_paise / 100).toLocaleString('en-IN'))}</p>
            </div>
            <button className="entity-status-button" type="button" onClick={() => editService(service)}>{c.pricing.edit}</button>
            <button className="entity-status-button" type="button" disabled={historyLoadingId === service.id} onClick={() => void showHistory(service)}>
              {historyLoadingId === service.id ? c.pricing.historyLoading : c.pricing.viewHistory}
            </button>
          </article>
        ))}
        {!(query.data ?? []).length && <div className="admin-empty-state">{c.pricing.empty}</div>}
      </div>
    </section>
  )
}
