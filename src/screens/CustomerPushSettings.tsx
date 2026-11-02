import { useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { useCustomerPushSubscription } from '../hooks/useCustomerData'
import { customerContent as c } from '../content/customer'

export function CustomerPushSettings({ onNotice }: { onNotice: (message: string) => void }) {
  const [enabled, setEnabled] = useState(false)
  const push = useCustomerPushSubscription()
  function toggle() { push.mutate(!enabled, { onSuccess: (next) => { setEnabled(next); onNotice(next ? c.pushSettings.enabled : c.pushSettings.disabled) }, onError: (error) => onNotice(error instanceof Error ? error.message : c.pushSettings.updateFailed) }) }
  return <section className="workspace-view-panel customer-operation-panel customer-push-settings"><div><p className="eyebrow">{c.pushSettings.eyebrow}</p><h3>{c.pushSettings.title}</h3><p>{c.pushSettings.intro}</p></div><button className="button button-quiet" disabled={push.isPending} onClick={toggle}>{enabled ? <BellOff size={15} /> : <Bell size={15} />}{enabled ? c.pushSettings.disable : c.pushSettings.enable}</button></section>
}
