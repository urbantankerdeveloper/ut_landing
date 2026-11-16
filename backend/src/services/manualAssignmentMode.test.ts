import { beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from '../config.js'

const state = vi.hoisted(() => ({
  result: { data: null as { value?: unknown } | null, error: null as Error | null },
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}))

function queryBuilder(table: string) {
  const result = state.result
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'upsert']) {
    builder[method] = (...args: unknown[]) => {
      state.calls.push({ table, method, args })
      return builder
    }
  }
  builder.maybeSingle = () => Promise.resolve(result)
  builder.single = () => Promise.resolve(result)
  return builder
}

vi.mock('../supabase.js', () => ({
  supabase: { from: (table: string) => queryBuilder(table) },
}))

import {
  getManualAssignmentModeEnabled,
  setManualAssignmentModeEnabled,
} from './manualAssignmentMode.js'

beforeEach(() => {
  config.featureFlags.manual_assignment_mode_enabled = false
  state.result = { data: null, error: null }
  state.calls.length = 0
})

describe('manual assignment mode', () => {
  it('uses the environment flag when no saved setting exists', async () => {
    config.featureFlags.manual_assignment_mode_enabled = true

    await expect(getManualAssignmentModeEnabled()).resolves.toBe(true)
  })

  it('prefers the saved setting over the environment default', async () => {
    config.featureFlags.manual_assignment_mode_enabled = true
    state.result = { data: { value: false }, error: null }

    await expect(getManualAssignmentModeEnabled()).resolves.toBe(false)
  })

  it('reports an invalid saved setting instead of silently defaulting', async () => {
    state.result = { data: { value: 'true' }, error: null }

    await expect(getManualAssignmentModeEnabled()).rejects.toThrow(
      'The manual assignment setting must be a boolean.',
    )
  })

  it('persists changes as a boolean config value', async () => {
    state.result = { data: { value: true }, error: null }

    await expect(setManualAssignmentModeEnabled(true)).resolves.toBe(true)
    expect(state.calls).toContainEqual({
      table: 'configs',
      method: 'upsert',
      args: [
        expect.objectContaining({
          key: 'manual_assignment_mode_enabled',
          value: true,
        }),
      ],
    })
  })
})
