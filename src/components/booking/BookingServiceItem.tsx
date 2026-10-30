import { memo } from 'react'

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

const serviceChoices: Record<string, { label: string; choices: string[] }[]> = {
  water_tanker: [
    { label: 'Water type', choices: ['Domestic water', 'Raw water', 'Construction water', 'Commercial / industrial water'] },
    { label: 'Capacity', choices: ['3 KL', '6 KL', '9 KL', '12 KL', '16 KL'] },
  ],
  sewage_tanker: [
    { label: 'Service', choices: ['Septic tank cleaning', 'Sewage suction', 'Drain / manhole cleaning', 'Sewage removal'] },
    { label: 'Capacity', choices: ['3 KL', '6 KL', '9 KL', '12 KL', '16 KL'] },
  ],
  drinking_water: [
    { label: 'Product', choices: ['20 L water cans', '1 L bottles', '500 ml bottles', 'Bulk drinking water'] },
  ],
  emergency_water: [
    { label: 'Urgent service', choices: ['Emergency water', 'Emergency sewage'] },
    { label: 'Capacity', choices: ['3 KL', '6 KL', '9 KL', '12 KL', '16 KL'] },
  ],
  tank_cleaning: [
    { label: 'Tank type', choices: ['Overhead tank', 'Sump', 'Commercial storage'] },
  ],
  borewell_service: [
    { label: 'Service', choices: ['New drilling', 'Inspection', 'Cleaning', 'Maintenance'] },
  ],
  rmc_mix: [
    { label: 'Concrete grade', choices: ['M10', 'M15', 'M20', 'M25', 'M30', 'M35+', 'Custom mix'] },
    { label: 'Pump needed', choices: ['No', 'Yes', 'To be confirmed'] },
  ],
  empty_tanker: [
    { label: 'Capacity', choices: ['6 KL', '9 KL', '12 KL', '16 KL', '20 KL', '24 KL'] },
  ],
}

export const BookingServiceItem = memo(function BookingServiceItem({ entry, index, options, value, errors, onServiceChange, onFieldChange, onRemove }: Props) {
  const fields = serviceChoices[entry.serviceId]

  function selectField(label: string, field: BookingServiceField, choices: string[]) {
    return <label className="field" key={field}>{label}<select aria-invalid={Boolean(errors?.[field])} value={value[field]} onChange={(event) => onFieldChange(entry.id, field, event.target.value)}>
      {value[field] && !choices.includes(value[field]) && <option value={value[field]}>{value[field]}</option>}
      {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
    </select>{errors?.[field] && <small className="booking-field-error" role="alert">{errors[field]}</small>}{label === 'Capacity' && <small>Estimate scales with capacity and number of tankers.</small>}</label>
  }

  function quantityField(label: string, field: 'quantity' | 'tankerCount', max: number, step = '1') {
    return <label className="field" key={field}>{label}<input aria-invalid={Boolean(errors?.[field])} type="number" min="1" max={max} step={step} value={value[field]} onChange={(event) => onFieldChange(entry.id, field, event.target.value)} required /></label>
  }

  return <fieldset className="booking-line" data-entry-id={entry.id}>
    <legend>Service item {index + 1}</legend>
    <div className="line-top">
      <label className="field">Service<select aria-label={`Service for item ${index + 1}`} value={entry.serviceId} onChange={(event) => onServiceChange(entry.id, event.target.value)}>
        {options.map((option) => <option value={option.code} key={option.code}>{option.label}</option>)}
      </select></label>
      <button className="remove-line" type="button" aria-label={`Remove service item ${index + 1}`} onClick={() => onRemove(entry.id)}>Remove</button>
    </div>
    <div className="split-fields line-fields">
      {fields?.map(({ label, choices }) => {
        const field = label === 'Water type' ? 'waterType' : label === 'Capacity' ? 'capacity' : label === 'Concrete grade' ? 'grade' : label === 'Pump needed' ? 'pump' : 'serviceType'
        return selectField(label, field, choices)
      })}
      {entry.serviceId === 'water_tanker' || entry.serviceId === 'sewage_tanker' || entry.serviceId === 'emergency_water'
        ? quantityField('Number of tankers (max 5)', 'tankerCount', 5)
        : null}
      {entry.serviceId === 'empty_tanker' && quantityField('Number of tankers (max 5)', 'tankerCount', 5)}
      {entry.serviceId === 'drinking_water' && quantityField('Quantity', 'quantity', 500)}
      {entry.serviceId === 'tank_cleaning' && quantityField('Number of tanks', 'quantity', 50)}
      {entry.serviceId === 'borewell_service' && <label className="field">Approximate depth (ft, optional)<input type="number" min="1" placeholder="e.g. 300" value={value.depth} onChange={(event) => onFieldChange(entry.id, 'depth', event.target.value)} /><small>Estimate scales with drilling depth, using 100 ft as the base rate.</small></label>}
      {entry.serviceId === 'rmc_mix' && quantityField('Quantity (m³)', 'quantity', 1000, '0.5')}
      {entry.serviceId === 'empty_tanker' && <>
        <label className="field">Pickup address<input required value={value.pickupLocation} onChange={(event) => onFieldChange(entry.id, 'pickupLocation', event.target.value)} placeholder="Collection location" /></label>
        <label className="field">Material to transport<input required value={value.materialType} onChange={(event) => onFieldChange(entry.id, 'materialType', event.target.value)} placeholder="Material / product" /></label>
      </>}
      {!fields && <label className="field">Service requirements<textarea value={value.notes} onChange={(event) => onFieldChange(entry.id, 'notes', event.target.value)} rows={2} placeholder="Describe the work required" /></label>}
    </div>
  </fieldset>
})
