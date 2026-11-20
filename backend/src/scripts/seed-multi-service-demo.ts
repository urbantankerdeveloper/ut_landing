import { supabase } from '../supabase.js'

const requested = [
  { label: 'both', env: 'DEMO_BOTH_VENDOR_ID', services: ['water_tanker', 'sewage_tanker'] },
  { label: 'water-only', env: 'DEMO_WATER_ONLY_VENDOR_ID', services: ['water_tanker'] },
  { label: 'sewage-only', env: 'DEMO_SEWAGE_ONLY_VENDOR_ID', services: ['sewage_tanker'] },
] as const
const apply = process.argv.includes('--apply')
const ids = requested.map((entry) => ({ ...entry, vendorId: process.env[entry.env] }))

if (ids.some((entry) => !entry.vendorId)) {
  throw new Error('Set DEMO_BOTH_VENDOR_ID, DEMO_WATER_ONLY_VENDOR_ID, and DEMO_SEWAGE_ONLY_VENDOR_ID.')
}
if (new Set(ids.map((entry) => entry.vendorId)).size !== ids.length) {
  throw new Error('Use three distinct vendor IDs for the demo capability sets.')
}

if (!apply) {
  console.info(JSON.stringify({
    dryRun: true,
    message: 'No database was accessed. Add --apply to write these demo capability sets.',
    vendors: ids.map(({ label, vendorId, services }) => ({ label, vendorId, services })),
  }, null, 2))
} else {
  const { data: vendorRows, error: vendorError } = await supabase.from('vendors').select('id').in('id', ids.map((entry) => entry.vendorId!))
  if (vendorError) throw vendorError
  if (vendorRows?.length !== ids.length) throw new Error('Every configured demo vendor ID must exist.')
  const { data: types, error: typesError } = await supabase.from('service_types').select('id,code').in('code', ['water_tanker', 'sewage_tanker']).eq('active', true)
  if (typesError) throw typesError
  if (types?.length !== 2) throw new Error('Both water_tanker and sewage_tanker must be active service types.')
  const typeIds = new Map(types.map((type) => [type.code, type.id]))
  const rows = ids.flatMap((entry) => {
    const enabledServices: readonly string[] = entry.services
    return types.map((type) => ({
      vendor_id: entry.vendorId!,
      service_type_id: type.id,
      active: enabledServices.includes(type.code),
      updated_at: new Date().toISOString(),
    }))
  })
  const { error } = await supabase.from('vendor_services').upsert(rows, { onConflict: 'vendor_id,service_type_id' })
  if (error) throw error
  console.info(`Seeded demo capabilities for ${ids.length} vendors (${typeIds.size} service types).`)
}
