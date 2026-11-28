import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, type AdminEmailTemplate } from '../api/admin'
import { adminQueryKeys, useAdminEmailTemplates } from '../hooks/useAdminData'
import { Modal } from '../components/Modal'
import { adminEntitiesContent as c } from '../content/admin-entities'

const copy = c.emailTemplates
const placeholderPattern = /\{\{(\w+)\}\}/g
type Draft = Pick<AdminEmailTemplate, 'templateKey' | 'subject' | 'body' | 'allowedVariables'>

function placeholdersIn(value: string) {
  return [...new Set([...value.matchAll(placeholderPattern)].map((match) => match[1] ?? ''))]
}

export function AdminEmailTemplatesScreen({ onNotice }: { onNotice: (message: string) => void }) {
  const query = useAdminEmailTemplates()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [formError, setFormError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (current: Draft) => adminApi.updateEmailTemplate(current.templateKey, {
      subject: current.subject.trim(),
      body: current.body.trim(),
    }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: adminQueryKeys.emailTemplates })
      setDraft(null)
      onNotice(copy.saved(saved.templateKey))
    },
    onError: (error) => setFormError(error instanceof Error ? error.message : copy.saveFailed),
  })

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft) return
    const unknown = placeholdersIn(`${draft.subject}\n${draft.body}`)
      .filter((name) => !draft.allowedVariables.includes(name))
    if (unknown.length) {
      setFormError(copy.unknownPlaceholders(unknown.map((name) => copy.placeholderToken(name)).join(c.common.listSeparator)))
      return
    }
    setFormError(null)
    save.mutate(draft)
  }

  if (query.isLoading) return <section className="admin-view-panel" role="status"><h2>{copy.loading}</h2></section>
  if (query.isError) return <section className="admin-view-panel" role="alert"><h2>{copy.unavailable}</h2><button className="button button-primary" onClick={() => void query.refetch()}>{copy.retry}</button></section>

  const templates = query.data ?? []

  return (
    <section className="admin-view-panel admin-email-templates">
      <div className="view-panel-heading">
        <div><p className="eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2></div>
      </div>
      <p className="admin-sms-note">{copy.note}</p>
      <div className="admin-entity-list">
        {templates.map((template) => (
          <article key={template.templateKey}>
            <div className="admin-entity-copy">
              <b>{template.templateKey}</b>
              <p>{template.subject}</p>
              <small>{copy.meta(template.isActive ? copy.active : copy.inactive, new Date(template.updatedAt).toLocaleString('en-IN'))}</small>
            </div>
            <button className="entity-status-button" onClick={() => {
              setFormError(null)
              setDraft({
                templateKey: template.templateKey,
                subject: template.subject,
                body: template.body,
                allowedVariables: template.allowedVariables,
              })
            }}>{copy.edit}</button>
          </article>
        ))}
        {!templates.length && <div className="admin-empty-state">{copy.empty}</div>}
      </div>

      {draft && (
        <Modal title={copy.editTitle(draft.templateKey)} onClose={() => setDraft(null)}>
          <form className="modal-form" onSubmit={submit}>
            <label>
              {copy.subject}
              <input required maxLength={200} value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} />
            </label>
            <label>
              {copy.messageBody}
              <textarea required rows={10} maxLength={12000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
            </label>
            <div className="admin-sms-variables">
              <span>{copy.placeholders}</span>
              {draft.allowedVariables.map((name) => <code key={name}>{copy.placeholderToken(name)}</code>)}
            </div>
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
