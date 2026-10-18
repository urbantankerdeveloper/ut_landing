import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, ImagePlus, Plus, Truck, UserRound, X } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'

type ResourceKind = 'vehicle' | 'driver'
type Resource = { id: number; name: string; detail: string; active: boolean }
const initialResources: Record<ResourceKind, Resource[]> = demoDataEnabled ? {
  vehicle: [{ id: 1, name: 'TN 38 AB 4120', detail: '12 KL tanker · Chennai', active: true }, { id: 2, name: 'TN 09 CD 1811', detail: '9 KL tanker · Maintenance due', active: false }],
  driver: [{ id: 1, name: 'Arun Kumar', detail: 'Assigned to TN 38 AB 4120', active: true }, { id: 2, name: 'Sanjay R', detail: 'Documents pending review', active: false }],
} : { vehicle: [], driver: [] }

export function ResourcePanel({ kind }: { kind: ResourceKind }) {
  const [resources, setResources] = useState(initialResources[kind])
  const [modalOpen, setModalOpen] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const label = kind === 'vehicle' ? 'vehicle' : 'driver'
  const Icon = kind === 'vehicle' ? Truck : UserRound
  function toggle(id: number) { setResources((current) => current.map((resource) => resource.id === id ? { ...resource, active: !resource.active } : resource)) }
  function handlePhoto(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setPhotoPreview(String(reader.result)); reader.readAsDataURL(file) }
  function addResource(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get(kind === 'vehicle' ? 'registration' : 'fullName') || '').trim(); const detail = kind === 'vehicle' ? `${String(form.get('capacity'))} · ${String(form.get('serviceArea'))}` : `${String(form.get('phone'))} · ${String(form.get('licenseNumber'))}`; if (!name || !detail || !form.get('photo')) return; setResources((current) => [...current, { id: Date.now(), name, detail, active: true }]); setPhotoPreview(null); setModalOpen(false) }
  function closeModal() { setPhotoPreview(null); setModalOpen(false) }
  return <section className="workspace-view-panel"><div className="view-panel-heading"><div><p className="eyebrow">{kind === 'vehicle' ? 'MY VEHICLES' : 'DRIVERS'}</p><h2>{kind === 'vehicle' ? 'Fleet availability and compliance.' : 'People assigned to your fleet.'}</h2></div><button className="button button-primary" onClick={() => setModalOpen(true)}><Plus size={15} /> Add {label}</button></div><div className="interactive-resource-list">{resources.map((resource) => <article className="interactive-resource" key={resource.id}><span className="resource-icon"><Icon size={18} /></span><div><b>{resource.name}</b><p>{resource.detail}</p></div><span className={`resource-status ${resource.active ? 'is-active' : 'is-inactive'}`}>{resource.active ? 'Active' : 'Inactive'}</span><button className="status-toggle" onClick={() => toggle(resource.id)} aria-pressed={resource.active}>{resource.active ? 'Set inactive' : 'Set active'}</button></article>)}</div>{modalOpen && <Modal title={`Add ${label}`} onClose={closeModal}><form className="modal-form registration-form" onSubmit={addResource}><p className="modal-required-note">All fields are required unless marked optional.</p>{kind === 'vehicle' ? <><div className="modal-form-row"><Field label="Registration number"><input name="registration" required placeholder="TN 38 AB 4120" autoFocus /></Field><Field label="Vehicle type"><select name="vehicleType" required defaultValue=""><option value="" disabled>Select type</option><option>Water tanker</option><option>Sewage tanker</option><option>RMC mixer truck</option><option>Empty tanker</option></select></Field></div><div className="modal-form-row"><Field label="Capacity"><input name="capacity" required placeholder="12 KL" /><FieldHint>Example: 6 KL, 9 KL, 12 KL</FieldHint></Field><Field label="Service area"><input name="serviceArea" required placeholder="Chennai, OMR" /></Field></div><div className="modal-form-row"><Field label="Insurance expiry"><input name="insuranceExpiry" required type="date" /></Field><Field label="Permit expiry"><input name="permitExpiry" required type="date" /></Field></div></> : <><div className="modal-form-row"><Field label="Full name"><input name="fullName" required placeholder="Enter driver name" autoFocus /></Field><Field label="Phone number"><input name="phone" required type="tel" inputMode="numeric" placeholder="10-digit phone number" /></Field></div><div className="modal-form-row"><Field label="License number"><input name="licenseNumber" required placeholder="TN-0120260000000" /></Field><Field label="License expiry"><input name="licenseExpiry" required type="date" /></Field></div><Field label="Residential address"><textarea name="address" required rows={3} placeholder="Full address with locality and pincode" /><FieldHint>Use the address shown on the driver's proof.</FieldHint></Field><Field label="Emergency contact"><input name="emergencyContact" required placeholder="Name and phone number" /></Field></>}<PhotoField preview={photoPreview} onChange={handlePhoto} requiredLabel={kind === 'vehicle' ? 'Vehicle photo' : 'Driver photo'} /><button className="button button-primary button-large" type="submit">Add {label} <Check size={15} /></button></form></Modal>}</section>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label>{label}{children}</label> }
function FieldHint({ children }: { children: ReactNode }) { return <small className="field-hint">{children}</small> }
function PhotoField({ preview, onChange, requiredLabel }: { preview: string | null; onChange: (event: React.ChangeEvent<HTMLInputElement>) => void; requiredLabel: string }) { return <label className="photo-field">{requiredLabel}<span className="photo-upload-box">{preview ? <img src={preview} alt="Selected upload preview" /> : <><ImagePlus size={22} /><b>Upload photo</b><small>JPG or PNG · max 5 MB</small></>}<input name="photo" required type="file" accept="image/jpeg,image/png" onChange={onChange} /></span></label> }

export function ServiceRequestPanel() {
  const [modalOpen, setModalOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setModalOpen(false); setSubmitted(true) }
  return <section className="workspace-view-panel"><div className="view-panel-heading"><div><p className="eyebrow">SUPPORT & COMPLAINTS</p><h2>We are here when the details matter.</h2></div><button className="button button-primary" onClick={() => setModalOpen(true)}><Plus size={15} /> New service request</button></div><div className="support-request-list"><article><span className="resource-icon"><Check size={18} /></span><div><b>UT-2388 delivery question</b><p>Resolved · Updated yesterday</p></div><span className="resource-status is-active">Resolved</span></article><article><span className="resource-icon"><ArrowRight size={18} /></span><div><b>Need help with a booking?</b><p>Open a new request and our team will follow up.</p></div><button className="text-button" onClick={() => setModalOpen(true)}>Start <ArrowRight size={14} /></button></article></div>{submitted && <p className="workspace-notice-global" role="status">Service request submitted. Support will follow up shortly.</p>}{modalOpen && <Modal title="New service request" onClose={() => setModalOpen(false)}><form className="modal-form" onSubmit={submit}><Field label="Subject"><input name="subject" required placeholder="What do you need help with?" autoFocus /></Field><div className="modal-form-row"><Field label="Booking reference"><input name="booking" placeholder="Optional · UT-2408" /></Field><Field label="Priority"><select name="priority" defaultValue="normal"><option value="normal">Normal</option><option value="urgent">Urgent</option></select></Field></div><Field label="Message"><textarea name="message" rows={4} required placeholder="Tell us what happened and what you need next." /></Field><button className="button button-primary button-large" type="submit">Submit service request <ArrowRight size={15} /></button></form></Modal>}</section>
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLElement>(null)
  const titleId = useId()
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')
    ;(firstFocusable ?? dialogRef.current)?.focus()
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown); previousFocus?.focus() }
  }, [])
  return <div className="modal-backdrop-new" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section ref={dialogRef} className="modal-new" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={titleId}><button className="modal-close-new" type="button" onClick={onClose} aria-label="Close dialog"><X size={17} aria-hidden="true" /></button><p className="eyebrow">URBAN TANKER</p><h2 id={titleId}>{title}</h2>{children}</section></div>
}
