import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { defaultFeatureFlags } from '../services/featureFlags.js'
import configRouter from './config.js'

describe('GET /config/flags', () => {
  it('returns only public boolean feature flags with short caching', async () => {
    const response = await request(express().use(configRouter)).get('/flags')

    expect(response.status).toBe(200)
    expect(response.body).toEqual(expect.objectContaining(defaultFeatureFlags))
    expect(response.headers['cache-control']).toBe('private, max-age=60')
    expect(Object.values(response.body).every((value) => typeof value === 'boolean')).toBe(true)
  })
})
