import { useMemo, useState, type FormEvent } from 'react'
import { Check, Edit3, Plus, Search, Trash2, UserRound, Users } from 'lucide-react'
import { Modal } from './WorkspaceInteractive'
import { demoDataEnabled } from '../constants/demo'
import { adminEntitiesContent as c } from '../content/admin-entities'

const demo = c.entities.demo

type Entity = 'vendors' | 'drivers' | 'customers'
type RecordItem = { id: number; name: string; detail: string; status: 'Active' | 'Inactive' | 'Pending review' }
type Props = { entity: Entity; onNotice: (message: string) => void }
const initialData: Record<Entity, RecordItem[]> = demoDataEnabled ? {
  vendors: [...demo.records.vendors],
  drivers: [...demo.records.drivers],
  customers: [...demo.records.customers],
} : { vendors: [], drivers: [], customers: [] }
const config: Record<Entity, { eyebrow: string; title: string; singular: string; icon: typeof Users; fields: readonly string[] }> = {
  vendors: { ...demo.config.vendors, icon: Users },
  drivers: { ...demo.config.drivers, icon: UserRound },
  customers: { ...demo.config.customers, icon: Users },
}

export function AdminEntityManager({ entity, onNotice }: Props) {
  const data = config[entity]
  const Icon = data.icon
  const [records, setRecords] = useState(initialData[entity])
  const [query, setQuery] = useState('')
  const [modal, setModal] = useState<'add' | 'edit' | 'delete' | null>(null)
  const [selected, setSelected] = useState<RecordItem | null>(null)
  const filtered = useMemo(() => records.filter((record) => `${record.name} ${record.detail}`.toLowerCase().includes(query.toLowerCase())), [records, query])
  const close = () => { setModal(null); setSelected(null) }
  function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const values = new FormData(event.currentTarget); const name = String(values.get('field0') || '').trim(); const primary = String(values.get('field1') || '').trim(); const services = values.getAll('services').map(String); const detail = entity === 'vendors' ? demo.vendorDetail(primary, services.join(c.common.listSeparator)) : demo.contactDetail(primary, String(values.get('field2') || '').trim()); if (!name || !primary || (entity === 'vendors' ? services.length === 0 : !values.get('field2'))) return; if (selected) setRecords((current) => current.map((record) => record.id === selected.id ? { ...record, name, detail } : record)); else setRecords((current) => [...current, { id: Date.now(), name, detail, status: 'Active' }]); close(); onNotice(selected ? demo.notices.updated(data.singular) : demo.notices.created(data.singular)) }
  function remove() { if (!selected) return; setRecords((current) => current.filter((record) => record.id !== selected.id)); close(); onNotice(demo.notices.deleted(data.singular)) }
  function toggleStatus(record: RecordItem) { setRecords((current) => current.map((item) => item.id === record.id ? { ...item, status: item.status === 'Active' ? 'Inactive' : 'Active' } : item)); onNotice(demo.notices.statusUpdated(record.name)) }
  return <section className="admin-view-panel admin-entity-manager"><div className="view-panel-heading"><div><p className="eyebrow">{data.eyebrow}</p><h2>{data.title}</h2></div><button className="button button-primary" onClick={() => setModal('add')}><Plus size={15} /> {demo.add(data.singular)}</button></div><label className="admin-entity-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={demo.search(data.singular)} aria-label={demo.search(data.singular)} /></label><div className="admin-entity-list">{filtered.map((record) => <article key={record.id}><span className="admin-record-icon"><Icon size={18} /></span><div className="admin-entity-copy"><b>{record.name}</b><p>{record.detail}</p></div><span className={`status-tag ${record.status === 'Pending review' ? 'pending' : record.status === 'Inactive' ? 'inactive' : ''}`}>{record.status}</span>{record.status !== 'Pending review' && <button className="entity-status-button" onClick={() => toggleStatus(record)}>{record.status === 'Active' ? demo.setInactive : demo.setActive}</button>}<button className="icon-action" onClick={() => { setSelected(record); setModal('edit') }} aria-label={demo.editRecord(record.name)} title={c.common.edit}><Edit3 size={15} /></button><button className="icon-action danger" onClick={() => { setSelected(record); setModal('delete') }} aria-label={demo.deleteRecord(record.name)} title={c.common.delete}><Trash2 size={15} /></button></article>)}{filtered.length === 0 && <div className="admin-empty-state">{demo.emptySearch(data.singular)}</div>}</div>{(modal === 'add' || modal === 'edit') && <Modal title={modal === 'add' ? demo.add(data.singular) : demo.editTitle(data.singular)} onClose={close}><form className="modal-form" onSubmit={save}><p className="modal-required-note">{c.common.allFieldsRequired}</p><label>{data.fields[0]}<input name="field0" required defaultValue={selected?.name} placeholder={demo.enterField(data.fields[0].toLowerCase())} /></label><label>{data.fields[1]}<input name="field1" required placeholder={demo.enterField(data.fields[1].toLowerCase())} /></label>{entity === 'vendors' ? <fieldset className="service-checkbox-fieldset"><legend>{demo.servicesLegend}</legend>{demo.services.map((service) => <label className="service-checkbox" key={service.id}><input type="checkbox" name="services" value={service.label} /><span>{service.label}</span></label>)}</fieldset> : <label>{data.fields[2]}<input name="field2" required placeholder={demo.enterField(data.fields[2].toLowerCase())} /></label>}<button className="button button-primary button-large" type="submit"><Check size={15} /> {demo.save(data.singular)}</button></form></Modal>}{modal === 'delete' && selected && <Modal title={demo.deleteTitle(data.singular)} onClose={close}><div className="admin-delete-dialog"><p>{demo.deleteConfirm.prefix}<b>{selected.name}</b>{demo.deleteConfirm.suffix}</p><div><button className="button button-quiet" onClick={close}>{c.common.cancel}</button><button className="button button-danger" onClick={remove}><Trash2 size={15} /> {c.common.delete}</button></div></div></Modal>}</section>
}
