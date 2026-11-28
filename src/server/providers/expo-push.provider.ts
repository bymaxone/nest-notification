/**
 * @fileoverview Reference `IPushProvider` adapter for the Expo Push Service.
 * @layer infrastructure
 *
 * No SDK and no peer dependency: the service is two JSON endpoints, called with the platform's
 * `fetch` (or one the host injects). Every request goes to a URL that is a constant of
 * `expo-push.client.ts`. The optional access token (Expo "enhanced security") is held in a `#private`
 * field and is sent only as the `Authorization` header. A device token, the access token and the
 * service's own error text are never logged and never put in a thrown error: a failure is a closed
 * {@link PushFailureReason}.
 *
 * It answers per token. A call the service rejected, or lost, costs only the tokens of that call; a
 * send throws only when nothing was sent, so a retry of a thrown send cannot deliver twice.
 */

import { Injectable } from '@nestjs/common'

import type { PushReceiptResult } from '../../shared/types/push.types'
import type {
  IPushProvider,
  PushSendOptions,
  PushSendResult
} from '../interfaces/push-provider.interface'
import { accepted } from '../utils/accepted-answer'
import { UNREACHABLE } from '../utils/push-outcome'
import { readIdList, readPush } from '../utils/push-send-input'
import type { ReadPush } from '../utils/push-send-input'
import { assertOptionsObject, readOptionKeys } from '../utils/read-options'
import { assertStandardRealmRoot, checkedAwait, own } from '../utils/realm-root'
import { assertTimerMs } from '../utils/timer-option'
import { EXPO_RECEIPTS_URL, EXPO_SEND_URL, callExpo, refused } from './expo-push.client'
import type { ExpoCall, ExpoCallOptions, ExpoFetch, ExpoRefusal } from './expo-push.client'
import { OUTCOME_UNKNOWN, UNKNOWN_FAILURE, isExpoPushToken } from './expo-push.codes'
import type { ExpoFailure } from './expo-push.codes'
import {
  SEND_CHUNK,
  buildMessages,
  chunksOf,
  failedOutcome,
  field,
  groupByProject,
  readReceipts,
  readTickets
} from './expo-push.mapping'
import type { TokenOutcome } from './expo-push.mapping'

/** Options of {@link ExpoPushProvider}. */
export interface ExpoPushProviderOptions {
  /** Expo access token, when the project enabled "enhanced security". Sent as a Bearer header. */
  accessToken?: string
  /** Bound of each HTTPS call, in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number
  /** The `fetch` to call; the platform's by default. Inject one to route through a proxy. */
  fetch?: ExpoFetch
}

const EXPO_OPTION_KEYS = [
  'accessToken',
  'timeoutMs',
  'fetch'
] as const satisfies readonly (keyof ExpoPushProviderOptions)[]

const OWNER = 'ExpoPushProvider'
const DEFAULT_TIMEOUT_MS = 10_000

/** Whether a value can travel in a header: a non-empty string of printable latin1, which `fetch` accepts. */
function isHeaderToken(value: unknown): value is string {
  return typeof value === 'string' && /^[\x21-\x7e\xa1-\xff][\x20-\x7e\xa0-\xff]*$/u.test(value)
}

/** An error that names a reason and nothing the service said; `code` lets the 503 mapping see a retryable refusal. */
class ExpoPushError extends Error {
  readonly code: string | undefined

  constructor(failure: ExpoFailure) {
    super(`${OWNER}: the push was not sent (${failure.reason})`)
    this.name = 'ExpoPushError'
    this.code = failure.retryable ? 'EUNAVAILABLE' : undefined
  }
}

/** How the calls of one send have gone so far. */
interface SendState {
  sent: boolean
  maybeSent: boolean
  last: ExpoFailure
  refusal?: unknown
}

/** Expo Push Service adapter. */
@Injectable()
export class ExpoPushProvider implements IPushProvider {
  readonly name = 'expo'

  readonly #accessToken: string | undefined
  readonly #timeoutMs: number
  readonly #fetch: ExpoFetch

  constructor(options: ExpoPushProviderOptions = {}) {
    assertOptionsObject(OWNER, options)
    const own = readOptionKeys(options, EXPO_OPTION_KEYS)
    assertTimerMs(OWNER, 'timeoutMs', own.timeoutMs)
    if (own.accessToken !== undefined && !isHeaderToken(own.accessToken)) {
      throw new Error(
        `${OWNER}: accessToken must be a non-empty string of printable latin1 characters`
      )
    }
    if (own.fetch !== undefined && typeof own.fetch !== 'function') {
      throw new Error(`${OWNER}: fetch must be a function`)
    }
    this.#accessToken = own.accessToken
    this.#timeoutMs = own.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.#fetch = own.fetch ?? ((url, init): Promise<Response> => fetch(url, init))
  }

  /** Always configured: the service needs no credential unless the project enabled enhanced security. */
  isConfigured(): boolean {
    return true
  }

  /** @inheritdoc */
  async send(options: PushSendOptions): Promise<PushSendResult> {
    const push = readPush(OWNER, options)
    const outcomes = new Map<string, TokenOutcome>()
    const valid: string[] = []
    for (const token of new Set(push.tokens)) {
      if (isExpoPushToken(token)) {
        valid.push(token)
      } else {
        outcomes.set(token, failedOutcome(token, { reason: 'token_invalid', retryable: false }))
      }
    }
    const state: SendState = { sent: false, maybeSent: false, last: UNKNOWN_FAILURE }
    for (const chunk of chunksOf(valid, SEND_CHUNK)) {
      for (const outcome of await own(this.#sendChunk(push, chunk, state), OWNER)) {
        outcomes.set(outcome.token, outcome)
      }
    }
    // Only when nothing reached the service is a throw safe: a caller that retries it cannot repeat
    // what an earlier call carried. A token given twice is sent once and answered in each place it appeared.
    if (valid.length > 0 && !state.sent && !state.maybeSent) {
      // A realm found changed refuses the send only when no message went out.
      throw state.refusal ?? new ExpoPushError(state.last)
    }
    return accepted({ results: push.tokens.map((token) => outcomes.get(token) as TokenOutcome) })
  }

  /** @inheritdoc */
  async fetchReceipts(ticketIds: readonly string[]): Promise<PushReceiptResult[]> {
    // The bound of `readIdList` is the service's own bound for one receipts call, so one call is all it takes.
    const ids = readIdList(OWNER, 'ticketIds', ticketIds)
    const call = await checkedAwait(this.#call(EXPO_RECEIPTS_URL, { ids }), OWNER)
    if (call.kind === 'failed') {
      throw new ExpoPushError(call.failure)
    }
    // An answer with no `data` map says nothing about any ticket: reading it as all pending would
    // keep a poller waiting on an endpoint that is broken, so it is a failure, like a body that is
    // not JSON. When it carries an `errors` list, the first code is classified as on a refused call;
    // a code the table does not name stays the plain, non-retryable failure. A map that merely omits
    // an id leaves that id pending.
    const data = field(call.body, 'data')
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      const named = refused(200, call.body).failure
      throw new ExpoPushError(named === UNKNOWN_FAILURE ? OUTCOME_UNKNOWN : named)
    }
    return readReceipts(ids, call.body)
  }

  /** Sends one chunk; a refusal of the whole call is answered for each of its tokens. */
  async #sendChunk(
    push: ReadPush,
    tokens: readonly string[],
    state: SendState
  ): Promise<TokenOutcome[]> {
    const call = await own(this.#post(buildMessages(push, tokens), state), OWNER)
    if (call.kind === 'ok') {
      state.sent = true
      return accepted(readTickets(tokens, call.body))
    }
    state.last = call.failure
    if (call.failure === OUTCOME_UNKNOWN) {
      state.maybeSent = true
    }
    if (call.mixedProjects !== undefined) {
      return own(this.#sendByProject(push, tokens, call, state), OWNER)
    }
    return accepted(tokens.map((token) => failedOutcome(token, call.failure)))
  }

  /**
   * Answers a call the service refused because its tokens belong to more than one project: each
   * project's tokens are sent on their own, once. A token the answer does not place is `token_invalid`.
   */
  async #sendByProject(
    push: ReadPush,
    tokens: readonly string[],
    refused: ExpoRefusal,
    state: SendState
  ): Promise<TokenOutcome[]> {
    const outcomes = new Map<string, TokenOutcome>()
    for (const group of groupByProject(tokens, refused.mixedProjects)) {
      const call = await own(this.#post(buildMessages(push, group), state), OWNER)
      if (call.kind === 'ok') {
        state.sent = true
        readTickets(group, call.body).forEach((outcome) => outcomes.set(outcome.token, outcome))
      } else {
        state.last = call.failure
        state.maybeSent ||= call.failure === OUTCOME_UNKNOWN
        group.forEach((token) => outcomes.set(token, failedOutcome(token, call.failure)))
      }
    }
    return accepted(
      tokens.map(
        (token) =>
          outcomes.get(token) ?? failedOutcome(token, { reason: 'token_invalid', retryable: false })
      )
    )
  }

  /** One send call, not made on a realm that was changed. */
  async #post(payload: unknown, state: SendState): Promise<ExpoCall> {
    try {
      assertStandardRealmRoot(OWNER)
    } catch (refusal) {
      state.refusal = refusal
      return accepted({ kind: 'failed', failure: UNREACHABLE })
    }
    return own(this.#call(EXPO_SEND_URL, payload), OWNER)
  }

  /** One call with this provider's bound, access token and fetch. */
  #call(url: typeof EXPO_SEND_URL | typeof EXPO_RECEIPTS_URL, payload: unknown): Promise<ExpoCall> {
    const options: ExpoCallOptions = {
      fetch: this.#fetch,
      accessToken: this.#accessToken,
      timeoutMs: this.#timeoutMs,
      owner: OWNER
    }
    return callExpo(url, payload, options)
  }
}
