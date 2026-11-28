import { mkdir, readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'

const selection = JSON.parse(await readFile(new URL('./image-selection.json', import.meta.url), 'utf8'))
const originals = new URL('./image-originals/', import.meta.url)
const output = new URL('../public/assets/landing/', import.meta.url)
await mkdir(output, { recursive: true })

for (const [slot, selected] of Object.entries(selection)) {
  if (!selected) continue
  try {
    const original = new URL(selected, originals)
    const metadata = await sharp(original).metadata()
    if (!metadata.width || metadata.width < 1920) {
      console.warn(`Skipping ${slot}: source is ${metadata.width ?? 0}px wide (minimum 1920px).`)
      continue
    }
    for (const width of [640, 960, 1280, 1920]) {
      await sharp(original).resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toFile(`${fileURLToPath(output)}${slot}-${width}.webp`)
      await sharp(original).resize({ width, withoutEnlargement: true }).avif({ quality: 48 }).toFile(`${fileURLToPath(output)}${slot}-${width}.avif`)
    }
  } catch (error) {
    console.warn(`Skipping ${slot}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
