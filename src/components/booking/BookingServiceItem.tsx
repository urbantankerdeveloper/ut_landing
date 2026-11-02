import { memo } from 'react'
import { bookingContent as c } from '../../content/booking'

export type BookingServiceEntry = { id: string; serviceId: string }
export type BookingServiceDraft = {
  capacity: string
  waterType: string
  tankerCount: string
  serviceType: string
  quantity: string
  depth: string
  grade: string
  pump: string
  pickupLocation: string
  materialType: string
  notes: string
}
export type BookingServiceField = keyof BookingServiceDraft
export type BookingServiceFieldErrors = Partial<Record<BookingServiceField, string>>
export type BookingServiceOption = { code: string; label: string }

type Props = {
  entry: BookingServiceEntry
  index: number
  options: BookingServiceOption[]
  value: BookingServiceDraft
  errors?: BookingServiceFieldErrors
  onServiceChange: (entryId: string, serviceId: string) => void
  onFieldChange: (entryId: string, field: BookingServiceField, value: string) => void
  onRemove: (entryId: string) => void
}

type ServiceChoiceGroup = { id: BookingServiceField; label: string; choices: readonly { value: string; label: string }[] }
const serviceChoices: Partial<Record<string, readonly ServiceChoiceGroup[]>> = c.serviceItem.choiceGroups

export const BookingServiceItem = memo(function BookingServiceItem({ entry, index, options, value, errors, onServiceChange, onFieldChange, onRemove }: Props) {
  const fields = serviceChoices[entry.serviceId]

  function selectField(label: string, field: BookingServiceField, choices: readonly { value: string; label: string }[]) {
    return <label className="field" key={field}>{label}<select aria-invalid={Boolean(errors?.[field])} value={value[field]} onChange={(event) => onFieldChange(entry.id, field, event.target.value)}>
      {value[field] && !choices.some((choice) => choice.value === value[field]) && <option value={value[field]}>{value[field]}</option>}
      {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select>{errors?.[field] && <small className="booking-field-error" role="alert">{errors[field]}</small>}{field === 'capacity' && <small>{c.serviceItem.capacityEstimate}</small>}</label>
  }

  function quantityField(label: string, field: 'quantity' | 'tankerCount', max: number, step = '1') {
    return <label className="field" key={field}>{label}<input aria-invalid={Boolean(errors?.[field])} type="number" min="1" max={max} step={step} value={value[field]} onChange={(event) => onFieldChange(entry.id, field, event.target.value)} required /></label>
  }

  return <fieldset className="booking-line" data-entry-id={entry.id}>
    <legend>{c.serviceItem.legend(index + 1)}</legend>
    <div className="line-top">
      <label className="field">{c.serviceItem.serviceLabel}<select aria-label={c.serviceItem.serviceSelectLabel(index + 1)} value={entry.serviceId} onChange={(event) => onServiceChange(entry.id, event.target.value)}>
        {options.map((option) => <option value={option.code} key={option.code}>{option.label}</option>)}
      </select></label>
      <button className="remove-line" type="button" aria-label={c.serviceItem.removeLabel(index + 1)} onClick={() => onRemove(entry.id)}>{c.serviceItem.remove}</button>
    </div>
    <div className="split-fields line-fields">
      {fields?.map(({ id, label, choices }) => selectField(label, id, choices))}
      {entry.serviceId === 'water_tanker' || entry.serviceId === 'sewage_tanker' || entry.serviceId === 'emergency_water'
        ? quantityField(c.serviceItem.numberOfTankers, 'tankerCount', 5)
        : null}
      {entry.serviceId === 'empty_tanker' && quantityField(c.serviceItem.numberOfTankers, 'tankerCount', 5)}
      {entry.serviceId === 'drinking_water' && quantityField(c.serviceItem.quantity, 'quantity', 500)}
      {entry.serviceId === 'tank_cleaning' && quantityField(c.serviceItem.numberOfTanks, 'quantity', 50)}
      {entry.serviceId === 'borewell_service' && <label className="field">{c.serviceItem.depthLabel}<input type="number" min="1" placeholder={c.serviceItem.depthPlaceholder} value={value.depth} onChange={(event) => onFieldChange(entry.id, 'depth', event.target.value)} /><small>{c.serviceItem.depthEstimate}</small></label>}
      {entry.serviceId === 'rmc_mix' && quantityField(c.serviceItem.concreteQuantity, 'quantity', 1000, '0.5')}
      {entry.serviceId === 'empty_tanker' && <>
        <label className="field">{c.serviceItem.pickupAddress}<input required value={value.pickupLocation} onChange={(event) => onFieldChange(entry.id, 'pickupLocation', event.target.value)} placeholder={c.serviceItem.pickupAddressPlaceholder} /></label>
        <label className="field">{c.serviceItem.materialToTransport}<input required value={value.materialType} onChange={(event) => onFieldChange(entry.id, 'materialType', event.target.value)} placeholder={c.serviceItem.materialPlaceholder} /></label>
      </>}
      {!fields && <label className="field">{c.serviceItem.serviceRequirements}<textarea value={value.notes} onChange={(event) => onFieldChange(entry.id, 'notes', event.target.value)} rows={2} placeholder={c.serviceItem.serviceRequirementsPlaceholder} /></label>}
    </div>
  </fieldset>
})
