#!/usr/bin/env node
// Generates an Apple Music API Developer Token (a signed JWT) on YOUR computer.
// The .p8 private key never leaves your machine and is never put in the website.
//
//   node scripts/apple-token.mjs --key AuthKey_XXXXXXXXXX.p8 --team YOUR_TEAM_ID --kid XXXXXXXXXX [--days 90]
//
// Where the three values come from (Apple Developer account, paid membership):
//   --team  Membership details > Team ID
//   --kid   Keys > your MusicKit key > Key ID  (also in the .p8 file name)
//   --key   the downloaded .p8 file
//
// Apple allows tokens up to 6 months (15777000 seconds).

import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const b64u = (input) => Buffer.from(input).toString('base64url')

export const MAX_TOKEN_SECONDS = 15777000

/** Build and sign an ES256 developer token. Exported so the test suite can verify it. */
export function createDeveloperToken({ privateKeyPem, teamId, keyId, days = 90, now = Math.floor(Date.now() / 1000) }) {
  const seconds = Math.round(days * 86400)
  if (!(seconds > 0) || seconds > MAX_TOKEN_SECONDS) {
    throw new Error(`--days must be between 1 and ${Math.floor(MAX_TOKEN_SECONDS / 86400)} (Apple's 6 month limit).`)
  }
  if (!teamId || !keyId) throw new Error('Both a Team ID and a Key ID are required.')
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' }
  const payload = { iss: teamId, iat: now, exp: now + seconds }
  const signingInput = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(payload))}`
  // dsaEncoding 'ieee-p1363' gives the raw r||s signature JWT requires (not DER)
  const signature = sign('sha256', Buffer.from(signingInput), {
    key: createPrivateKey(privateKeyPem),
    dsaEncoding: 'ieee-p1363',
  })
  return `${signingInput}.${b64u(signature)}`
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const keyPath = arg('key')
    if (!keyPath) throw new Error('Missing --key path/to/AuthKey_XXXX.p8')
    const token = createDeveloperToken({
      privateKeyPem: readFileSync(keyPath, 'utf8'),
      teamId: arg('team'),
      keyId: arg('kid'),
      days: arg('days') ? Number(arg('days')) : 90,
    })
    console.log(token)
    console.error('\nPaste the token above into the app: Import > Apple Music > Developer token.')
  } catch (e) {
    console.error(`Error: ${e.message}`)
    process.exit(1)
  }
}
