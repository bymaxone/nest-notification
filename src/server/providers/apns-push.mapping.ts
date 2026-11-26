/**
 * @fileoverview Builds the APNs payload and headers of a push.
 * @layer infrastructure
 *
 * Pure functions: no I/O, no logging. `imageUrl` and `channelId` have no place in `aps` and are not
 * sent.
 */

import { refuseInput } from '../utils/bounded-list'
import type { ReadPush } from '../utils/push-send-input'

// Read from the global once, when the module loads: a later replacement of the built-in changes nothing here.
const stringifyJson = JSON.stringify

/** The most payload bytes APNs accepts. */
export const APNS_PAYLOAD_LIMIT = 4096

/** At most 64 bytes of printable ASCII, with no space at either end: what a header can carry. */
const COLLAPSE_ID = /^[\x21-\x7e](?:[\x20-\x7e]{0,62}[\x21-\x7e])?$/u

type Message = ReadPush['message']

/** A string, or `undefined` for the empty one. */
function present(value: string | undefined): string | undefined {
  return value === '' ? undefined : value
}

/** The alert, or `undefined` when it would be empty. */
function alertOf(m: Message): object | undefined {
  const alert = { title: present(m.title), subtitle: present(m.subtitle), body: present(m.body) }
  return Object.values(alert).some((value) => value !== undefined) ? alert : undefined
}

/** The `aps` dictionary; `JSON.stringify` drops what is `undefined`. */
function apsOf(m: Message): object {
  if (m.contentAvailable === true) {
    return { 'content-available': 1 }
  }
  return {
    alert: alertOf(m),
    sound: m.sound,
    badge: m.badge,
    category: m.categoryId,
    'thread-id': m.threadId,
    'mutable-content': m.mutableContent === true ? 1 : undefined
  }
}

/** Sets the headers a message asks for. A background push is always priority 5. */
function headersOf(m: Message, nowSeconds: number): Record<string, string> {
  const background = m.contentAvailable === true
  const headers: Record<string, string> = {
    'apns-push-type': background ? 'background' : 'alert'
  }
  if (background || m.priority !== undefined) {
    headers['apns-priority'] = !background && m.priority === 'high' ? '10' : '5'
  }
  if (m.ttlSeconds !== undefined) {
    // `0` tells APNs to try once and keep nothing.
    headers['apns-expiration'] = String(m.ttlSeconds === 0 ? 0 : nowSeconds + m.ttlSeconds)
  }
  if (m.collapseKey !== undefined) {
    headers['apns-collapse-id'] = m.collapseKey
  }
  return headers
}

/** A push as APNs receives it, the same for every token. */
export interface ApnsMessage {
  readonly headers: Readonly<Record<string, string>>
  readonly body: string
  /** Whether the body is over {@link APNS_PAYLOAD_LIMIT}. */
  readonly tooBig: boolean
}

/**
 * Builds the payload and headers, once for all tokens. `data` keys sit beside `aps`.
 *
 * @param owner - The component named in a refusal.
 * @param m - The checked message.
 * @param nowSeconds - The current Unix time, for `apns-expiration`.
 * @returns The headers, the body and whether it is too big to send.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` for a `data` key `aps` or a `collapseKey`
 * a header cannot carry.
 */
export function buildApnsMessage(owner: string, m: Message, nowSeconds: number): ApnsMessage {
  if (m.data !== undefined && Object.hasOwn(m.data, 'aps')) {
    throw refuseInput(owner, 'data', "may not use the key 'aps', which APNs reserves")
  }
  if (m.collapseKey !== undefined && !COLLAPSE_ID.test(m.collapseKey)) {
    throw refuseInput(owner, 'collapseKey', 'must be 1 to 64 printable ASCII characters')
  }
  const body = stringifyJson({ ...m.data, aps: apsOf(m) })
  return {
    headers: headersOf(m, nowSeconds),
    body,
    tooBig: Buffer.byteLength(body) > APNS_PAYLOAD_LIMIT
  }
}
