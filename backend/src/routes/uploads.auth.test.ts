import { describe, expect, it } from 'vitest'
import { uploadRelativePath } from './uploads.js'

describe('uploadRelativePath', () => {
  it('rejects traversal and absolute paths instead of repairing them', () => {
    expect(uploadRelativePath('../other-user/file.pdf')).toBeNull()
    expect(uploadRelativePath('docs/../../secret.pdf')).toBeNull()
    expect(uploadRelativePath('..\\..\\secret.pdf')).toBeNull()
    expect(uploadRelativePath('/etc/passwd')).toBeNull()
    expect(uploadRelativePath('\\\\server\\share\\file.pdf')).toBeNull()
    expect(uploadRelativePath('a//b.pdf')).toBeNull()
    expect(uploadRelativePath('')).toBeNull()
  })
  it('keeps ordinary document paths and replaces unsafe characters', () => {
    expect(uploadRelativePath('license/front.pdf')).toBe('license/front.pdf')
    expect(uploadRelativePath('my license (1).pdf')).toBe('my-license--1-.pdf')
  })
})
