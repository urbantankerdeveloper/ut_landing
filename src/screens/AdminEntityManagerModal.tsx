import { useState, type FormEvent } from 'react'
import { Pencil, Plus, Search, ShieldCheck, Trash2, Truck, UserRound, Users } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../api/admin'
import { adminQueryKeys, useAdminCustomers, useAdminDrivers, useAdminVehicles, useAdminVendors } from '../hooks/useAdminData'
import { Modal } from './WorkspaceInteractive'
import { adminEntitiesContent as c } from '../content/admin-entities'

const copy = c.entities.modal

type Entity = 'vendors' | 'drivers' | 'customers' | 'fleet'
type Props = { entity: Entity; onNotice: (message: string) => void }
type Row = { id: string; name: string; detail: string; status: string; active?: boolean }
type CreateInput =
  | { entity: 'vendors'; payload: Parameters<typeof adminApi.createVendor>[0] }
  | { entity: 'customers'; payload: Parameters<typeof adminApi.createCustomer>[0] }
  | { entity: 'drivers'; payload: Parameters<typeof adminApi.createDriver>[0] }
  | { entity: 'fleet'; payload: Parameters<typeof adminApi.createVehicle>[0] }

export function AdminEntityManagerModal({ entity, onNotice }: Props) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Row | null>(null)
  const [adding, setAdding] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const vendors = useAdminVendors(); const customers = useAdminCustomers(); const drivers = useAdminDrivers(); const vehicles = useAdminVehicles(); const query = entity === 'vendors' ? vendors : entity === 'customers' ? customers : entity === 'drivers' ? drivers : vehicles; const client = useQueryClient()
  const updateVendor = useMutation({ mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof adminApi.updateVendorStatus>[1] }) => adminApi.updateVendorStatus(id, payload), onSuccess: () => client.invalidateQueries({ queryKey: adminQueryKeys.vendors }) })
  const updateDriver = useMutation({ mutationFn: ({ id, verification }: { id: string; verification: 'pending' | 'approved' | 'rejected' | 'suspended' }) => adminApi.updateDriverStatus(id, verification), onSuccess: () => client.invalidateQueries({ queryKey: adminQueryKeys.drivers }) })
  const updateVehicle = useMutation({ mutationFn: ({ id, verification }: { id: string; verification: 'pending' | 'approved' | 'rejected' | 'suspended' }) => adminApi.updateVehicleStatus(id, verification), onSuccess: () => client.invalidateQueries({ queryKey: adminQueryKeys.vehicles }) })
  const create = useMutation<unknown, Error, CreateInput>({
    mutationFn: (input) => {
      if (input.entity === 'vendors') return adminApi.createVendor(input.payload)
      if (input.entity === 'customers') return adminApi.createCustomer(input.payload)
      if (input.entity === 'drivers') return adminApi.createDriver(input.payload)
      return adminApi.createVehicle(input.payload)
    },
    onSuccess: () => {
      setAdding(false)
      void query.refetch()
      onNotice(copy.notices.recordCreated(entity === 'fleet' ? copy.vehicleTitle : entity.slice(0, -1)))
    },
    onError: () => onNotice(copy.notices.recordCreateFailed(entity === 'fleet' ? copy.vehicleTitle : entity.slice(0, -1))),
  })
  const remove = useMutation({ mutationFn: (id: string) => entity === 'vendors' ? adminApi.deleteVendor(id) : entity === 'customers' ? adminApi.deleteCustomer(id) : entity === 'drivers' ? adminApi.deleteDriver(id) : adminApi.deleteVehicle(id), onSuccess: () => { setPendingDeleteId(null); void query.refetch(); onNotice(copy.notices.recordDeleted) }, onError: () => { setPendingDeleteId(null); onNotice(copy.notices.recordDeleteFailed) } })
  const rows: Row[] = (query.data ?? []).map((raw) => { const item = raw as unknown as Record<string, unknown>; if (entity === 'vendors') return { id: String(item.id), name: String(item.business_name ?? item.name ?? copy.fallbacks.unnamedVendor), detail: copy.pair(String(item.phone_e164 ?? copy.fallbacks.noPhone), String(item.service_zone ?? copy.fallbacks.noServiceZone)), status: String(item.verification ?? 'pending'), active: Boolean(item.is_online) }; if (entity === 'customers') return { id: String(item.id), name: String(item.full_name ?? copy.fallbacks.unnamedCustomer), detail: String(item.phone_e164 ?? copy.fallbacks.noPhone), status: 'active' }; if (entity === 'drivers') return { id: String(item.id), name: String(item.name ?? copy.fallbacks.unnamedDriver), detail: copy.pair(String(item.mobile_e164 ?? copy.fallbacks.noPhone), String(item.licence_number ?? copy.fallbacks.noLicence)), status: String(item.verification ?? 'pending'), active: Boolean(item.is_active) }; return { id: String(item.id), name: String(item.registration_number ?? copy.fallbacks.unnamedVehicle), detail: copy.vehicleDetail(String(item.capacity_litres ?? 0), String(item.vendor_id ?? copy.fallbacks.unassigned)), status: String(item.verification ?? 'pending'), active: Boolean(item.is_active) } }).filter((row) => `${row.name} ${row.detail}`.toLowerCase().includes(search.toLowerCase()))
  function setStatus(row: Row) { const next = row.status === 'approved' ? 'suspended' : 'approved'; const options = { onSuccess: () => { void query.refetch(); onNotice(copy.notices.approvalUpdated) }, onError: () => onNotice(copy.notices.approvalFailed) }; if (entity === 'vendors') updateVendor.mutate({ id: row.id, payload: { status: next } }, options); if (entity === 'drivers') updateDriver.mutate({ id: row.id, verification: next }, options); if (entity === 'fleet') updateVehicle.mutate({ id: row.id, verification: next }, options) }
  function setVendorOnline(row: Row) { updateVendor.mutate({ id: row.id, payload: { isOnline: !row.active } }, { onSuccess: () => { void query.refetch(); onNotice(row.active ? copy.notices.vendorInactive : copy.notices.vendorActive) }, onError: () => onNotice(row.status === 'approved' ? copy.notices.vendorAvailabilityFailed : copy.notices.approveFirst) }) }
  function createRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    if (entity === 'vendors') {
      create.mutate({ entity, payload: { email: String(values.get('email')), password: String(values.get('password')), name: String(values.get('name')), phone: String(values.get('phone')), businessName: String(values.get('businessName')), serviceZone: String(values.get('serviceZone')) } })
    } else if (entity === 'customers') {
      create.mutate({ entity, payload: { email: String(values.get('email')), password: String(values.get('password')), name: String(values.get('name')), phone: String(values.get('phone')) } })
    } else if (entity === 'drivers') {
      create.mutate({ entity, payload: { vendorId: String(values.get('vendorId')), name: String(values.get('name')), mobileE164: String(values.get('phone')), licenceNumber: String(values.get('licence')) } })
    } else {
      create.mutate({ entity, payload: { vendorId: String(values.get('vendorId')), registrationNumber: String(values.get('registration')), capacityLitres: Number(values.get('capacity')) } })
    }
  }
  function saveEdit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!editing) return; const value = String(new FormData(event.currentTarget).get('name') || '').trim(); if (!value) return; const promise = entity === 'vendors' ? adminApi.updateVendor(editing.id, { businessName: value }) : entity === 'customers' ? adminApi.updateCustomer(editing.id, { name: value }) : entity === 'drivers' ? adminApi.updateDriver(editing.id, { name: value }) : adminApi.updateVehicle(editing.id, { registrationNumber: value }); void promise.then(() => { setEditing(null); void query.refetch(); onNotice(copy.notices.recordUpdated) }).catch(() => onNotice(copy.notices.recordUpdateFailed)) }
  const Icon = entity === 'vendors' ? Users : entity === 'customers' ? UserRound : entity === 'drivers' ? UserRound : Truck
  if (query.isLoading) return <section className="admin-view-panel"><h2>{copy.loading(entity)}</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>{copy.unavailable(entity)}</h2><p role="status">{query.error instanceof Error ? query.error.message : copy.requestFailed}</p><button className="button button-primary" onClick={() => query.refetch()}>{copy.retry}</button></section>
  return <section className="admin-view-panel admin-entity-manager"><div className="view-panel-heading"><div><p className="eyebrow">{entity === 'fleet' ? copy.tankerFleet : entity.toUpperCase()}</p><h2>{copy.heading(entity === 'fleet' ? 'fleet' : entity)}</h2></div><button className="button button-primary" onClick={() => setAdding(true)}><Plus size={15} /> {copy.add(entity === 'fleet' ? copy.vehicle : entity.slice(0, -1))}</button></div><label className="admin-entity-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.search(entity)} aria-label={copy.search(entity)} /></label><div className="admin-entity-list">{rows.map((row) => <article key={row.id}><span className="admin-record-icon"><Icon size={18} /></span><div className="admin-entity-copy"><b>{row.name}</b><p>{row.detail}</p></div><span className="status-tag">{row.status}</span>{entity === 'vendors' && <><span className={`status-tag ${row.active ? '' : 'pending'}`}>{row.active ? copy.online : copy.offline}</span><button className="entity-status-button" disabled={updateVendor.isPending || (!row.active && row.status !== 'approved')} onClick={() => setVendorOnline(row)}>{row.active ? copy.setInactive : copy.setActive}</button></>}{entity !== 'customers' && <button className="entity-status-button" onClick={() => setStatus(row)}><ShieldCheck size={14} /> {row.status === 'approved' ? copy.suspend : copy.approve}</button>}<button className="icon-action" aria-label={copy.editRecord(row.name)} onClick={() => setEditing(row)}><Pencil size={15} /></button><button className="icon-action danger" aria-label={copy.deleteRecord(row.name)} disabled={pendingDeleteId === row.id} onClick={() => { if (window.confirm(copy.deleteConfirm(row.name))) { setPendingDeleteId(row.id); remove.mutate(row.id) } }}><Trash2 size={15} /></button></article>)}{!rows.length && <div className="admin-empty-state">{copy.emptyState}</div>}</div>
    {adding && <Modal title={copy.add(entity === 'fleet' ? copy.vehicle : entity.slice(0, -1))} onClose={() => setAdding(false)}><form className="modal-form" onSubmit={createRecord}>
      {entity === 'vendors' && <>
        <label>{copy.fields.contactName}<input name="name" required autoFocus /></label>
        <label>{copy.fields.email}<input name="email" type="email" required /></label>
        <label>{copy.fields.temporaryPassword}<input name="password" type="password" minLength={8} required /></label>
        <label>{copy.fields.phone}<input name="phone" type="tel" required /></label>
        <label>{copy.fields.businessName}<input name="businessName" required /></label>
        <label>{copy.fields.serviceZone}<input name="serviceZone" required /></label>
      </>}
      {entity === 'customers' && <>
        <label>{copy.fields.name}<input name="name" required autoFocus /></label>
        <label>{copy.fields.email}<input name="email" type="email" required /></label>
        <label>{copy.fields.temporaryPassword}<input name="password" type="password" minLength={8} required /></label>
        <label>{copy.fields.phone}<input name="phone" type="tel" required /></label>
      </>}
      {(entity === 'drivers' || entity === 'fleet') && <label>{copy.fields.vendor}<select name="vendorId" required defaultValue="" disabled={vendors.isLoading || vendors.isError}><option value="" disabled>{vendors.isError ? copy.vendorUnavailable : vendors.isLoading ? copy.loadingVendors : copy.selectVendor}</option>{(vendors.data ?? []).map((raw) => { const vendor = raw as unknown as Record<string, unknown>; return <option key={raw.id} value={raw.id}>{copy.vendorOption(String(vendor.business_name ?? vendor.name ?? copy.fallbacks.unnamedVendor), String(vendor.verification ?? vendor.status ?? 'pending'))}</option> })}</select>{vendors.isError && <small role="alert">{copy.couldNotLoadVendors}</small>}{!vendors.isLoading && !vendors.isError && !vendors.data?.length && <small role="alert">{copy.createVendorFirst}</small>}</label>}
      {entity === 'drivers' && <>
        <label>{copy.fields.driverName}<input name="name" required autoFocus /></label>
        <label>{copy.fields.mobile}<input name="phone" type="tel" required /></label>
        <label>{copy.fields.licence}<input name="licence" required /></label>
      </>}
      {entity === 'fleet' && <>
        <label>{copy.fields.registrationNumber}<input name="registration" required autoFocus /></label>
        <label>{copy.fields.capacity}<input name="capacity" type="number" min="1" required /></label>
      </>}
      <button className="button button-primary button-large" type="submit" disabled={create.isPending || ((entity === 'drivers' || entity === 'fleet') && (!vendors.data?.length || vendors.isError))}><Plus size={15} /> {create.isPending ? c.common.creating : c.common.createRecord}</button>
    </form></Modal>}
    {editing && <Modal title={copy.editRecord(editing.name)} onClose={() => setEditing(null)}><form className="modal-form" onSubmit={saveEdit}><label>{entity === 'fleet' ? copy.fields.registrationNumber : copy.fields.name}<input name="name" defaultValue={editing.name} required autoFocus /></label><button className="button button-primary button-large" type="submit">{copy.saveChanges}</button></form></Modal>}</section>
}
