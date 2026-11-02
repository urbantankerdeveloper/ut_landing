import { describe, expect, it } from 'vitest'
import { escapeHtml } from './html.js'

describe('escapeHtml', () => {
  it('escapes markup and quotes', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;')
  })

  it('escapes ampersands once', () => {
    expect(escapeHtml('a&b&amp;')).toBe('a&amp;b&amp;amp;')
  })
})
