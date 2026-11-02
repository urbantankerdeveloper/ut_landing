import { useState } from 'react'
import { Camera } from 'lucide-react'
import { adminApi } from '../api/admin'
import { Modal } from '../components/Modal'
import { adminEntitiesContent as c } from '../content/admin-entities'

const copy = c.customerSelfie

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
      onNotice(copy.unavailable)
    } finally {
      setLoading(false)
    }
  }

  return <>
    <button className="icon-action" aria-label={copy.view(customerName)} disabled={loading} onClick={() => void open()}><Camera size={15} /></button>
    {url && <Modal title={copy.title(customerName)} onClose={() => setUrl(null)}><img src={url} alt={copy.alt(customerName)} className="admin-selfie-image" /><p className="meta">{copy.note}</p></Modal>}
  </>
}
