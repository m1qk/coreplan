import type { ParsedTrack } from './csv'
import { newId } from './scheduler'
import type { Playlist, Track, TrackSource } from './types'

export function trackKey(title: string, artist: string): string {
  const n = (s: string) => s.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim()
  return `${n(title)}|${n(artist)}`
}

export interface MergeResult {
  library: Track[]
  playlists: Playlist[]
  added: number
  /** Already in the library (matched by title and artist); missing details were filled in. */
  duplicates: number
}

/**
 * Add imported songs to the library. Songs already present (same title and
 * artist) are not duplicated, but gain any duration/artwork/album they lacked.
 */
export function mergeTracks(
  library: Track[],
  playlists: Playlist[],
  incoming: ParsedTrack[],
  source: TrackSource,
  playlistName?: string,
): MergeResult {
  const byKey = new Map(library.map((t) => [trackKey(t.title, t.artist), t]))
  const next = library.map((t) => ({ ...t }))
  const nextByKey = new Map(next.map((t) => [trackKey(t.title, t.artist), t]))
  const pl: Playlist | undefined = playlistName ? { id: newId('pl'), name: playlistName, source, importedAt: new Date().toISOString() } : undefined
  let added = 0
  let duplicates = 0
  for (const t of incoming) {
    const key = trackKey(t.title, t.artist)
    const existing = nextByKey.get(key)
    if (existing) {
      duplicates++
      if (!existing.durationSec && t.durationSec) existing.durationSec = t.durationSec
      if (!existing.artwork && t.artwork) existing.artwork = t.artwork
      if (!existing.album && t.album) existing.album = t.album
      continue
    }
    const track: Track = { ...t, id: newId('trk'), source, playlistId: pl?.id }
    next.push(track)
    nextByKey.set(key, track)
    added++
  }
  void byKey
  return { library: next, playlists: pl && added > 0 ? [...playlists, pl] : playlists, added, duplicates }
}
