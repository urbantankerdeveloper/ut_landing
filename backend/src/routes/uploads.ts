import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../supabase.js'

const router = Router()
router.use(requireAuth)
const documentBucket = 'urban-tanker-documents'
const maxUploadBytes = 10 * 1024 * 1024

// Paths are rejected, not repaired, when they try to climb or start at the root. Other unsafe characters become '-'.
export function uploadRelativePath(value: string): string | null {
  const normalized = value.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('..') || normalized.includes('//')) return null
  return normalized.replace(/[^a-zA-Z0-9._/-]/g, '-')
}

router.post('/signed-url', async (request, response) => {
  const parsed = z.object({
    path: z.string().min(1).max(250),
    bucket: z.literal(documentBucket).default(documentBucket),
    contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
    size: z.number().int().positive().max(maxUploadBytes),
  }).safeParse(request.body)
  if (!parsed.success) return response.status(400).json({ error: 'Upload must include an allowed document type and a size up to 10 MB.' })

  const relativePath = uploadRelativePath(parsed.data.path)
  const extension = relativePath?.toLowerCase().split('.').pop()
  if (!relativePath || !extension || !['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx'].includes(extension)) {
    return response.status(400).json({ error: 'Invalid upload path or file extension.' })
  }

  const safePath = `${request.authUser!.id}/${relativePath}`
  const { data, error } = await supabase.storage.from(documentBucket).createSignedUploadUrl(safePath)
  if (error) {
    console.error(JSON.stringify({ event: 'uploads.signed_url_failed', requestId: response.locals.requestId, error: error.message }))
    return response.status(400).json({ error: 'The upload could not be prepared. Please try again.' })
  }
  response.json({ path: safePath, token: data.token, signedUrl: data.signedUrl, contentType: parsed.data.contentType, maxBytes: maxUploadBytes })
})

router.delete('/:bucket/*path', async (request, response) => {
  if (request.params.bucket !== documentBucket) return response.status(400).json({ error: 'Invalid upload bucket' })
  const rawPath = Array.isArray(request.params.path) ? request.params.path.join('/') : request.params.path
  const relativePath = uploadRelativePath(rawPath)
  if (!relativePath) return response.status(400).json({ error: 'Invalid upload path' })

  const path = `${request.authUser!.id}/${relativePath}`
  const { error } = await supabase.storage.from(documentBucket).remove([path])
  if (error) {
    console.error(JSON.stringify({ event: 'uploads.remove_failed', requestId: response.locals.requestId, error: error.message }))
    return response.status(400).json({ error: 'The upload could not be removed. Please try again.' })
  }
  response.status(204).send()
})

export default router
