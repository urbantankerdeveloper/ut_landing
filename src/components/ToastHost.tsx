import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { feedbackContent as c } from '../content/feedback'
import { useToastStore, type Toast, type ToastTone } from '../stores/toastStore'

const icons: Record<ToastTone, typeof Info> = { success: CircleCheck, error: CircleAlert, info: Info }

// Errors use role="alert" so they interrupt; other tones are announced politely.
// Toasts with action buttons (new-order offers) sit bottom-right so they stay out of the way of the top-right notices.
export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)
  const renderToast = (toast: Toast) => {
    const Icon = icons[toast.tone]
    return <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <Icon className="toast-icon" size={20} aria-hidden="true" />
      <p className="toast-message">{toast.message}</p>
      <button className="toast-dismiss" type="button" aria-label={c.toast.dismiss} onClick={() => dismiss(toast.id)}><X size={16} aria-hidden="true" /></button>
      {toast.actions && toast.actions.length > 0 && <div className="toast-actions">
        {toast.actions.map((action) => <button key={action.label} className={`toast-action ${action.variant === 'quiet' ? 'toast-action-quiet' : ''}`} type="button" onClick={action.onSelect}>{action.label}</button>)}
      </div>}
    </div>
  }
  const offers = toasts.filter((toast) => toast.actions && toast.actions.length > 0)
  const notices = toasts.filter((toast) => !(toast.actions && toast.actions.length > 0))
  return <>
    <div className="toast-region" aria-label={c.toast.regionLabel}>{notices.map(renderToast)}</div>
    {offers.length > 0 && <div className="toast-region toast-region-bottom" aria-label={c.toast.regionLabel}>{offers.map(renderToast)}</div>}
  </>
}
