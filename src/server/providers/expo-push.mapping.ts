/**
 * @fileoverview Builds Expo message payloads and reads tickets and receipts back as closed results.
 * @layer infrastructure
 *
 * Pure functions: no I/O, no logging. A ticket or receipt is read by field with its kind checked,
 * and only a classified reason leaves; the service's own `message` and `details` text never does.
 */

import type { PushReceiptResult } from '../../shared/types/push.types'
import type { PushSendResult } from '../interfaces/push-provider.interface'
import type { ReadPush } from '../utils/push-send-input'
import { OUTCOME_UNKNOWN, classifyDeviceError } from './expo-push.codes'
import type { ExpoFailure } from './expo-push.codes'

/** One result of a send, as `PushSendResult` holds it. */
export type TokenOutcome = PushSendResult['results'][number]

/** The most messages one send call carries. */
export const SEND_CHUNK = 100

/** Reads a field of a parsed value without trusting its shape. */
export function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

/** Splits a list into slices of at most `size`. */
export function chunksOf<T>(list: readonly T[], size: number): T[][] {
  const slices: T[][] = []
  for (let start = 0; start < list.length; start += size) {
    slices.push(list.slice(start, start + size))
  }
  return slices
}

/** The result of a token the call did not serve. */
export function failedOutcome(token: string, failure: ExpoFailure): TokenOutcome {
  return { token, reason: failure.reason, retryable: failure.retryable }
}

/**
 * Builds the JSON of one send call.
 *
 * @param push - The checked message.
 * @param tokens - The tokens of this call, already known to be Expo tokens.
 * @returns The messages array, one object per token (the form the service documents).
 */
export function buildMessages(push: ReadPush, tokens: readonly string[]): object[] {
  const m = push.message
  const common = {
    title: m.title,
    body: m.body,
    ...(m.data === undefined ? {} : { data: m.data }),
    ...(m.sound === undefined ? {} : { sound: m.sound }),
    ...(m.badge === undefined ? {} : { badge: m.badge }),
    ...(m.ttlSeconds === undefined ? {} : { ttl: m.ttlSeconds }),
    ...(m.priority === undefined ? {} : { priority: m.priority }),
    ...(m.channelId === undefined ? {} : { channelId: m.channelId }),
    ...(m.subtitle === undefined ? {} : { subtitle: m.subtitle }),
    ...(m.categoryId === undefined ? {} : { categoryId: m.categoryId }),
    ...(m.mutableContent === undefined ? {} : { mutableContent: m.mutableContent }),
    ...(m.contentAvailable === undefined ? {} : { _contentAvailable: m.contentAvailable }),
    ...(m.imageUrl === undefined ? {} : { richContent: { image: m.imageUrl } })
  }
  return tokens.map((to) => ({ to, ...common }))
}

/** Reads one ticket into the outcome of its token. */
function readTicket(token: string, ticket: unknown): TokenOutcome {
  const status = field(ticket, 'status')
  const id = field(ticket, 'id')
  if (status === 'ok' && typeof id === 'string' && id.length > 0) {
    return { token, messageId: id }
  }
  if (status === 'error') {
    return failedOutcome(token, classifyDeviceError(field(field(ticket, 'details'), 'error')))
  }
  return failedOutcome(token, OUTCOME_UNKNOWN)
}

/**
 * Reads the answer of a send call: one ticket per token, in order.
 *
 * @param tokens - The tokens of the call, in order.
 * @param body - The parsed 2xx body.
 * @returns One outcome per token. A body that does not hold one ticket per token is read as unknown
 *   for all, since the tickets cannot be matched to tokens.
 */
export function readTickets(tokens: readonly string[], body: unknown): TokenOutcome[] {
  const data = field(body, 'data')
  if (!Array.isArray(data) || data.length !== tokens.length) {
    return tokens.map((token) => failedOutcome(token, OUTCOME_UNKNOWN))
  }
  return tokens.map((token, index) => readTicket(token, data.at(index) as unknown))
}

/** The receipt the service returned for an id, `undefined` when it returned none. */
function receiptOf(data: unknown, id: string): unknown {
  return typeof data === 'object' && data !== null && Object.hasOwn(data, id)
    ? Reflect.get(data, id)
    : undefined
}

/** Reads one receipt; a missing one is pending. */
function readReceipt(ticketId: string, receipt: unknown): PushReceiptResult {
  const status = field(receipt, 'status')
  if (status === 'ok') {
    return { ticketId, status: 'ok' }
  }
  if (status === 'error') {
    const failure = classifyDeviceError(field(field(receipt, 'details'), 'error'))
    return { ticketId, status: 'error', reason: failure.reason, retryable: failure.retryable }
  }
  return { ticketId, status: 'pending' }
}

/**
 * Reads the answer of a receipt call.
 *
 * @param ids - The ids asked for, in order.
 * @param body - The parsed 2xx body: `{ data: { [id]: receipt } }`.
 * @returns One result per id, `pending` for each the service did not return.
 */
export function readReceipts(ids: readonly string[], body: unknown): PushReceiptResult[] {
  const data = field(body, 'data')
  return ids.map((id) => readReceipt(id, receiptOf(data, id)))
}

/**
 * Regroups the tokens of a mixed-project refusal by the project the service named.
 *
 * @param tokens - The tokens of the refused call.
 * @param details - The `details` of the refusal: `{ [experienceId]: token[] }`.
 * @returns The groups, each a subset of `tokens` with no repeats; a token the details do not name,
 *   or name twice, is left out so the caller refuses it.
 */
export function groupByProject(tokens: readonly string[], details: unknown): string[][] {
  if (typeof details !== 'object' || details === null) {
    return []
  }
  const known = new Set(tokens)
  const placed = new Set<string>()
  const groups: string[][] = []
  for (const listed of Object.values(details)) {
    const group = (Array.isArray(listed) ? (listed as unknown[]) : []).filter(
      (token): token is string =>
        typeof token === 'string' && known.has(token) && !placed.has(token)
    )
    group.forEach((token) => placed.add(token))
    if (group.length > 0) {
      groups.push(group)
    }
  }
  return groups
}
