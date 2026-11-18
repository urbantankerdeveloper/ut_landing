import { useState, type FormEvent } from 'react'
import { ArrowRight, CheckCircle2 } from 'lucide-react'
import { customerApi, type CreateServiceEnquiryPayload, type ServiceEnquiryCategory } from '../api/customer'
import { Modal } from '../components/Modal'

const serviceNames: Record<ServiceEnquiryCategory, string> = {
  empty_tanker: 'Empty Tanker',
  rmc: 'RMC Concrete Mixer',
  borewell: 'Borewell Services',
}

function localDateInputValue() {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

export function ServiceEnquiryDialog({
  category,
  onClose,
}: {
  category: ServiceEnquiryCategory
  onClose: () => void
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [notificationUnavailable, setNotificationUnavailable] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    const common = {
      customerName: String(values.get('customerName') ?? '').trim(),
      mobile: String(values.get('mobile') ?? '').trim(),
      email: String(values.get('email') ?? '').trim() || undefined,
      location: String(values.get('location') ?? '').trim(),
      requiredDate: String(values.get('requiredDate') ?? ''),
    }

    let payload: CreateServiceEnquiryPayload
    if (category === 'empty_tanker') {
      payload = {
        ...common,
        serviceCategory: category,
        details: {
          capacityLitres: Number(values.get('capacityLitres')),
          requirements: String(values.get('requirements') ?? '').trim(),
        },
      }
    } else if (category === 'rmc') {
      payload = {
        ...common,
        serviceCategory: category,
        details: {
          grade: String(values.get('grade') ?? '').trim(),
          quantityCubicMetres: Number(values.get('quantityCubicMetres')),
          pumpRequired: values.get('pumpRequired') === 'on',
          requirements: String(values.get('requirements') ?? '').trim() || undefined,
        },
      }
    } else {
      payload = {
        ...common,
        serviceCategory: category,
        details: {
          proposedDepthMetres: Number(values.get('proposedDepthMetres')),
          siteRequirements: String(values.get('siteRequirements') ?? '').trim(),
        },
      }
    }

    setPending(true)
    setError('')
    try {
      const result = await customerApi.createServiceEnquiry(payload)
      setNotificationUnavailable(result.notificationStatus !== 'created')
      setSubmitted(true)
    } catch (value) {
      setError(value instanceof Error ? value.message : 'The enquiry could not be submitted. Please try again.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Modal title={`Request ${serviceNames[category]}`} onClose={onClose}>
      {submitted ? (
        <div className="service-enquiry-success" role="status">
          <CheckCircle2 size={26} aria-hidden="true" />
          <p>Your enquiry has been saved. Our team will contact you.</p>
          {notificationUnavailable && (
            <p className="service-enquiry-notice">
              The enquiry is saved, but the admin alert could not be created. The team can still find it in the Admin Panel.
            </p>
          )}
          <button className="button button-primary" type="button" onClick={onClose}>Done</button>
        </div>
      ) : (
        <form className="modal-form" onSubmit={submit}>
          <p>Share your contact details and site requirements. We will follow up to confirm availability and pricing.</p>
          <label>
            Customer name
            <input name="customerName" autoComplete="name" minLength={2} maxLength={120} required />
          </label>
          <label>
            Mobile number
            <input name="mobile" type="tel" inputMode="numeric" autoComplete="tel-national" pattern="[6-9][0-9]{9}" maxLength={10} aria-describedby="service-enquiry-mobile-help" required />
            <small id="service-enquiry-mobile-help">Enter a 10-digit Indian mobile number.</small>
          </label>
          <label>
            Email <span>(optional)</span>
            <input name="email" type="email" autoComplete="email" maxLength={160} />
          </label>
          <label>
            Site location
            <textarea name="location" autoComplete="street-address" minLength={5} maxLength={500} rows={2} required />
          </label>
          <label>
            Required date
            <input name="requiredDate" type="date" min={localDateInputValue()} required />
          </label>
          {category === 'empty_tanker' && (
            <>
              <label>
                Tanker capacity (litres)
                <input name="capacityLitres" type="number" min={1000} max={50000} step={1000} required />
              </label>
              <label>
                Service requirements
                <textarea name="requirements" minLength={2} maxLength={2000} rows={3} required />
              </label>
            </>
          )}
          {category === 'rmc' && (
            <>
              <label>
                Concrete grade
                <input name="grade" placeholder="For example, M25" minLength={2} maxLength={40} required />
              </label>
              <label>
                Quantity (cubic metres)
                <input name="quantityCubicMetres" type="number" min={0.1} max={10000} step="any" required />
              </label>
              <label className="service-enquiry-checkbox">
                <input name="pumpRequired" type="checkbox" />
                Concrete pump required
              </label>
              <label>
                Additional requirements <span>(optional)</span>
                <textarea name="requirements" maxLength={2000} rows={3} />
              </label>
            </>
          )}
          {category === 'borewell' && (
            <>
              <label>
                Proposed depth (metres)
                <input name="proposedDepthMetres" type="number" min={0.1} max={1000} step="any" required />
              </label>
              <label>
                Site requirements
                <textarea name="siteRequirements" minLength={2} maxLength={2000} rows={3} required />
              </label>
            </>
          )}
          {error && <p className="service-enquiry-error" role="alert">{error}</p>}
          <button className="button button-primary" disabled={pending} type="submit">
            {pending ? 'Submitting…' : 'Submit enquiry'} <ArrowRight size={15} />
          </button>
        </form>
      )}
    </Modal>
  )
}
