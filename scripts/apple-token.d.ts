export declare const MAX_TOKEN_SECONDS: number
export declare function createDeveloperToken(opts: {
  privateKeyPem: string
  teamId: string
  keyId: string
  days?: number
  now?: number
}): string
