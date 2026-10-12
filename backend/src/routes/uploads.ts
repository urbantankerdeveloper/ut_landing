import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth.js'
import { supabase } from '../supabase.js'
const router = Router(); router.use(requireAuth)
const documentBucket = 'urban-tanker-documents'
function safeRelativePath(value: string) { return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\.\.(?=\/|$)/g, '').replace(/[^a-zA-Z0-9._/-]/g, '-') }
router.post('/signed-url', async (request, response) => { const parsed = z.object({ path: z.string().min(1).max(250), bucket: z.literal(documentBucket).default(documentBucket) }).safeParse(request.body); if (!parsed.success) return response.status(400).json({ error: 'Invalid upload path' }); const relativePath = safeRelativePath(parsed.data.path); if (!relativePath || relativePath.includes('//')) return response.status(400).json({ error: 'Invalid upload path' }); const safePath = `${request.authUser!.id}/${relativePath}`; const { data, error } = await supabase.storage.from(documentBucket).createSignedUploadUrl(safePath); if (error) return response.status(400).json({ error: error.message }); response.json({ path: safePath, token: data.token, signedUrl: data.signedUrl }) })
router.delete('/:bucket/*path', async (request, response) => { if (request.params.bucket !== documentBucket) return response.status(400).json({ error: 'Invalid upload bucket' }); const rawPath = Array.isArray(request.params.path) ? request.params.path.join('/') : request.params.path; const relativePath = safeRelativePath(rawPath); if (!relativePath || relativePath.includes('//')) return response.status(400).json({ error: 'Invalid upload path' }); const path = `${request.authUser!.id}/${relativePath}`; const { error } = await supabase.storage.from(documentBucket).remove([path]); if (error) return response.status(400).json({ error: error.message }); response.status(204).send() })
export default router
