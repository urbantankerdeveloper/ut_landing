import { useState, type FormEvent } from 'react'
import { Pencil, Plus, Search, ShieldCheck, Trash2, Truck, UserRound, Users } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '../api/admin'
import { adminQueryKeys, useAdminCustomers, useAdminDrivers, useAdminVehicles, useAdminVendors } from '../hooks/useAdminData'
import { Modal } from './WorkspaceInteractive'

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
  const vendors = useAdminVendors(); const customers = useAdminCustomers(); const drivers = useAdminDrivers(); const vehicles = useAdminVehicles(); const query = entity === 'vendors' ? vendors : entity === 'customers' ? customers : entity === 'drivers' ? drivers : vehicles; const client = useQueryClient()
  const updateVendor = useMutation({ mutationFn: ({ id, status }: { id: string; status: 'approved' | 'rejected' | 'suspended' }) => adminApi.approveVendor(id, status), onSuccess: () => client.invalidateQueries({ queryKey: adminQueryKeys.vendors }) })
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
      onNotice(`${entity === 'fleet' ? 'Vehicle' : entity.slice(0, -1)} record created.`)
    },
    onError: () => onNotice(`${entity === 'fleet' ? 'Vehicle' : entity.slice(0, -1)} could not be created.`),
  })
  const remove = useMutation({ mutationFn: (id: string) => entity === 'vendors' ? adminApi.deleteVendor(id) : entity === 'customers' ? adminApi.deleteCustomer(id) : entity === 'drivers' ? adminApi.deleteDriver(id) : adminApi.deleteVehicle(id), onSuccess: () => { void query.refetch(); onNotice('Record deleted.') } })
  const rows: Row[] = (query.data ?? []).map((raw) => { const item = raw as unknown as Record<string, unknown>; if (entity === 'vendors') return { id: String(item.id), name: String(item.business_name ?? item.name ?? 'Unnamed vendor'), detail: `${item.phone_e164 ?? 'No phone'} · ${item.service_zone ?? 'No service zone'}`, status: String(item.verification ?? 'pending') }; if (entity === 'customers') return { id: String(item.id), name: String(item.full_name ?? 'Unnamed customer'), detail: String(item.phone_e164 ?? 'No phone'), status: 'active' }; if (entity === 'drivers') return { id: String(item.id), name: String(item.name ?? 'Unnamed driver'), detail: `${item.mobile_e164 ?? 'No phone'} · ${item.licence_number ?? 'No licence'}`, status: String(item.verification ?? 'pending'), active: Boolean(item.is_active) }; return { id: String(item.id), name: String(item.registration_number ?? 'Unnamed vehicle'), detail: `${item.capacity_litres ?? 0} litres · ${item.vendor_id ?? 'Unassigned'}`, status: String(item.verification ?? 'pending'), active: Boolean(item.is_active) } }).filter((row) => `${row.name} ${row.detail}`.toLowerCase().includes(search.toLowerCase()))
  function setStatus(row: Row) { const next = row.status === 'approved' ? 'suspended' : 'approved'; if (entity === 'vendors') updateVendor.mutate({ id: row.id, status: next }); if (entity === 'drivers') updateDriver.mutate({ id: row.id, verification: next }); if (entity === 'fleet') updateVehicle.mutate({ id: row.id, verification: next }); onNotice('Approval status submitted.') }
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
  function saveEdit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!editing) return; const value = String(new FormData(event.currentTarget).get('name') || '').trim(); if (!value) return; const promise = entity === 'vendors' ? adminApi.updateVendor(editing.id, { businessName: value }) : entity === 'customers' ? adminApi.updateCustomer(editing.id, { name: value }) : entity === 'drivers' ? adminApi.updateDriver(editing.id, { name: value }) : adminApi.updateVehicle(editing.id, { registrationNumber: value }); void promise.then(() => { setEditing(null); void query.refetch(); onNotice('Record updated.') }).catch(() => onNotice('Record could not be updated.')) }
  const Icon = entity === 'vendors' ? Users : entity === 'customers' ? UserRound : entity === 'drivers' ? UserRound : Truck
  if (query.isLoading) return <section className="admin-view-panel"><h2>Loading {entity}...</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>{entity} are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>
  return <section className="admin-view-panel admin-entity-manager"><div className="view-panel-heading"><div><p className="eyebrow">{entity === 'fleet' ? 'TANKER FLEET' : entity.toUpperCase()}</p><h2>Live {entity === 'fleet' ? 'fleet' : entity} records.</h2></div><button className="button button-primary" onClick={() => setAdding(true)}><Plus size={15} /> Add {entity === 'fleet' ? 'vehicle' : entity.slice(0, -1)}</button></div><label className="admin-entity-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${entity}`} aria-label={`Search ${entity}`} /></label><div className="admin-entity-list">{rows.map((row) => <article key={row.id}><span className="admin-record-icon"><Icon size={18} /></span><div className="admin-entity-copy"><b>{row.name}</b><p>{row.detail}</p></div><span className="status-tag">{row.status}</span>{entity !== 'customers' && <button className="entity-status-button" onClick={() => setStatus(row)}><ShieldCheck size={14} /> {row.status === 'approved' ? 'Suspend' : 'Approve'}</button>}<button className="icon-action" aria-label={`Edit ${row.name}`} onClick={() => setEditing(row)}><Pencil size={15} /></button><button className="icon-action danger" aria-label={`Delete ${row.name}`} disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${row.name}?`)) remove.mutate(row.id) }}><Trash2 size={15} /></button></article>)}{!rows.length && <div className="admin-empty-state">No matching records found.</div>}</div>
    {adding && <Modal title={`Add ${entity === 'fleet' ? 'vehicle' : entity.slice(0, -1)}`} onClose={() => setAdding(false)}><form className="modal-form" onSubmit={createRecord}>
      {entity === 'vendors' && <>
        <label>Contact name<input name="name" required autoFocus /></label>
        <label>Email<input name="email" type="email" required /></label>
        <label>Temporary password<input name="password" type="password" minLength={8} required /></label>
        <label>Phone<input name="phone" type="tel" required /></label>
        <label>Business name<input name="businessName" required /></label>
        <label>Service zone<input name="serviceZone" required /></label>
      </>}
      {entity === 'customers' && <>
        <label>Name<input name="name" required autoFocus /></label>
        <label>Email<input name="email" type="email" required /></label>
        <label>Temporary password<input name="password" type="password" minLength={8} required /></label>
        <label>Phone<input name="phone" type="tel" required /></label>
      </>}
      {(entity === 'drivers' || entity === 'fleet') && <label>Vendor<select name="vendorId" required defaultValue="" disabled={vendors.isLoading || vendors.isError}><option value="" disabled>{vendors.isError ? 'Vendor list unavailable' : vendors.isLoading ? 'Loading vendors...' : 'Select vendor'}</option>{(vendors.data ?? []).map((raw) => { const vendor = raw as unknown as Record<string, unknown>; return <option key={raw.id} value={raw.id}>{String(vendor.business_name ?? vendor.name ?? 'Unnamed vendor')} · {String(vendor.verification ?? vendor.status ?? 'pending')}</option> })}</select>{vendors.isError && <small role="alert">Could not load vendors. Retry the vendor list before creating this record.</small>}{!vendors.isLoading && !vendors.isError && !vendors.data?.length && <small role="alert">Create a vendor before adding a driver or vehicle.</small>}</label>}
      {entity === 'drivers' && <>
        <label>Driver name<input name="name" required autoFocus /></label>
        <label>Mobile<input name="phone" type="tel" required /></label>
        <label>Licence number<input name="licence" required /></label>
      </>}
      {entity === 'fleet' && <>
        <label>Registration number<input name="registration" required autoFocus /></label>
        <label>Capacity (litres)<input name="capacity" type="number" min="1" required /></label>
      </>}
      <button className="button button-primary button-large" type="submit" disabled={create.isPending || ((entity === 'drivers' || entity === 'fleet') && (!vendors.data?.length || vendors.isError))}><Plus size={15} /> {create.isPending ? 'Creating...' : 'Create record'}</button>
    </form></Modal>}
    {editing && <Modal title={`Edit ${editing.name}`} onClose={() => setEditing(null)}><form className="modal-form" onSubmit={saveEdit}><label>{entity === 'fleet' ? 'Registration number' : 'Name'}<input name="name" defaultValue={editing.name} required autoFocus /></label><button className="button button-primary button-large" type="submit">Save changes</button></form></Modal>}</section>
}
