import { CircleAlert, CircleCheck, Info, X } from 'lucide-react'
import { feedbackContent as c } from '../content/feedback'
import { useToastStore, type ToastTone } from '../stores/toastStore'

const icons: Record<ToastTone, typeof Info> = { success: CircleCheck, error: CircleAlert, info: Info }

// Errors use role="alert" so they interrupt; other tones are announced politely.
export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)
  return <div className="toast-region" aria-label={c.toast.regionLabel}>
    {toasts.map((toast) => {
      const Icon = icons[toast.tone]
      return <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
        <Icon className="toast-icon" size={20} aria-hidden="true" />
        <p className="toast-message">{toast.message}</p>
        <button className="toast-dismiss" type="button" aria-label={c.toast.dismiss} onClick={() => dismiss(toast.id)}><X size={16} aria-hidden="true" /></button>
      </div>
    })}
  </div>
}
