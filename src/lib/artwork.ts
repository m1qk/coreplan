// Procedural album covers. Imported tracks without artwork still get a
// colorful, deterministic 1970s-style sleeve instead of a blank square.

const PALETTES: string[][] = [
  ['#F26B1D', '#F4B41A', '#1B1410', '#F4E9D0'],
  ['#E23A2E', '#F4E9D0', '#1D5FD1', '#1B1410'],
  ['#12A150', '#F4B41A', '#F4E9D0', '#1B1410'],
  ['#1D5FD1', '#F26B1D', '#F4E9D0', '#1B1410'],
  ['#8E3B8F', '#F4B41A', '#F4E9D0', '#1B1410'],
  ['#0E8F8F', '#F26B1D', '#F4E9D0', '#1B1410'],
  ['#F4B41A', '#E23A2E', '#1B1410', '#F4E9D0'],
]

function hash32(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function rng(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cache = new Map<string, string>()

/** A data: URI SVG cover derived from the song's title and artist. */
export function generatedCover(title: string, artist: string): string {
  const key = `${title}\u0000${artist}`
  const hit = cache.get(key)
  if (hit) return hit
  const seed = hash32(key)
  const r = rng(seed)
  const pal = PALETTES[seed % PALETTES.length]
  const [c1, c2, c3, c4] = pal
  const pattern = Math.floor(r() * 6)
  const S = 120
  let body = ''
  switch (pattern) {
    case 0: {
      // sunburst
      const rays = 12 + Math.floor(r() * 8)
      for (let i = 0; i < rays; i += 2) {
        const a0 = (i / rays) * Math.PI * 2
        const a1 = ((i + 1) / rays) * Math.PI * 2
        body += `<path d="M60 60 L${60 + 120 * Math.cos(a0)} ${60 + 120 * Math.sin(a0)} L${60 + 120 * Math.cos(a1)} ${60 + 120 * Math.sin(a1)}Z" fill="${c2}"/>`
      }
      body += `<circle cx="60" cy="60" r="${20 + r() * 8}" fill="${c3}"/><circle cx="60" cy="60" r="8" fill="${c4}"/>`
      break
    }
    case 1: {
      for (let i = 6; i >= 1; i--) body += `<circle cx="${60 + (r() - 0.5) * 20}" cy="60" r="${i * 11}" fill="${[c1, c2, c3, c4][i % 4]}"/>`
      break
    }
    case 2: {
      for (let i = -3; i < 9; i++) body += `<rect x="${i * 20 - 20}" y="-10" width="10" height="160" fill="${c2}" transform="rotate(25 60 60)"/>`
      body += `<circle cx="${40 + r() * 40}" cy="${40 + r() * 40}" r="${24 + r() * 10}" fill="${c3}" stroke="${c4}" stroke-width="5"/>`
      break
    }
    case 3: {
      for (let i = 0; i < 5; i++) body += `<path d="M${-10 + i * 4} ${130 - i * 6} A${70 - i * 12} ${70 - i * 12} 0 0 1 ${130 - i * 4} ${130 - i * 6}Z" fill="${[c2, c3, c4, c2, c3][i]}"/>`
      body += `<circle cx="95" cy="25" r="14" fill="${c4}"/>`
      break
    }
    case 4: {
      const n = 6
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if ((x + y) % 2 === 0) body += `<rect x="${(x * S) / n}" y="${(y * S) / n}" width="${S / n}" height="${S / n}" fill="${c2}"/>`
      body += `<circle cx="60" cy="60" r="${28 + r() * 8}" fill="${c3}" stroke="${c4}" stroke-width="6"/><circle cx="60" cy="60" r="7" fill="${c1}"/>`
      break
    }
    default: {
      // vinyl
      body += `<circle cx="60" cy="60" r="54" fill="${c3}"/>`
      for (let i = 1; i <= 4; i++) body += `<circle cx="60" cy="60" r="${54 - i * 6}" fill="none" stroke="${c4}" stroke-opacity=".25" stroke-width="1"/>`
      body += `<circle cx="60" cy="60" r="20" fill="${c2}"/><circle cx="60" cy="60" r="4" fill="${c3}"/>`
    }
  }
  // paper grain + border so it reads as a printed sleeve
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"><rect width="${S}" height="${S}" fill="${c1}"/>${body}<rect x="2" y="2" width="${S - 4}" height="${S - 4}" fill="none" stroke="#1B1410" stroke-width="4"/></svg>`
  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  if (cache.size > 2000) cache.clear()
  cache.set(key, uri)
  return uri
}
