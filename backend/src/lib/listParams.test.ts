import { describe, expect, it, vi } from 'vitest'
import type { Response } from 'express'
import { LEGACY_ROW_CEILING, listWindow, sendList } from './listParams.js'

function fakeResponse() {
  const headers: Record<string, string> = {}
  const response = {
    headers,
    body: undefined as unknown,
    setHeader: vi.fn((name: string, value: string) => { headers[name] = value }),
    json: vi.fn((body: unknown) => { response.body = body; return response }),
  }
  return response
}

describe('listWindow', () => {
  it('keeps the legacy bare-array shape when no paging params are sent', () => {
    expect(listWindow({})).toEqual({ mode: 'legacy', limit: LEGACY_ROW_CEILING, from: 0, to: LEGACY_ROW_CEILING })
  })

  it('caps legacy responses at the requested limit, never above 100', () => {
    expect(listWindow({ limit: '25' })).toEqual({ mode: 'legacy', limit: 25, from: 0, to: 25 })
    expect(listWindow({ limit: '500' })).toMatchObject({ mode: 'legacy', limit: 100, to: 100 })
  })

  it('ignores a limit that is not a positive integer', () => {
    expect(listWindow({ limit: 'abc' })).toMatchObject({ limit: LEGACY_ROW_CEILING })
    expect(listWindow({ limit: '-3' })).toMatchObject({ limit: LEGACY_ROW_CEILING })
    expect(listWindow({ limit: '2.5' })).toMatchObject({ limit: LEGACY_ROW_CEILING })
  })

  it('switches to paged mode when page or pageSize is sent', () => {
    expect(listWindow({ page: '3', pageSize: '20' })).toEqual({ mode: 'paged', page: 3, pageSize: 20, from: 40, to: 59 })
    expect(listWindow({ pageSize: '10' })).toEqual({ mode: 'paged', page: 1, pageSize: 10, from: 0, to: 9 })
  })

  it('defaults paged mode to 50 rows and caps it at 100', () => {
    expect(listWindow({ page: '1' })).toEqual({ mode: 'paged', page: 1, pageSize: 50, from: 0, to: 49 })
    expect(listWindow({ page: '2', pageSize: '1000' })).toEqual({ mode: 'paged', page: 2, pageSize: 100, from: 100, to: 199 })
  })

  it('treats an invalid page as the first page', () => {
    expect(listWindow({ page: '0' })).toMatchObject({ mode: 'paged', page: 1 })
    expect(listWindow({ page: 'x' })).toMatchObject({ mode: 'paged', page: 1 })
  })
})

describe('sendList', () => {
  it('sends a bare array and marks truncation when one extra row came back', () => {
    const response = fakeResponse()
    sendList(response as unknown as Response, listWindow({ limit: '2' }), [{ id: 1 }, { id: 2 }, { id: 3 }])
    expect(response.body).toEqual([{ id: 1 }, { id: 2 }])
    expect(response.headers['X-Truncated']).toBe('true')
    expect(response.headers['X-Total-Count']).toBeUndefined()
  })

  it('sends every row and marks no truncation when the result fits', () => {
    const response = fakeResponse()
    sendList(response as unknown as Response, listWindow({ limit: '5' }), [{ id: 1 }], 1)
    expect(response.body).toEqual([{ id: 1 }])
    expect(response.headers['X-Truncated']).toBe('false')
    expect(response.headers['X-Total-Count']).toBe('1')
  })

  it('sends the paged shape with total, page and pageSize', () => {
    const response = fakeResponse()
    sendList(response as unknown as Response, listWindow({ page: '2', pageSize: '2' }), [{ id: 3 }, { id: 4 }, { id: 5 }], 5)
    expect(response.body).toEqual({ rows: [{ id: 3 }, { id: 4 }], total: 5, page: 2, pageSize: 2 })
    expect(response.headers['X-Truncated']).toBeUndefined()
  })
})
