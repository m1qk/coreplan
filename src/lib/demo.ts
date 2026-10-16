import type { Playlist, Track } from './types'
import { newId } from './scheduler'

// Demo data uses invented artists and songs so no real recording is misdescribed.
const REQUIRED: Array<[string, string, string, number]> = [
  ['Neon Parking Lot', 'Velvet Static', 'Midnight Laundromat', 222],
  ['Boombox Heart', 'The Paper Moons', 'Skate Wax Sessions', 245],
  ['Raccoon Radio', 'Dumpster Choir', 'Trash Day', 198],
  ['Sunday Sticker', 'Gold Fish Radio', 'Stuck On You', 231],
  ['Cassette Safari', 'Tigerlily Tape Club', 'Rewind', 267],
  ['Basement Show Blues', 'Loud Neighbors', 'Wall of Foam', 189],
  ['Polaroid Summer', 'Marigold Motel', 'Pool Hours', 254],
  ['Turntable Tango', 'DJ Mango Pit', 'Spin Cycle', 214],
  ['Corner Store Anthem', 'Pocket Change', 'Exact Change Only', 176],
]
const PERSONAL: Array<[string, string, string, number]> = [
  ['Zine Machine', 'Staple Gun Society', 'Cut and Paste', 203],
  ['Vinyl Crackle', 'Needle & Thread', 'Dust Jacket', 288],
  ['Pigeon Parade', 'The Boardwalk Birds', 'Seed Money', 181],
  ['Late Bus Lullaby', 'Night Route 7', 'Last Stop', 262],
  ['Monkey on the Mixer', 'Banana Fader', 'Gain Staging', 207],
  ['Graffiti Garden', 'Spray Can Sunrise', 'Wall Flowers', 241],
  ['Kickflip Confessional', 'Griptape Hymnal', 'Ollie Ollie', 195],
  ['Static Between Stations', 'Dial Tone Dreams', 'FM Fog', 276],
  ['Lava Lamp Lounge', 'Groove Tube', 'Wax Poetics', 233],
  ['Photobooth Strip', 'Four Frames', 'Flash', 168],
]

export function demoLibrary(): { tracks: Track[]; playlists: Playlist[] } {
  const now = new Date().toISOString()
  const reqPl: Playlist = { id: newId('pl'), name: 'Demo: Station playlist', source: 'demo', importedAt: now }
  const perPl: Playlist = { id: newId('pl'), name: 'Demo: My picks', source: 'demo', importedAt: now }
  const mk = (rows: Array<[string, string, string, number]>, role: Track['role'], pl: Playlist): Track[] =>
    rows.map(([title, artist, album, durationSec]) => ({
      id: newId('trk'),
      title,
      artist,
      album,
      durationSec,
      role,
      source: 'demo',
      playlistId: pl.id,
    }))
  return { tracks: [...mk(REQUIRED, 'required', reqPl), ...mk(PERSONAL, 'personal', perPl)], playlists: [reqPl, perPl] }
}
