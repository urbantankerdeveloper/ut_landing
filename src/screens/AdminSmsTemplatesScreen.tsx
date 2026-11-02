import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { adminApi, type AdminSmsTemplate } from '../api/admin'
import { adminQueryKeys, useAdminSmsTemplates } from '../hooks/useAdminData'
import { Modal } from '../components/Modal'
import { adminEntitiesContent as c } from '../content/admin-entities'

const copy = c.smsTemplates

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
      onNotice(copy.saved(saved.templateKey))
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : copy.saveFailed),
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
      setFormError(copy.keyRule)
      return
    }
    if (!draft.body.trim()) {
      setFormError(copy.bodyRequired)
      return
    }
    if (draft.allowedVariables) {
      const unknown = placeholdersIn(draft.body).filter((name) => !draft.allowedVariables!.includes(name))
      if (unknown.length) {
        setFormError(copy.unknownPlaceholders(unknown.map((name) => copy.placeholderToken(name)).join(c.common.listSeparator)))
        return
      }
    }
    setFormError(null)
    save.mutate(draft)
  }

  if (query.isLoading) return <section className="admin-view-panel"><h2>{copy.loading}</h2></section>
  if (query.isError) return <section className="admin-view-panel"><h2>{copy.unavailable}</h2><button className="button button-primary" onClick={() => void query.refetch()}>{copy.retry}</button></section>

  const templates = query.data ?? []

  return (
    <section className="admin-view-panel admin-sms-templates">
      <div className="view-panel-heading">
        <div>
          <p className="eyebrow">{copy.eyebrow}</p>
          <h2>{copy.title}</h2>
        </div>
        <button className="button button-primary" onClick={openNew}><Plus size={16} /> {copy.addTemplate}</button>
      </div>
      <p className="admin-sms-note">{copy.note}</p>

      <div className="admin-entity-list">
        {templates.map((template) => (
          <article key={template.templateKey}>
            <div className="admin-entity-copy">
              <b>{template.templateKey}</b>
              <p>{template.body}</p>
              <small>
                {copy.meta(template.isActive ? copy.active : copy.inactive, template.isBuiltIn ? copy.builtIn : copy.custom, new Date(template.updatedAt).toLocaleString('en-IN'))}
              </small>
            </div>
            <button className="entity-status-button" onClick={() => openEdit(template)}>{copy.edit}</button>
          </article>
        ))}
        {!templates.length && <div className="admin-empty-state">{copy.empty}</div>}
      </div>

      {draft && (
        <Modal title={isNew ? copy.addTitle : copy.editTitle(draft.templateKey)} onClose={() => setDraft(null)}>
          <form className="modal-form" onSubmit={submit}>
            <label>
              {copy.templateKey}
              <input required disabled={!isNew} value={draft.templateKey} placeholder={copy.templateKeyPlaceholder} onChange={(event) => setDraft({ ...draft, templateKey: event.target.value })} />
              {isNew && <small>{copy.templateKeyHelp}</small>}
            </label>
            <label>
              {copy.messageBody}
              <textarea required rows={5} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
              <small>
                {copy.counter(draft.body.length, segmentCount(draft.body.length))}
              </small>
            </label>
            <div className="admin-sms-variables">
              <span>{copy.placeholders}</span>
              {draft.allowedVariables
                ? draft.allowedVariables.map((name) => <code key={name}>{copy.placeholderToken(name)}</code>)
                : <small>{copy.placeholderHelp}</small>}
            </div>
            <label>
              {copy.msg91TemplateId}
              <input value={draft.msg91TemplateId} placeholder={draft.isBuiltIn ? copy.builtInIdPlaceholder : copy.customIdPlaceholder} onChange={(event) => setDraft({ ...draft, msg91TemplateId: event.target.value })} />
              <small>{copy.msg91Help}</small>
            </label>
            <label className="admin-sms-active">
              <input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
              {copy.active}
            </label>
            {formError && <p className="admin-form-error" role="alert">{formError}</p>}
            <div className="modal-form-row">
              <button className="button button-quiet" type="button" onClick={() => setDraft(null)}>{copy.cancel}</button>
              <button className="button button-primary" type="submit" disabled={save.isPending}>{save.isPending ? copy.saving : copy.saveTemplate}</button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  )
}
