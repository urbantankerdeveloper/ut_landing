import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { adminApi, type AdminSmsTemplate } from '../api/admin'
import { adminQueryKeys, useAdminSmsTemplates } from '../hooks/useAdminData'
import { Modal } from './WorkspaceInteractive'

type Draft = { templateKey: string; body: string; isActive: boolean; msg91TemplateId: string; isBuiltIn: boolean; allowedVariables: string[] | null }
const emptyDraft: Draft = { templateKey: '', body: '', isActive: true, msg91TemplateId: '', isBuiltIn: false, allowedVariables: null }
const templateKeyPattern = /^[a-z][a-z0-9_]{2,63}$/
const placeholderPattern = /\{\{(\w+)\}\}/g

// GSM-7 text: 160 characters per single SMS, 153 per part when the message is split.
function segmentCount(length: number) {
  if (length === 0) return 0
  return length <= 160 ? 1 : Math.ceil(length / 153)
}

function placeholdersIn(body: string) {
  return [...new Set([...body.matchAll(placeholderPattern)].map((match) => match[1] ?? ''))]
}

export function AdminSmsTemplatesScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const query = useAdminSmsTemplates()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (current: Draft) =>
      isNew
        ? adminApi.createSmsTemplate({ templateKey: current.templateKey.trim(), body: current.body.trim(), isActive: current.isActive, msg91TemplateId: current.msg91TemplateId.trim() })
        : adminApi.updateSmsTemplate(current.templateKey, { body: current.body.trim(), isActive: current.isActive, msg91TemplateId: current.msg91TemplateId.trim() }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.smsTemplates })
      setDraft(null)
      onNotice(`SMS template "${saved.templateKey}" saved.`)
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : 'SMS template could not be saved.'),
  })

  function openNew() {
    setIsNew(true)
    setFormError(null)
    setDraft({ ...emptyDraft })
  }

  function openEdit(template: AdminSmsTemplate) {
    setIsNew(false)
    setFormError(null)
    setDraft({ templateKey: template.templateKey, body: template.body, isActive: template.isActive, msg91TemplateId: template.msg91TemplateId ?? '', isBuiltIn: template.isBuiltIn, allowedVariables: template.allowedVariables })
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    if (isNew && !templateKeyPattern.test(draft.templateKey.trim())) {
      setFormError('Key must start with a letter and use lowercase letters, numbers and underscores (3-64 characters).')
      return
    }
    if (!draft.body.trim()) {
      setFormError('Message body is required.')
      return
    }
    if (draft.allowedVariables) {
      const unknown = placeholdersIn(draft.body).filter((name) => !draft.allowedVariables!.includes(name))
      if (unknown.length) {
        setFormError(`Remove unknown placeholder(s): ${unknown.map((name) => `{{${name}}}`).join(', ')}`)
        return
      }
    }
    setFormError(null)
    save.mutate(draft)
  }

  if (query.isLoading) return <section className="admin-view-panel"><h2>Loading SMS templates...</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>SMS templates are unavailable.</h2><button className="button button-primary" onClick={() => void query.refetch()}>Retry</button></section>

  const templates = query.data ?? []

  return (
    <section className="admin-view-panel admin-sms-templates">
      <div className="view-panel-heading">
        <div>
          <p className="eyebrow">SMS TEMPLATES</p>
          <h2>Customer and vendor messages.</h2>
        </div>
        <button className="button button-primary" onClick={openNew}><Plus size={16} /> Add template</button>
      </div>
      <p className="admin-sms-note">Wording must match the DLT-approved text in MSG91 exactly, or messages will not be delivered in India.</p>

      <div className="admin-entity-list">
        {templates.map((template) => (
          <article key={template.templateKey}>
            <div className="admin-entity-copy">
              <b>{template.templateKey}</b>
              <p>{template.body}</p>
              <small>
                {template.isActive ? 'Active' : 'Inactive'} · {template.isBuiltIn ? 'Built-in' : 'Custom'} · Updated {new Date(template.updatedAt).toLocaleString('en-IN')}
              </small>
            </div>
            <button className="entity-status-button" onClick={() => openEdit(template)}>Edit</button>
          </article>
        ))}
        {!templates.length && <div className="admin-empty-state">No SMS templates yet.</div>}
      </div>

      {draft && (
        <Modal title={isNew ? 'Add SMS template' : `Edit ${draft.templateKey}`} onClose={() => setDraft(null)}>
          <form className="modal-form" onSubmit={submit}>
            <label>
              Template key
              <input required disabled={!isNew} value={draft.templateKey} placeholder="e.g. order_cancelled" onChange={(event) => setDraft({ ...draft, templateKey: event.target.value })} />
              {isNew && <small>The backend sends a message only when code uses this key.</small>}
            </label>
            <label>
              Message body
              <textarea required rows={5} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
              <small>
                {draft.body.length} characters · {segmentCount(draft.body.length)} SMS segment(s)
              </small>
            </label>
            <div className="admin-sms-variables">
              <span>Placeholders:</span>
              {draft.allowedVariables
                ? draft.allowedVariables.map((name) => <code key={name}>{`{{${name}}}`}</code>)
                : <small>Use {'{{name}}'} style placeholders.</small>}
            </div>
            <label>
              MSG91 template ID
              <input value={draft.msg91TemplateId} placeholder={draft.isBuiltIn ? 'Blank uses the env config ID' : 'From your DLT-approved MSG91 template'} onChange={(event) => setDraft({ ...draft, msg91TemplateId: event.target.value })} />
              <small>Needed before a new template can be sent through MSG91.</small>
            </label>
            <label className="admin-sms-active">
              <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
              Active
            </label>
            {formError && <p className="admin-form-error" role="alert">{formError}</p>}
            <div className="modal-form-row">
              <button className="button button-quiet" type="button" onClick={() => setDraft(null)}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save template'}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
