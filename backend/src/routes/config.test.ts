import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultFeatureFlags } from '../services/featureFlags.js'

const mocks = vi.hoisted(() => ({
  getManualAssignmentModeEnabled: vi.fn(),
}))

vi.mock('../services/manualAssignmentMode.js', () => ({
  getManualAssignmentModeEnabled: mocks.getManualAssignmentModeEnabled,
}))

import configRouter from './config.js'

beforeEach(() => {
  mocks.getManualAssignmentModeEnabled.mockResolvedValue(false)
})

describe('GET /config/flags', () => {
  it('returns only public boolean feature flags with short caching', async () => {
    const response = await request(express().use(configRouter)).get('/flags')

    expect(response.status).toBe(200)
    expect(response.body).toEqual(expect.objectContaining(defaultFeatureFlags))
    expect(response.headers['cache-control']).toBe('private, max-age=60')
    expect(Object.values(response.body).every((value) => typeof value === 'boolean')).toBe(true)
  })

  it('returns the saved manual assignment mode in the public flag map', async () => {
    mocks.getManualAssignmentModeEnabled.mockResolvedValueOnce(true)

    const response = await request(express().use(configRouter)).get('/flags')

    expect(response.status).toBe(200)
    expect(response.body.manual_assignment_mode_enabled).toBe(true)
  })
})
