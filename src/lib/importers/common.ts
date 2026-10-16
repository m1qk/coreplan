import type { ParsedTrack } from '../csv'

export type FetchFn = typeof fetch

export type ImportErrorCode =
  | 'bad-link'
  | 'not-configured'
  | 'auth-required'
  | 'auth-expired'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'unexpected'

/** An error with a message that is safe and useful to show to a DJ. */
export class ImportError extends Error {
  code: ImportErrorCode
  constructor(code: ImportErrorCode, message: string) {
    super(message)
    this.name = 'ImportError'
    this.code = code
  }
}

export interface FetchedPlaylist {
  name: string
  tracks: ParsedTrack[]
  /** Items that were not songs (podcast episodes, local files, removed tracks). */
  skipped: number
}

/** Fetch wrapper that turns network failures into an ImportError. */
export async function safeFetch(fetchFn: FetchFn, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetchFn(url, init)
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ImportError('network', "Couldn't reach the service. Check your connection, or this site may be blocked from calling it directly.")
  }
}

/** Pick an image URL near the wanted size from a list of {url,width}. */
export function pickImage(images: Array<{ url?: string; width?: number | null }> | undefined, want = 300): string | undefined {
  if (!images?.length) return undefined
  const valid = images.filter((i) => typeof i.url === 'string')
  if (!valid.length) return undefined
  const sized = valid.filter((i) => typeof i.width === 'number') as Array<{ url: string; width: number }>
  if (!sized.length) return valid[0].url
  const bigEnough = sized.filter((i) => i.width >= want).sort((a, b) => a.width - b.width)
  return (bigEnough[0] ?? sized.sort((a, b) => b.width - a.width)[0]).url
}
