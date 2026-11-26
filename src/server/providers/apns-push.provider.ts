/**
 * @fileoverview Reference `IPushProvider` adapter for Apple Push Notification service, over HTTP/2.
 * @layer infrastructure
 *
 * No SDK and no peer dependency: a token signed with `node:crypto` and `node:http2`. The host gives
 * the credential values; this adapter reads no file and no environment variable. A device token, the
 * key, its id, the team id and the words of APNs are never logged and never put in a thrown error.
 *
 * APNs takes one token per request. Until a session has had a request accepted, one is sent alone:
 * APNs allows a single stream on a connection it has not authenticated yet.
 */

import { Injectable } from '@nestjs/common'
import type { OnModuleDestroy } from '@nestjs/common'

import type {
  IPushProvider,
  PushSendOptions,
  PushSendResult
} from '../interfaces/push-provider.interface'
import { MESSAGE_TOO_BIG, TOKEN_INVALID, UNREACHABLE, failedOutcome } from '../utils/push-outcome'
import type { PushFailure, PushOutcome } from '../utils/push-outcome'
import { readPush } from '../utils/push-send-input'
import { assertOptionsObject, readOptionKeys } from '../utils/read-options'
import { checkedAwait, silence } from '../utils/realm-root'
import { assertTimerMs } from '../utils/timer-option'
import { ApnsProviderToken, readEcKey } from './apns-push.auth'
import { EXPIRED_PROVIDER_TOKEN, classifyApnsRefusal, refusesAccount } from './apns-push.codes'
import { buildApnsMessage } from './apns-push.mapping'
import type { ApnsMessage } from './apns-push.mapping'
import { ApnsSession } from './apns-push.session'
import type { ApnsCall, ApnsConnect } from './apns-push.session'
import { assertBackgroundPush } from './fcm-push.mapping'

export type { ApnsConnect } from './apns-push.session'

/** Options of {@link ApnsPushProvider}. */
export interface ApnsPushProviderOptions {
  /** The Apple developer team id, 10 characters. */
  teamId: string
  /** The id of the APNs authentication key, 10 characters. */
  keyId: string
  /** The content of the `.p8` file of that key, with real line breaks. */
  privateKey: string
  /** The `apns-topic`: the bundle id of the app. */
  topic: string
  /** Which APNs the device tokens belong to. */
  environment: 'production' | 'sandbox'
  /** Bound of each request, in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number
  /** The most requests in flight in one `send`, from 1 to 500. Defaults to 20. */
  concurrency?: number
  /** Opens the HTTP/2 session; `http2.connect` by default. Inject one to route through a proxy. */
  connect?: ApnsConnect
}

const APNS_OPTION_KEYS = [
  'teamId',
  'keyId',
  'privateKey',
  'topic',
  'environment',
  'timeoutMs',
  'concurrency',
  'connect'
] as const satisfies readonly (keyof ApnsPushProviderOptions)[]

const OWNER = 'ApnsPushProvider'
const HOSTS = {
  production: 'https://api.push.apple.com',
  sandbox: 'https://api.sandbox.push.apple.com'
} as const
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_CONCURRENCY = 20
const MAX_CONCURRENCY = 500
const APPLE_ID = /^[A-Z0-9]{10}$/u
const TOPIC = /^[A-Za-z0-9.-]{1,255}$/u
/** A device token is hex; nothing else may reach the request path. */
const DEVICE_TOKEN = /^[0-9a-fA-F]{1,256}$/u

/** How the send of one token ended, and what it says about the others. */
interface Delivery {
  readonly outcome: PushOutcome
  /** The failure that stopped the request before APNs judged the message. */
  readonly unsent?: PushFailure
  /** Set when no other token of the batch would get further. */
  readonly stops?: PushFailure
}

/** The state the requests of one `send` share. */
interface Batch {
  readonly tokens: readonly string[]
  readonly message: ApnsMessage
  readonly deliveries: Map<string, Delivery>
  next: number
  /** Set once no request of the batch can succeed. */
  stopped?: PushFailure
}

/** An error that names a reason and nothing APNs said; `code` lets the 503 mapping see a retryable refusal. */
class ApnsPushError extends Error {
  readonly code: string | undefined

  constructor(failure: PushFailure) {
    super(`${OWNER}: the push was not sent (${failure.reason})`)
    this.name = 'ApnsPushError'
    this.code = failure.retryable ? 'EUNAVAILABLE' : undefined
  }
}

/** Reads the end of one request. */
function readDelivery(token: string, call: ApnsCall): Delivery {
  if (call.kind === 'lost') {
    const outcome = failedOutcome(token, call.failure)
    if (call.failure !== UNREACHABLE) {
      return { outcome }
    }
    const delivery = { outcome, unsent: UNREACHABLE }
    return call.neverConnected ? { ...delivery, stops: UNREACHABLE } : delivery
  }
  if (call.status === 200) {
    return {
      outcome: call.apnsId === undefined ? { token } : { token, messageId: call.apnsId }
    }
  }
  const failure = classifyApnsRefusal(call.status, call.reason)
  const outcome = failedOutcome(token, failure)
  return refusesAccount(failure, call.reason)
    ? { outcome, unsent: failure, stops: failure }
    : { outcome }
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

/** Checks the values that identify the account and the app. */
function assertAppValues(own: ApnsPushProviderOptions): void {
  if (typeof own.teamId !== 'string' || !APPLE_ID.test(own.teamId)) {
    throw new Error(`${OWNER}: teamId must be 10 capital letters or digits`)
  }
  if (typeof own.keyId !== 'string' || !APPLE_ID.test(own.keyId)) {
    throw new Error(`${OWNER}: keyId must be 10 capital letters or digits`)
  }
  if (typeof own.topic !== 'string' || !TOPIC.test(own.topic)) {
    throw new Error(`${OWNER}: topic must be the bundle id of the app`)
  }
  if (own.environment !== 'production' && own.environment !== 'sandbox') {
    throw new Error(`${OWNER}: environment must be 'production' or 'sandbox'`)
  }
}

/** Checks the values that bound and carry the requests. */
function assertTransportValues(own: ApnsPushProviderOptions): void {
  const count = own.concurrency
  if (count !== undefined && !(Number.isInteger(count) && count >= 1 && count <= MAX_CONCURRENCY)) {
    throw new Error(`${OWNER}: concurrency must be an integer from 1 to ${String(MAX_CONCURRENCY)}`)
  }
  if (own.connect !== undefined && typeof own.connect !== 'function') {
    throw new Error(`${OWNER}: connect must be a function`)
  }
}

/** Apple Push Notification service adapter. */
@Injectable()
export class ApnsPushProvider implements IPushProvider, OnModuleDestroy {
  readonly name = 'apns'

  readonly #topic: string
  readonly #concurrency: number
  readonly #session: ApnsSession
  readonly #token: ApnsProviderToken

  constructor(options: ApnsPushProviderOptions) {
    assertOptionsObject(OWNER, options)
    const own = readOptionKeys(options, APNS_OPTION_KEYS)
    assertTimerMs(OWNER, 'timeoutMs', own.timeoutMs)
    assertAppValues(own)
    assertTransportValues(own)
    this.#topic = own.topic
    this.#concurrency = own.concurrency ?? DEFAULT_CONCURRENCY
    this.#session = new ApnsSession(
      HOSTS[own.environment],
      own.connect,
      own.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      OWNER
    )
    this.#token = new ApnsProviderToken(own.teamId, own.keyId, readEcKey(OWNER, own.privateKey))
  }

  /** Always configured: the constructor refuses incomplete credentials. */
  isConfigured(): boolean {
    return true
  }

  /** Ends the connection once its requests are done; a later `send` opens another. */
  close(): void {
    this.#session.close()
  }

  /** Ends the connection with the module. */
  onModuleDestroy(): void {
    this.close()
  }

  /** @inheritdoc */
  async send(options: PushSendOptions): Promise<PushSendResult> {
    const push = readPush(OWNER, options)
    assertBackgroundPush(OWNER, push.message)
    const message = buildApnsMessage(OWNER, push.message, Math.floor(Date.now() / 1000))
    const refused = new Map<string, Delivery>()
    const valid: string[] = []
    for (const token of new Set(push.tokens)) {
      const refusal = !DEVICE_TOKEN.test(token)
        ? TOKEN_INVALID
        : message.tooBig
          ? MESSAGE_TOO_BIG
          : undefined
      if (refusal === undefined) {
        valid.push(token)
      } else {
        refused.set(token, { outcome: failedOutcome(token, refusal) })
      }
    }
    const batch: Batch = { tokens: valid, message, deliveries: new Map(), next: 0 }
    await checkedAwait(this.#sendAll(batch), OWNER)
    // A throw is safe only when no request reached a judgement of the message, so that a caller who retries it repeats nothing.
    const failure = nothingSent(batch.deliveries)
    if (failure !== undefined) {
      throw new ApnsPushError(failure)
    }
    // A token given twice is sent once and answered in each place it appeared.
    return {
      results: push.tokens.map(
        (token) => ((batch.deliveries.get(token) ?? refused.get(token)) as Delivery).outcome
      )
    }
  }

  /** Sends one token alone on a session not yet accepted, then the rest side by side. */
  async #sendAll(batch: Batch): Promise<void> {
    if (!this.#session.proven && batch.tokens.length > 0) {
      await checkedAwait(this.#sendNext(batch), OWNER)
    }
    const workers: Promise<void>[] = []
    const count = Math.min(this.#concurrency, batch.tokens.length - batch.next)
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
      await checkedAwait(this.#sendNext(batch), OWNER)
    }
  }

  /** Claims one token and records how its send ended. */
  async #sendNext(batch: Batch): Promise<void> {
    const token = batch.tokens[batch.next] as string
    batch.next += 1
    const delivery = await checkedAwait(this.#deliver(batch, token), OWNER)
    if (delivery.stops !== undefined) {
      batch.stopped = delivery.stops
    }
    batch.deliveries.set(token, delivery)
  }

  /** Sends one token, once more with a new provider token when the first was refused as expired. */
  async #deliver(batch: Batch, token: string, retried = false): Promise<Delivery> {
    if (batch.stopped !== undefined) {
      return { outcome: failedOutcome(token, batch.stopped), unsent: batch.stopped }
    }
    const jwt = this.#token.get()
    const headers = {
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': this.#topic,
      ...batch.message.headers
    }
    const call = await checkedAwait(this.#session.post(headers, batch.message.body), OWNER)
    const expired = call.kind === 'answer' && call.reason === EXPIRED_PROVIDER_TOKEN
    if (expired && !retried && this.#token.renew(jwt)) {
      return checkedAwait(this.#deliver(batch, token, true), OWNER)
    }
    return readDelivery(token, call)
  }
}
