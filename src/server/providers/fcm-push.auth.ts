/**
 * @fileoverview Turns service account credentials into an FCM access token, cached and single-flight.
 * @layer infrastructure
 *
 * The key is parsed once into a `KeyObject`; it and the access token live in `#private` fields and
 * are never part of an error. A failed exchange sends no push, so a transient one is retryable.
 */

import { createPrivateKey, sign } from 'node:crypto'
import type { KeyObject } from 'node:crypto'

import { RATE_LIMITED, REJECTED_CREDENTIALS, UNREACHABLE, field } from '../utils/push-outcome'
import type { PushFailure } from '../utils/push-outcome'
import { checkedAwait } from '../utils/realm-root'
import { GOOGLE_TOKEN_URL, postToGoogle } from './fcm-push.client'
import type { FcmCall, FcmCallOptions } from './fcm-push.client'

// Read once, when the module loads: a later replacement of the built-in changes nothing here.
const readKey = createPrivateKey
const signWith = sign
const stringifyJson = JSON.stringify

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging'
const GRANT = 'urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer'
/** The longest life Google accepts for an assertion, in seconds. */
const ASSERTION_SECONDS = 3600
/** How long before its end a cached access token stops being used, in seconds. */
const EXPIRY_MARGIN_SECONDS = 300

/** An access token, or why there is none. */
export type FcmGrant =
  | { readonly kind: 'ok'; readonly token: string }
  | { readonly kind: 'failed'; readonly failure: PushFailure }

/**
 * Parses the PEM of a service account.
 *
 * @param owner - The component named in the refusal.
 * @param pem - The `private_key` of the service account.
 * @returns The key object.
 * @throws Error When the value is not an RSA private key. The message holds none of it.
 */
export function readRsaKey(owner: string, pem: unknown): KeyObject {
  let key: KeyObject | undefined
  try {
    if (typeof pem === 'string') {
      key = readKey(pem)
    }
  } catch {
    // Not a PEM: refused below, with none of the parser's words.
  }
  if (key?.asymmetricKeyType !== 'rsa') {
    throw new Error(`${owner}: privateKey must be an RSA private key in PEM form`)
  }
  return key
}

/** Base64url of the JSON of a value. */
function encode(value: object): string {
  return Buffer.from(stringifyJson(value)).toString('base64url')
}

/** Signs the RS256 assertion of one exchange. */
function assertionFor(clientEmail: string, key: KeyObject, nowSeconds: number): string {
  const claims = {
    iss: clientEmail,
    scope: SCOPE,
    aud: GOOGLE_TOKEN_URL,
    iat: nowSeconds,
    exp: nowSeconds + ASSERTION_SECONDS
  }
  const input = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}`
  return `${input}.${signWith('sha256', Buffer.from(input), key).toString('base64url')}`
}

/** Why an exchange gave no token. */
function exchangeFailure(call: FcmCall): PushFailure {
  // No push was in the request, so even a lost answer is safe to try again.
  if (call.kind === 'lost' || call.status >= 500 || call.status < 300) {
    return UNREACHABLE
  }
  return call.status === 429 ? RATE_LIMITED : REJECTED_CREDENTIALS
}

/** Whether a value can travel in an `Authorization` header. */
function isBearer(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e]+$/u.test(value)
}

/** The access tokens of one service account. */
export class FcmAccessTokens {
  readonly #clientEmail: string
  readonly #key: KeyObject
  readonly #call: FcmCallOptions
  #cached: { readonly token: string; readonly until: number } | undefined
  #pending: Promise<FcmGrant> | undefined

  constructor(clientEmail: string, key: KeyObject, call: FcmCallOptions) {
    this.#clientEmail = clientEmail
    this.#key = key
    this.#call = call
  }

  /** The cached token, or the result of the one exchange in flight. */
  async get(): Promise<FcmGrant> {
    if (this.#cached !== undefined && Date.now() < this.#cached.until) {
      return { kind: 'ok', token: this.#cached.token }
    }
    const pending = (this.#pending ??= this.#exchange())
    try {
      return await checkedAwait(pending, this.#call.owner)
    } finally {
      // Cleared by a caller, after the assignment: a refusal raised while the exchange starts has
      // already rejected the promise by then, and clearing from inside it would be undone.
      this.#pending = undefined
    }
  }

  /** Forgets a token the service refused. A newer one stays. */
  drop(refused: string): void {
    if (this.#cached?.token === refused) {
      this.#cached = undefined
    }
  }

  /** Exchanges a signed assertion for an access token. */
  async #exchange(): Promise<FcmGrant> {
    const startedAt = Date.now()
    const assertion = assertionFor(this.#clientEmail, this.#key, Math.floor(startedAt / 1000))
    const call = await checkedAwait(
      postToGoogle(
        GOOGLE_TOKEN_URL,
        { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        `grant_type=${GRANT}&assertion=${assertion}`,
        this.#call
      ),
      this.#call.owner
    )
    const body = call.kind === 'answer' && call.status < 300 ? call.body : undefined
    const token = field(body, 'access_token')
    if (!isBearer(token)) {
      return { kind: 'failed', failure: exchangeFailure(call) }
    }
    const seconds = field(body, 'expires_in')
    if (typeof seconds === 'number') {
      this.#cached = { token, until: startedAt + (seconds - EXPIRY_MARGIN_SECONDS) * 1000 }
    }
    return { kind: 'ok', token }
  }
}
