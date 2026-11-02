import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Check, ImagePlus, Plus, Truck, UserRound, X } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { workspaceContent as w } from '../content/workspace'

type ResourceKind = 'vehicle' | 'driver'
type Resource = { id: number; name: string; detail: string; active: boolean }
const initialResources: Record<ResourceKind, Resource[]> = demoDataEnabled ? {
  vehicle: [...w.resources.demo.vehicles],
  driver: [...w.resources.demo.drivers],
} : { vehicle: [], driver: [] }

export function ResourcePanel({ kind }: { kind: ResourceKind }) {
  const [resources, setResources] = useState(initialResources[kind])
  const [modalOpen, setModalOpen] = useState(false)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const label = w.resources.labels[kind]
  const Icon = kind === 'vehicle' ? Truck : UserRound
  function toggle(id: number) { setResources((current) => current.map((resource) => resource.id === id ? { ...resource, active: !resource.active } : resource)) }
  function handlePhoto(event: React.ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setPhotoPreview(String(reader.result)); reader.readAsDataURL(file) }
  function addResource(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); const name = String(form.get(kind === 'vehicle' ? 'registration' : 'fullName') || '').trim(); const detail = kind === 'vehicle' ? `${String(form.get('capacity'))} · ${String(form.get('serviceArea'))}` : `${String(form.get('phone'))} · ${String(form.get('licenseNumber'))}`; if (!name || !detail || !form.get('photo')) return; setResources((current) => [...current, { id: Date.now(), name, detail, active: true }]); setPhotoPreview(null); setModalOpen(false) }
  function closeModal() { setPhotoPreview(null); setModalOpen(false) }
  return <section className="workspace-view-panel"><div className="view-panel-heading"><div><p className="eyebrow">{w.resources.eyebrows[kind]}</p><h2>{w.resources.titles[kind]}</h2></div><button className="button button-primary" onClick={() => setModalOpen(true)}><Plus size={15} /> {w.resources.add(label)}</button></div><div className="interactive-resource-list">{resources.map((resource) => <article className="interactive-resource" key={resource.id}><span className="resource-icon"><Icon size={18} /></span><div><b>{resource.name}</b><p>{resource.detail}</p></div><span className={`resource-status ${resource.active ? 'is-active' : 'is-inactive'}`}>{resource.active ? w.resources.active : w.resources.inactive}</span><button className="status-toggle" onClick={() => toggle(resource.id)} aria-pressed={resource.active}>{resource.active ? w.resources.setInactive : w.resources.setActive}</button></article>)}</div>{modalOpen && <Modal title={w.resources.add(label)} onClose={closeModal}><form className="modal-form registration-form" onSubmit={addResource}><p className="modal-required-note">{w.resources.requiredNote}</p>{kind === 'vehicle' ? <><div className="modal-form-row"><Field label={w.resources.vehicle.registrationNumber}><input name="registration" required placeholder={w.resources.vehicle.registrationPlaceholder} autoFocus /></Field><Field label={w.resources.vehicle.vehicleType}><select name="vehicleType" required defaultValue=""><option value="" disabled>{w.resources.vehicle.selectType}</option>{w.resources.vehicle.vehicleTypes.map((vehicleType) => <option key={vehicleType}>{vehicleType}</option>)}</select></Field></div><div className="modal-form-row"><Field label={w.resources.vehicle.capacity}><input name="capacity" required placeholder={w.resources.vehicle.capacityPlaceholder} /><FieldHint>{w.resources.vehicle.capacityHint}</FieldHint></Field><Field label={w.resources.vehicle.serviceArea}><input name="serviceArea" required placeholder={w.resources.vehicle.serviceAreaPlaceholder} /></Field></div><div className="modal-form-row"><Field label={w.resources.vehicle.insuranceExpiry}><input name="insuranceExpiry" required type="date" /></Field><Field label={w.resources.vehicle.permitExpiry}><input name="permitExpiry" required type="date" /></Field></div></> : <><div className="modal-form-row"><Field label={w.resources.driver.fullName}><input name="fullName" required placeholder={w.resources.driver.fullNamePlaceholder} autoFocus /></Field><Field label={w.resources.driver.phone}><input name="phone" required type="tel" inputMode="numeric" placeholder={w.resources.driver.phonePlaceholder} /></Field></div><div className="modal-form-row"><Field label={w.resources.driver.licenseNumber}><input name="licenseNumber" required placeholder={w.resources.driver.licenseNumberPlaceholder} /></Field><Field label={w.resources.driver.licenseExpiry}><input name="licenseExpiry" required type="date" /></Field></div><Field label={w.resources.driver.residentialAddress}><textarea name="address" required rows={3} placeholder={w.resources.driver.addressPlaceholder} /><FieldHint>{w.resources.driver.addressHint}</FieldHint></Field><Field label={w.resources.driver.emergencyContact}><input name="emergencyContact" required placeholder={w.resources.driver.emergencyContactPlaceholder} /></Field></>}<PhotoField preview={photoPreview} onChange={handlePhoto} requiredLabel={kind === 'vehicle' ? w.resources.vehicle.photo : w.resources.driver.photo} /><button className="button button-primary button-large" type="submit">{w.resources.add(label)} <Check size={15} /></button></form></Modal>}</section>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label>{label}{children}</label> }
function FieldHint({ children }: { children: ReactNode }) { return <small className="field-hint">{children}</small> }
function PhotoField({ preview, onChange, requiredLabel }: { preview: string | null; onChange: (event: React.ChangeEvent<HTMLInputElement>) => void; requiredLabel: string }) { return <label className="photo-field">{requiredLabel}<span className="photo-upload-box">{preview ? <img src={preview} alt={w.resources.photo.previewAlt} /> : <><ImagePlus size={22} /><b>{w.resources.photo.upload}</b><small>{w.resources.photo.hint}</small></>}<input name="photo" required type="file" accept="image/jpeg,image/png" onChange={onChange} /></span></label> }

export function ServiceRequestPanel() {
  const [modalOpen, setModalOpen] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setModalOpen(false); setSubmitted(true) }
  return <section className="workspace-view-panel"><div className="view-panel-heading"><div><p className="eyebrow">{w.serviceRequest.eyebrow}</p><h2>{w.serviceRequest.title}</h2></div><button className="button button-primary" onClick={() => setModalOpen(true)}><Plus size={15} /> {w.serviceRequest.newRequest}</button></div><div className="support-request-list"><article><span className="resource-icon"><Check size={18} /></span><div><b>{w.serviceRequest.demoTitle}</b><p>{w.serviceRequest.demoDetail}</p></div><span className="resource-status is-active">{w.serviceRequest.resolved}</span></article><article><span className="resource-icon"><ArrowRight size={18} /></span><div><b>{w.serviceRequest.needHelpTitle}</b><p>{w.serviceRequest.needHelpDetail}</p></div><button className="text-button" onClick={() => setModalOpen(true)}>{w.serviceRequest.start} <ArrowRight size={14} /></button></article></div>{submitted && <p className="workspace-notice-global" role="status">{w.serviceRequest.submitted}</p>}{modalOpen && <Modal title={w.serviceRequest.modalTitle} onClose={() => setModalOpen(false)}><form className="modal-form" onSubmit={submit}><Field label={w.serviceRequest.subject}><input name="subject" required placeholder={w.serviceRequest.subjectPlaceholder} autoFocus /></Field><div className="modal-form-row"><Field label={w.serviceRequest.bookingReference}><input name="booking" placeholder={w.serviceRequest.bookingPlaceholder} /></Field><Field label={w.serviceRequest.priority}><select name="priority" defaultValue="normal">{w.serviceRequest.priorityOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field></div><Field label={w.serviceRequest.message}><textarea name="message" rows={4} required placeholder={w.serviceRequest.messagePlaceholder} /></Field><button className="button button-primary button-large" type="submit">{w.serviceRequest.submit} <ArrowRight size={15} /></button></form></Modal>}</section>
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
  return <div className="modal-backdrop-new" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section ref={dialogRef} className="modal-new" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={titleId}><button className="modal-close-new" type="button" onClick={onClose} aria-label={w.common.closeDialog}><X size={17} aria-hidden="true" /></button><p className="eyebrow">{w.modal.eyebrow}</p><h2 id={titleId}>{title}</h2>{children}</section></div>
}
