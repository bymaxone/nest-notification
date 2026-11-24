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
import { readIdList, readPush } from '../utils/push-send-input'
import type { ReadPush } from '../utils/push-send-input'
import { assertOptionsObject, readOptionKeys } from '../utils/read-options'
import { checkedAwait } from '../utils/realm-root'
import { assertTimerMs } from '../utils/timer-option'
import { EXPO_RECEIPTS_URL, EXPO_SEND_URL, callExpo } from './expo-push.client'
import type { ExpoCall, ExpoCallOptions, ExpoFetch } from './expo-push.client'
import { OUTCOME_UNKNOWN, UNKNOWN_FAILURE, isExpoPushToken } from './expo-push.codes'
import type { ExpoFailure } from './expo-push.codes'
import {
  RECEIPT_CHUNK,
  SEND_CHUNK,
  buildMessages,
  chunksOf,
  failedOutcome,
  groupByProject,
  pendingReceipts,
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

/** An error that names a reason and nothing the service said; `code` lets the 503 mapping see an outage. */
class ExpoPushError extends Error {
  readonly code: string | undefined

  constructor(failure: ExpoFailure) {
    super(`${OWNER}: the push was not sent (${failure.reason})`)
    this.name = 'ExpoPushError'
    this.code = failure.reason === 'provider_unavailable' ? 'EUNAVAILABLE' : undefined
  }
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
    if (
      own.accessToken !== undefined &&
      (typeof own.accessToken !== 'string' || own.accessToken === '')
    ) {
      throw new Error(`${OWNER}: accessToken must be a non-empty string`)
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
    for (const token of push.tokens) {
      if (isExpoPushToken(token)) {
        valid.push(token)
      } else {
        outcomes.set(token, failedOutcome(token, { reason: 'token_invalid', retryable: false }))
      }
    }
    const state = { sent: false, maybeSent: false, last: UNKNOWN_FAILURE as ExpoFailure }
    for (const chunk of chunksOf(valid, SEND_CHUNK)) {
      for (const outcome of await checkedAwait(this.#sendChunk(push, chunk, state), OWNER)) {
        outcomes.set(outcome.token, outcome)
      }
    }
    // Only when nothing reached the service is a throw safe: a caller that retries it cannot repeat
    // what an earlier call carried. A token given twice is answered once, in the first place it appeared.
    if (valid.length > 0 && !state.sent && !state.maybeSent) {
      throw new ExpoPushError(state.last)
    }
    return { results: push.tokens.map((token) => outcomes.get(token) as TokenOutcome) }
  }

  /** @inheritdoc */
  async fetchReceipts(ticketIds: readonly string[]): Promise<PushReceiptResult[]> {
    const ids = readIdList(OWNER, 'ticketIds', ticketIds)
    const results: PushReceiptResult[] = []
    let failed: ExpoFailure | undefined
    let answered = false
    for (const chunk of chunksOf(ids, RECEIPT_CHUNK)) {
      const call = await checkedAwait(this.#call(EXPO_RECEIPTS_URL, { ids: chunk }), OWNER)
      if (call.kind === 'ok') {
        answered = true
        results.push(...readReceipts(chunk, call.body))
      } else {
        failed = call.failure
        results.push(...pendingReceipts(chunk))
      }
    }
    if (!answered && failed !== undefined) {
      throw new ExpoPushError(failed)
    }
    return results
  }

  /** Sends one chunk; a refusal of the whole call is answered for each of its tokens. */
  async #sendChunk(
    push: ReadPush,
    tokens: readonly string[],
    state: { sent: boolean; maybeSent: boolean; last: ExpoFailure }
  ): Promise<TokenOutcome[]> {
    const call = await checkedAwait(this.#call(EXPO_SEND_URL, buildMessages(push, tokens)), OWNER)
    if (call.kind === 'ok') {
      state.sent = true
      return readTickets(tokens, call.body)
    }
    state.last = call.failure
    if (call.failure === OUTCOME_UNKNOWN) {
      state.maybeSent = true
    }
    if (call.mixedProjects !== undefined) {
      return this.#sendByProject(push, tokens, call, state)
    }
    return tokens.map((token) => failedOutcome(token, call.failure as ExpoFailure))
  }

  /**
   * Answers a call the service refused because its tokens belong to more than one project: each
   * project's tokens are sent on their own, once. A token the answer does not place is `token_invalid`.
   */
  async #sendByProject(
    push: ReadPush,
    tokens: readonly string[],
    refused: Extract<ExpoCall, { kind: 'failed' }>,
    state: { sent: boolean; maybeSent: boolean; last: ExpoFailure }
  ): Promise<TokenOutcome[]> {
    const outcomes = new Map<string, TokenOutcome>()
    for (const group of groupByProject(tokens, refused.mixedProjects)) {
      const call = await checkedAwait(this.#call(EXPO_SEND_URL, buildMessages(push, group)), OWNER)
      if (call.kind === 'ok') {
        state.sent = true
        readTickets(group, call.body).forEach((outcome) => outcomes.set(outcome.token, outcome))
      } else {
        state.maybeSent ||= call.failure === OUTCOME_UNKNOWN
        group.forEach((token) => outcomes.set(token, failedOutcome(token, call.failure)))
      }
    }
    return tokens.map(
      (token) =>
        outcomes.get(token) ?? failedOutcome(token, { reason: 'token_invalid', retryable: false })
    )
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
