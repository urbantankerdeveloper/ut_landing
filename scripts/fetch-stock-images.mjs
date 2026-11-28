import { mkdir, writeFile } from 'node:fs/promises'

// Pexels/Pixabay API terms are checked and enforced by the provider at runtime.
// Unsplash API hotlinks are not used; only manually approved CC0/CC-BY originals are accepted.
const slots = {
  'services-hero': ['Indian tanker truck road', 'water tanker India', 'tanker truck construction', 'truck water delivery India'],
  'water-tanker': ['water tanker truck home India', 'water delivery tanker apartment', 'tanker water construction site', 'Indian water tanker'],
  'sewage-septic': ['septic tanker truck', 'sewage truck India', 'vacuum tanker work', 'septic tank service truck'],
  'empty-tanker': ['empty tanker truck road', 'commercial tanker truck industrial', 'tanker truck highway', 'tanker lorry India'],
  'rmc-mixer': ['concrete mixer truck construction India', 'cement mixer site', 'ready mix truck', 'concrete truck construction'],
  'borewell': ['borewell drilling rig India', 'drilling rig construction', 'well drilling truck', 'bore drilling site'],
  'tank-cleaning': ['water tank cleaning crew', 'sump cleaning worker', 'tank cleaning India', 'water tank maintenance'],
}

await mkdir(new URL('./image-originals/', import.meta.url), { recursive: true })
const output = []

async function searchPexels(query) {
  if (!process.env.PEXELS_API_KEY) return []
  const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=3&orientation=landscape`, { headers: { Authorization: process.env.PEXELS_API_KEY } })
  if (!response.ok) return []
  const data = await response.json()
  return (data.photos ?? []).map((photo) => ({ provider: 'Pexels', sourceUrl: photo.url, downloadUrl: photo.src?.original, photographer: photo.photographer, licence: 'Pexels License', licenceUrl: 'https://www.pexels.com/license/' }))
}

async function searchPixabay(query) {
  if (!process.env.PIXABAY_API_KEY) return []
  const response = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(process.env.PIXABAY_API_KEY)}&q=${encodeURIComponent(query)}&per_page=3&orientation=horizontal&safesearch=true`)
  if (!response.ok) return []
  const data = await response.json()
  return (data.hits ?? []).map((hit) => ({ provider: 'Pixabay', sourceUrl: hit.pageURL, downloadUrl: hit.largeImageURL, photographer: hit.user, licence: 'Pixabay License', licenceUrl: 'https://pixabay.com/service/license-summary/' }))
}

for (const [slot, queries] of Object.entries(slots)) {
  const candidates = []
  for (const query of queries) candidates.push(...await searchPexels(query), ...await searchPixabay(query))
  const selectedCandidates = candidates.slice(0, 12)
  for (const [index, candidate] of selectedCandidates.entries()) {
    candidate.reviewFile = `${slot}-${index + 1}.jpg`
    if (candidate.downloadUrl) {
      try {
        const downloaded = await fetch(candidate.downloadUrl)
        if (downloaded.ok) await writeFile(new URL(`./image-originals/${candidate.reviewFile}`, import.meta.url), Buffer.from(await downloaded.arrayBuffer()))
      } catch { /* Candidate remains in the review sheet. */ }
    }
  }
  output.push({ slot, candidates: selectedCandidates })
}

await writeFile(new URL('./image-candidates.json', import.meta.url), JSON.stringify(output, null, 2))
await writeFile(new URL('./image-selection.json', import.meta.url), JSON.stringify(Object.fromEntries(Object.keys(slots).map((slot) => [slot, null])), null, 2))
const rows = output.map(({ slot, candidates }) => `<section><h2>${slot}</h2><div class="grid">${candidates.map((c, i) => `<article><img src="./image-originals/${c.reviewFile}" alt=""><p><b>${i + 1}. ${c.provider}</b></p><p>${c.photographer ?? 'Unknown'}</p><p><a href="${c.sourceUrl}" target="_blank" rel="noreferrer">Source</a> | <a href="${c.licenceUrl}" target="_blank" rel="noreferrer">${c.licence}</a></p></article>`).join('')}</div></section>`).join('')
await writeFile(new URL('./image-review.html', import.meta.url), `<!doctype html><meta charset="utf-8"><title>Urban Tanker image review</title><style>body{font-family:sans-serif;margin:24px}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}article{border:1px solid #ddd;padding:8px}img{width:100%;aspect-ratio:16/9;object-fit:cover;background:#ddd}</style>${rows}`)
console.log(`Wrote image-candidates.json, image-selection.json and image-review.html. Pexels/Pixabay keys present: ${Boolean(process.env.PEXELS_API_KEY)}/${Boolean(process.env.PIXABAY_API_KEY)}.`)
