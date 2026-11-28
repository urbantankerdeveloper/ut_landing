import { readFile, writeFile } from 'node:fs/promises'

const candidates = JSON.parse(await readFile(new URL('./image-candidates.json', import.meta.url), 'utf8'))
const selection = JSON.parse(await readFile(new URL('./image-selection.json', import.meta.url), 'utf8'))
const lines = ['# Image credits', '', 'Generated automatically from the approved image selections.', '']
for (const [slot, file] of Object.entries(selection)) {
  if (!file) continue
  const candidate = candidates.find((entry) => entry.slot === slot)?.candidates?.find((item) => item.reviewFile === file)
  lines.push(`## ${slot}`, '', `- Source: ${candidate ? `[${candidate.provider}](${candidate.sourceUrl})` : 'Locally supplied source'}`, `- Photographer/owner: ${candidate?.photographer ?? 'See original source'}`, `- Licence: ${candidate ? `[${candidate.licence}](${candidate.licenceUrl})` : 'CC0 or CC-BY'}`, '')
}
await writeFile(new URL('../docs/image-credits.md', import.meta.url), `${lines.join('\n')}\n`)
