/**
 * @fileoverview The APNs provider token: an ES256 JWT, signed from the `.p8` key and reused.
 * @layer infrastructure
 *
 * The key is parsed once into a `KeyObject`; it and the token live in `#private` fields and are never
 * part of an error. APNs refuses a token older than one hour, and also a provider that signs new
 * ones more than once in 20 minutes.
 */

import { createPrivateKey, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'

// Read once, when the module loads: a later replacement of the built-in changes nothing here.
const readKey = createPrivateKey
const signWith = sign
const stringifyJson = JSON.stringify

/** How long a token is reused. */
const REUSE_MS = 50 * 60_000
/** The youngest token that is replaced when APNs calls it expired. */
const MIN_RENEW_MS = 20 * 60_000

/**
 * Parses the `.p8` of an APNs key.
 *
 * @param owner - The component named in the refusal.
 * @param pem - The content of the file.
 * @returns The key object.
 * @throws Error When the value is not a P-256 private key. The message holds none of it.
 */
export function readEcKey(owner: string, pem: unknown): KeyObject {
  let key: KeyObject | undefined
  try {
    if (typeof pem === 'string') {
      key = readKey(pem)
    }
  } catch {
    // Not a PEM: refused below, with none of the parser's words.
  }
  if (key?.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error(`${owner}: privateKey must be the P-256 private key of a .p8 file, in PEM form`)
  }
  return key
}

/** Base64url of the JSON of a value. */
function encode(value: object): string {
  return Buffer.from(stringifyJson(value)).toString('base64url')
}

/** The provider token of one APNs key. */
export class ApnsProviderToken {
  readonly #teamId: string
  readonly #keyId: string
  readonly #key: KeyObject
  #cached: { readonly value: string; readonly at: number } | undefined

  constructor(teamId: string, keyId: string, key: KeyObject) {
    this.#teamId = teamId
    this.#keyId = keyId
    this.#key = key
  }

  /** The token to send now. */
  get(): string {
    const now = Date.now()
    if (this.#cached === undefined || now - this.#cached.at >= REUSE_MS) {
      this.#cached = { value: this.#sign(Math.floor(now / 1000)), at: now }
    }
    return this.#cached.value
  }

  /**
   * Answers a token APNs called expired.
   *
   * @param refused - The token of the refused request.
   * @returns Whether {@link get} now answers another one, so the request is worth repeating.
   */
  renew(refused: string): boolean {
    if (this.#cached?.value !== refused) {
      return true
    }
    if (Date.now() - this.#cached.at < MIN_RENEW_MS) {
      return false
    }
    this.#cached = undefined
    return true
  }

  /** Signs a token; the signature is the raw `r || s` pair a JWT carries. */
  #sign(nowSeconds: number): string {
    const header = encode({ alg: 'ES256', kid: this.#keyId })
    const input = `${header}.${encode({ iss: this.#teamId, iat: nowSeconds })}`
    const signature = signWith('sha256', Buffer.from(input), {
      key: this.#key,
      dsaEncoding: 'ieee-p1363'
    })
    return `${input}.${signature.toString('base64url')}`
  }
}
