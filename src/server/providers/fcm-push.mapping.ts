/**
 * @fileoverview Builds the FCM HTTP v1 message of a push.
 * @layer infrastructure
 *
 * Pure functions: no I/O, no logging. A field the caller left out is `undefined` here and is dropped
 * by `JSON.stringify`, so a request carries only what was set.
 */

import { refuseInput } from '../utils/bounded-list'
import type { ReadPush } from '../utils/push-send-input'

// Read from the global once, when the module loads: a later replacement of the built-in changes nothing here.
const stringifyJson = JSON.stringify

/** The most bytes of notification and data FCM accepts. */
export const FCM_PAYLOAD_LIMIT = 4096

type Message = ReadPush['message']

/** The fields that only mean something on a visible notification. */
const VISIBLE_FIELDS: ReadonlySet<string> = new Set([
  'subtitle',
  'imageUrl',
  'sound',
  'badge',
  'channelId',
  'categoryId',
  'threadId'
])

/**
 * Refuses a background push that also asks for something visible.
 *
 * @param owner - The component named in the refusal.
 * @param message - The checked message.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` when `contentAvailable` comes with a
 * non-empty `title` or `body`, or with a field of a visible notification.
 */
export function assertBackgroundPush(owner: string, message: Message): void {
  if (message.contentAvailable !== true) {
    return
  }
  const visible =
    message.title !== '' ||
    message.body !== '' ||
    message.mutableContent === true ||
    Object.entries(message).some(([name, value]) => value !== undefined && VISIBLE_FIELDS.has(name))
  if (visible) {
    throw refuseInput(
      owner,
      'contentAvailable',
      "is a background push: give title '' and body '' and no field of a visible notification"
    )
  }
}

/** The object, or `undefined` when every field of it is, so an empty block is not sent. */
function filled<T extends object>(block: T): T | undefined {
  return Object.values(block).some((value) => value !== undefined) ? block : undefined
}

/** A string, or `undefined` for the empty one. */
function present(value: string): string | undefined {
  return value === '' ? undefined : value
}

/** The Android block. */
function androidOf(m: Message): object | undefined {
  return filled({
    priority: m.priority === undefined ? undefined : m.priority === 'high' ? 'HIGH' : 'NORMAL',
    ttl: m.ttlSeconds === undefined ? undefined : `${String(m.ttlSeconds)}s`,
    collapse_key: m.collapseKey,
    notification: filled({ channel_id: m.channelId, sound: m.sound })
  })
}

/** The `aps` dictionary. A subtitle needs the whole alert, which replaces the common one. */
function apsOf(m: Message): object | undefined {
  if (m.contentAvailable === true) {
    return { 'content-available': 1 }
  }
  return filled({
    alert:
      m.subtitle === undefined
        ? undefined
        : { title: present(m.title), subtitle: m.subtitle, body: present(m.body) },
    sound: m.sound,
    badge: m.badge,
    category: m.categoryId,
    'thread-id': m.threadId,
    'mutable-content': m.mutableContent === true ? 1 : undefined
  })
}

/** The APNs headers. A background push is always priority 5. */
function apnsHeadersOf(m: Message, nowSeconds: number): object | undefined {
  const background = m.contentAvailable === true
  const asked = m.priority === undefined ? undefined : m.priority === 'high' ? '10' : '5'
  const ttl = m.ttlSeconds
  return filled({
    'apns-push-type': background ? 'background' : undefined,
    'apns-priority': background ? '5' : asked,
    // `0` tells APNs to try once and keep nothing.
    'apns-expiration': ttl === undefined ? undefined : String(ttl === 0 ? 0 : nowSeconds + ttl)
  })
}

/** The message of a push without its token. */
export interface FcmMessageBody {
  readonly fields: object
  /** Whether notification, data and `aps` are over {@link FCM_PAYLOAD_LIMIT}. */
  readonly tooBig: boolean
}

/**
 * Builds everything of a message but the token, once for all tokens.
 *
 * @param m - The checked message.
 * @param nowSeconds - The current Unix time, for `apns-expiration`.
 * @returns The fields and whether the payload is too big to send.
 */
export function buildFcmMessage(m: Message, nowSeconds: number): FcmMessageBody {
  const notification = filled({
    title: present(m.title),
    body: present(m.body),
    image: m.imageUrl
  })
  const aps = apsOf(m)
  const headers = apnsHeadersOf(m, nowSeconds)
  const apns = filled({ headers, payload: aps === undefined ? undefined : { aps } })
  const payload = stringifyJson({ notification, data: m.data, aps })
  return {
    fields: { notification, data: m.data, android: androidOf(m), apns },
    tooBig: Buffer.byteLength(payload) > FCM_PAYLOAD_LIMIT
  }
}

/** The JSON body of the send of one token. */
export function sendBody(token: string, body: FcmMessageBody): string {
  return stringifyJson({ message: { token, ...body.fields } })
}
