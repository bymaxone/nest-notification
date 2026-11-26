/**
 * @fileoverview Reference `IPushProvider` adapter for Firebase Cloud Messaging, HTTP v1.
 * @layer infrastructure
 *
 * No SDK and no peer dependency: an OAuth exchange and one send endpoint, called with the platform's
 * `fetch` (or one the host injects). The host gives the credential values; this adapter reads no
 * file and no environment variable. A device token, the key, the access token and the service's own
 * error text are never logged and never put in a thrown error.
 *
 * FCM v1 takes one token per request, so a send runs at most `concurrency` requests at a time.
 */

import { Injectable } from '@nestjs/common'

import type {
  IPushProvider,
  PushSendOptions,
  PushSendResult
} from '../interfaces/push-provider.interface'
import {
  MESSAGE_TOO_BIG,
  OUTCOME_UNKNOWN,
  TOKEN_INVALID,
  UNREACHABLE,
  failedOutcome,
  field
} from '../utils/push-outcome'
import type { PushFailure, PushOutcome } from '../utils/push-outcome'
import { isUsableToken, readPush } from '../utils/push-send-input'
import { assertOptionsObject, readOptionKeys } from '../utils/read-options'
import { checkedAwait, silence } from '../utils/realm-root'
import { assertTimerMs } from '../utils/timer-option'
import { FcmAccessTokens, readRsaKey } from './fcm-push.auth'
import { fcmSendUrl, postToGoogle } from './fcm-push.client'
import type { FcmCall, FcmCallOptions, FcmFetch } from './fcm-push.client'
import { classifyFcmRefusal, fcmErrorCode } from './fcm-push.codes'
import { assertBackgroundPush, buildFcmMessage, sendBody } from './fcm-push.mapping'
import type { FcmMessageBody } from './fcm-push.mapping'

/** Options of {@link FcmPushProvider}. */
export interface FcmPushProviderOptions {
  /** The Firebase project id (`project_id`). */
  projectId: string
  /** The service account address (`client_email`). */
  clientEmail: string
  /** The service account RSA key in PEM form (`private_key`), with real line breaks. */
  privateKey: string
  /** Bound of each HTTPS call, in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number
  /** The most send requests in flight in one `send`, from 1 to 500. Defaults to 20. */
  concurrency?: number
  /** The `fetch` to call; the platform's by default. Inject one to route through a proxy. */
  fetch?: FcmFetch
}

const FCM_OPTION_KEYS = [
  'projectId',
  'clientEmail',
  'privateKey',
  'timeoutMs',
  'concurrency',
  'fetch'
] as const satisfies readonly (keyof FcmPushProviderOptions)[]

const OWNER = 'FcmPushProvider'
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_CONCURRENCY = 20
const MAX_CONCURRENCY = 500
/** A project id, with the `domain:name` form of old projects; nothing that changes a URL path. */
const PROJECT_ID = /^[a-z0-9][a-z0-9.:-]{0,126}$/u
const CLIENT_EMAIL = /^[\x21-\x3f\x41-\x7e]{1,255}@[\x21-\x3f\x41-\x7e]{1,255}$/u

/** How the send of one token ended, and whether it proves that nothing at all could be sent. */
interface Delivery {
  readonly outcome: PushOutcome
  /** The failure that stopped the request before the service judged the message. */
  readonly unsent?: PushFailure
}

/** The state the requests of one `send` share. */
interface Batch {
  readonly tokens: readonly string[]
  readonly body: FcmMessageBody
  readonly deliveries: Map<string, Delivery>
  next: number
  /** Set once no access token could be had, so the rest of the batch does not ask again. */
  noGrant?: PushFailure
}

/** An error that names a reason and nothing the service said; `code` lets the 503 mapping see a retryable refusal. */
class FcmPushError extends Error {
  readonly code: string | undefined

  constructor(failure: PushFailure) {
    super(`${OWNER}: the push was not sent (${failure.reason})`)
    this.name = 'FcmPushError'
    this.code = failure.retryable ? 'EUNAVAILABLE' : undefined
  }
}

/** The delivery of a token whose request never reached a judgement of the message. */
function unsent(token: string, failure: PushFailure): Delivery {
  return { outcome: failedOutcome(token, failure), unsent: failure }
}

/** Reads the answer of one send. */
function readDelivery(token: string, call: FcmCall): Delivery {
  if (call.kind === 'lost') {
    return call.failure === UNREACHABLE
      ? unsent(token, UNREACHABLE)
      : { outcome: failedOutcome(token, call.failure) }
  }
  if (call.status >= 200 && call.status < 300) {
    const name = field(call.body, 'name')
    return typeof name === 'string' && name.length > 0
      ? { outcome: { token, messageId: name } }
      : { outcome: failedOutcome(token, OUTCOME_UNKNOWN) }
  }
  const failure = classifyFcmRefusal(call.status, call.body)
  // A refusal of the account says nothing about the token. The APNs key refusal does: it concerns iOS tokens only.
  const account =
    failure.reason === 'credentials' && fcmErrorCode(call.body) !== 'THIRD_PARTY_AUTH_ERROR'
  return account ? unsent(token, failure) : { outcome: failedOutcome(token, failure) }
}

/** The failure to throw when no request of the batch got as far as the message; `undefined` otherwise. */
function nothingSent(deliveries: Map<string, Delivery>): PushFailure | undefined {
  let last: PushFailure | undefined
  for (const delivery of deliveries.values()) {
    if (delivery.unsent === undefined) {
      return undefined
    }
    last = delivery.unsent
  }
  return last
}

/** Checks option values. */
function assertFcmOptions(own: FcmPushProviderOptions): void {
  if (typeof own.projectId !== 'string' || !PROJECT_ID.test(own.projectId)) {
    throw new Error(`${OWNER}: projectId must be a Firebase project id`)
  }
  if (typeof own.clientEmail !== 'string' || !CLIENT_EMAIL.test(own.clientEmail)) {
    throw new Error(`${OWNER}: clientEmail must be the address of a service account`)
  }
  const count = own.concurrency
  if (count !== undefined && !(Number.isInteger(count) && count >= 1 && count <= MAX_CONCURRENCY)) {
    throw new Error(`${OWNER}: concurrency must be an integer from 1 to ${String(MAX_CONCURRENCY)}`)
  }
  if (own.fetch !== undefined && typeof own.fetch !== 'function') {
    throw new Error(`${OWNER}: fetch must be a function`)
  }
}

/** Firebase Cloud Messaging adapter. */
@Injectable()
export class FcmPushProvider implements IPushProvider {
  readonly name = 'fcm'

  readonly #url: string
  readonly #concurrency: number
  readonly #call: FcmCallOptions
  readonly #tokens: FcmAccessTokens

  constructor(options: FcmPushProviderOptions) {
    assertOptionsObject(OWNER, options)
    const own = readOptionKeys(options, FCM_OPTION_KEYS)
    assertTimerMs(OWNER, 'timeoutMs', own.timeoutMs)
    assertFcmOptions(own)
    this.#url = fcmSendUrl(own.projectId)
    this.#concurrency = own.concurrency ?? DEFAULT_CONCURRENCY
    this.#call = {
      fetch: own.fetch ?? ((url, init): Promise<Response> => fetch(url, init)),
      timeoutMs: own.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      owner: OWNER
    }
    this.#tokens = new FcmAccessTokens(
      own.clientEmail,
      readRsaKey(OWNER, own.privateKey),
      this.#call
    )
  }

  /** Always configured: the constructor refuses incomplete credentials. */
  isConfigured(): boolean {
    return true
  }

  /** @inheritdoc */
  async send(options: PushSendOptions): Promise<PushSendResult> {
    const push = readPush(OWNER, options)
    assertBackgroundPush(OWNER, push.message)
    const body = buildFcmMessage(push.message, Math.floor(Date.now() / 1000))
    const deliveries = new Map<string, Delivery>()
    const valid: string[] = []
    for (const token of new Set(push.tokens)) {
      const refusal = !isUsableToken(token)
        ? TOKEN_INVALID
        : body.tooBig
          ? MESSAGE_TOO_BIG
          : undefined
      if (refusal === undefined) {
        valid.push(token)
      } else {
        deliveries.set(token, { outcome: failedOutcome(token, refusal) })
      }
    }
    const batch: Batch = { tokens: valid, body, deliveries: new Map(), next: 0 }
    await checkedAwait(this.#sendAll(batch), OWNER)
    // A throw is safe only when no request reached a judgement of the message, so that a caller who retries it repeats nothing.
    const failure = nothingSent(batch.deliveries)
    if (failure !== undefined) {
      throw new FcmPushError(failure)
    }
    // A token given twice is sent once and answered in each place it appeared.
    return {
      results: push.tokens.map(
        (token) => ((batch.deliveries.get(token) ?? deliveries.get(token)) as Delivery).outcome
      )
    }
  }

  /** Runs the workers of a batch and waits for each. */
  async #sendAll(batch: Batch): Promise<void> {
    const workers: Promise<void>[] = []
    const count = Math.min(this.#concurrency, batch.tokens.length)
    for (let started = 0; started < count; started += 1) {
      const worker = this.#work(batch)
      // A worker that fails while another is awaited must not end as an unhandled rejection.
      silence(worker)
      workers.push(worker)
    }
    for (const worker of workers) {
      await checkedAwait(worker, OWNER)
    }
  }

  /** Sends the next unclaimed token until there is none. */
  async #work(batch: Batch): Promise<void> {
    while (batch.next < batch.tokens.length) {
      const token = batch.tokens[batch.next] as string
      batch.next += 1
      batch.deliveries.set(token, await checkedAwait(this.#deliver(batch, token), OWNER))
    }
  }

  /** Sends one token, once more with a new access token when the first was refused as expired. */
  async #deliver(batch: Batch, token: string, retried = false): Promise<Delivery> {
    if (batch.noGrant !== undefined) {
      return unsent(token, batch.noGrant)
    }
    const grant = await checkedAwait(this.#tokens.get(), OWNER)
    if (grant.kind === 'failed') {
      batch.noGrant = grant.failure
      return unsent(token, grant.failure)
    }
    const headers = {
      authorization: `Bearer ${grant.token}`,
      'content-type': 'application/json',
      accept: 'application/json'
    }
    const call = await checkedAwait(
      postToGoogle(this.#url, headers, sendBody(token, batch.body), this.#call),
      OWNER
    )
    const expired =
      call.kind === 'answer' &&
      call.status === 401 &&
      fcmErrorCode(call.body) !== 'THIRD_PARTY_AUTH_ERROR'
    if (expired && !retried) {
      this.#tokens.drop(grant.token)
      return checkedAwait(this.#deliver(batch, token, true), OWNER)
    }
    return readDelivery(token, call)
  }
}
