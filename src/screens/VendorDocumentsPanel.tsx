import type { FormEvent } from 'react'
import { FileText, Upload } from 'lucide-react'
import { demoDataEnabled } from '../constants/demo'
import { useFileUpload } from '../hooks/useFrontendFeatures'
import { useCreateVendorDocument, useVendorDocuments } from '../hooks/useVendorData'

export function VendorDocumentsPanel({ onNotice }: { onNotice: (message: string) => void }) {
  const query = useVendorDocuments()
  const create = useCreateVendorDocument()
  const upload = useFileUpload()
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const values = new FormData(event.currentTarget); const file = values.get('file'); const documentType = String(values.get('documentType') || ''); const expiresOn = String(values.get('expiresOn') || '') || undefined; if (!(file instanceof File) || !file.size || !documentType) return; try { const signed = await upload.upload(file, 'vendor', documentType); await create.mutateAsync({ documentType, objectKey: signed.path, expiresOn }); event.currentTarget.reset(); onNotice('Document uploaded for approval.') } catch { onNotice('Document upload failed.') } }
  if (!demoDataEnabled && query.isLoading) return <section className="workspace-view-panel"><h2>Loading documents...</h2></section>
  if (!demoDataEnabled && query.isError) return <section className="workspace-view-panel"><h2>Documents are unavailable.</h2><button className="button button-primary" onClick={() => query.refetch()}>Retry</button></section>
  return <section className="workspace-view-panel vendor-management-panel"><div className="view-panel-heading"><div><p className="eyebrow">DOCUMENTS</p><h2>Keep compliance records current.</h2></div></div><form className="customer-inline-form" onSubmit={submit}><label>Document type<select name="documentType" defaultValue="vehicle_registration"><option value="vehicle_registration">Vehicle registration</option><option value="insurance">Insurance</option><option value="driver_licence">Driver licence</option><option value="permit">Operating permit</option></select></label><label>Expires on<input name="expiresOn" type="date" required /></label><label>File<input name="file" type="file" accept="image/*,.pdf" required /></label><button className="button button-primary" disabled={upload.progress > 0 && upload.progress < 100 || create.isPending}><Upload size={15} /> {upload.progress > 0 && upload.progress < 100 ? `${upload.progress}% uploading` : 'Upload document'}</button></form><div className="vendor-document-list">{(query.data ?? []).map((document) => <article key={document.id}><FileText size={18} /><div><b>{document.document_type}</b><p>Expires {document.expires_on ?? 'No expiry date'}</p></div><span className="status-tag">{document.verification}</span></article>)}{!query.data?.length && <div className="admin-empty-state">No documents uploaded yet.</div>}</div></section>
}
