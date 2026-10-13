import { useState } from 'react'
import { Bell, BellOff } from 'lucide-react'
import { useCustomerPushSubscription } from '../hooks/useCustomerData'

export function CustomerPushSettings({ onNotice }: { onNotice: (message: string) => void }) {
  const [enabled, setEnabled] = useState(false)
  const push = useCustomerPushSubscription()
  function toggle() { push.mutate(!enabled, { onSuccess: (next) => { setEnabled(next); onNotice(next ? 'Browser notifications enabled.' : 'Browser notifications disabled.') }, onError: (error) => onNotice(error instanceof Error ? error.message : 'Browser notifications could not be updated.') }) }
  return <section className="workspace-view-panel customer-operation-panel customer-push-settings"><div><p className="eyebrow">NOTIFICATION PREFERENCES</p><h3>Browser alerts</h3><p>Get booking and delivery updates even when this tab is closed.</p></div><button className="button button-quiet" disabled={push.isPending} onClick={toggle}>{enabled ? <BellOff size={15} /> : <Bell size={15} />}{enabled ? 'Disable alerts' : 'Enable alerts'}</button></section>
}
