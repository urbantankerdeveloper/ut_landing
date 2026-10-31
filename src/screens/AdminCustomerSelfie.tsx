import { useState } from 'react'
import { Camera } from 'lucide-react'
import { adminApi } from '../api/admin'
import { Modal } from './WorkspaceInteractive'

type Props = { customerId: string; customerName: string; onNotice: (message: string) => void }

export function AdminCustomerSelfie({ customerId, customerName, onNotice }: Props) {
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function open() {
    setLoading(true)
    try {
      const result = await adminApi.customerSelfie(customerId)
      setUrl(result.url)
    } catch {
      onNotice('Selfie could not be opened. It may not have been captured yet.')
    } finally {
      setLoading(false)
    }
  }

  return <>
    <button className="icon-action" aria-label={`View selfie of ${customerName}`} disabled={loading} onClick={() => void open()}><Camera size={15} /></button>
    {url && <Modal title={`${customerName} selfie`} onClose={() => setUrl(null)}><img src={url} alt={`Selfie of ${customerName}`} className="admin-selfie-image" /><p className="meta">The link expires in 5 minutes. Each view is logged.</p></Modal>}
  </>
}
