/**
 * @fileoverview Reads the push a caller asks to send once, by name, and checks each field.
 * @layer utils
 *
 * `PushService.send` and the adapters are public: a caller can hand either a plain object. A field it
 * leaves out must be absent, not whatever a key planted on the realm root answers, and a getter must
 * not be asked twice. The copy this returns has no prototype and holds each field once, with the
 * kind of each checked, so what reaches a provider is data and never a caller's accessor.
 */

import type { PushSendOptions } from '../interfaces/push-provider.interface'
import { boundedList, copyByName, refuseInput } from './bounded-list'
import { isPlainOrClassInstance, namesOf, nullProto, readName } from './read-options'

/** The longest text field a push carries; the providers' payload limit is about 4 KiB in all. */
export const MAX_PUSH_TEXT = 4096

/** The longest device token or ticket id, far above any provider's. */
export const MAX_PUSH_TOKEN_LENGTH = 256

/** The most keys a push `data` payload may have. */
export const MAX_PUSH_DATA_KEYS = 64

/** Every field of {@link PushSendOptions}, by name. */
export const PUSH_KEYS = [
  'tokens',
  'title',
  'body',
  'data',
  'imageUrl',
  'sound',
  'badge',
  'ttlSeconds',
  'priority',
  'channelId',
  'subtitle',
  'categoryId',
  'collapseKey',
  'threadId',
  'mutableContent',
  'contentAvailable'
] as const satisfies readonly (keyof PushSendOptions)[]

/** The fields of {@link PushSendOptions} that the list leaves out; `never` while it lists them all. */
export type UnlistedPushKey = Exclude<keyof PushSendOptions, (typeof PUSH_KEYS)[number]>

/** The text fields that are optional, in the order they are checked. */
const OPTIONAL_TEXT = [
  'imageUrl',
  'sound',
  'channelId',
  'subtitle',
  'categoryId',
  'collapseKey',
  'threadId'
] as const

/** A push as the providers receive it: the tokens apart from the message every token gets. */
export interface ReadPush {
  /** Every device token, in the order the caller gave them. */
  readonly tokens: readonly string[]
  /** The message, with no `tokens` key. */
  readonly message: Readonly<Omit<PushSendOptions, 'tokens'>>
}

/** Whether a value is a string of at most `limit` characters. */
function isText(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit
}

/** Whether a string holds a control character, which no token, id or key legitimately has. */
function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x20 || code === 0x7f) {
      return true
    }
  }
  return false
}

/** Whether an entry can be a token or a ticket id: bounded, not empty, and with no control character. */
export function isUsableToken(entry: string): boolean {
  return entry.length > 0 && entry.length <= MAX_PUSH_TOKEN_LENGTH && !hasControl(entry)
}

/**
 * Reads one string or a bounded, non-empty list of strings. What each string holds is not judged
 * here: a device token that is empty, too long or holds a control character is answered
 * `token_invalid` by the caller on its own, so one bad token never fails the batch.
 *
 * @param owner - The component that reads, for the refusal.
 * @param label - The parameter, for the refusal.
 * @param value - What the caller gave.
 * @returns The entries, at least one, in the order given.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` when the value is not a bounded list of strings.
 */
export function readTokenList(owner: string, label: string, value: unknown): string[] {
  const list: string[] =
    typeof value === 'string' ? [value] : boundedList(owner, label, value, isString)
  if (list.length === 0) {
    throw refuseInput(owner, label, 'needs at least one entry')
  }
  return list
}

/**
 * Reads a ticket-id list: one string, or a list of strings, each bounded and printable.
 *
 * @param owner - The component that reads, for the refusal.
 * @param label - The parameter, for the refusal.
 * @param value - What the caller gave.
 * @returns The ids, at least one.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` for anything else.
 */
export function readIdList(owner: string, label: string, value: unknown): string[] {
  const list = readTokenList(owner, label, value)
  if (!list.every(isUsableToken)) {
    throw refuseInput(owner, label, 'holds an entry that is not a bounded, printable string')
  }
  return list
}

/** Whether an entry is a string; its length and characters are judged by the caller. */
function isString(entry: unknown): entry is string {
  return typeof entry === 'string'
}

/** Reads a required text field. */
function requiredText(owner: string, label: string, value: unknown): string {
  if (!isText(value, MAX_PUSH_TEXT)) {
    throw refuseInput(
      owner,
      label,
      `must be a string of at most ${String(MAX_PUSH_TEXT)} characters`
    )
  }
  return value
}

/** Reads the `data` payload: string values under string keys, copied once into an object with no prototype. */
function readData(owner: string, value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw refuseInput(owner, 'data', 'must be an object of strings')
  }
  if (!isPlainOrClassInstance(value)) {
    throw refuseInput(owner, 'data', 'must be a plain object')
  }
  const names = namesOf(value)
  if (names.length > MAX_PUSH_DATA_KEYS) {
    throw refuseInput(owner, 'data', `has more than ${String(MAX_PUSH_DATA_KEYS)} keys`)
  }
  const copy = nullProto<Record<string, string>>({})
  for (const name of names) {
    const entry = readName(value, name)
    if (!isText(entry, MAX_PUSH_TEXT) || name.length > MAX_PUSH_TOKEN_LENGTH) {
      throw refuseInput(owner, 'data', 'holds a key or a value that is not a bounded string')
    }
    Reflect.set(copy, name, entry)
  }
  return copy
}

/** Reads a non-negative integer field. */
function readCount(owner: string, label: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw refuseInput(owner, label, 'must be a non-negative integer')
  }
  return value
}

/** Reads a boolean field. */
function readFlag(owner: string, label: string, value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw refuseInput(owner, label, 'must be a boolean')
  }
  return value
}

/** Reads the optional fields of a push that are not the required text. */
function readOptional(owner: string, copy: Record<string, unknown>): Record<string, unknown> {
  const message = nullProto<Record<string, unknown>>({})
  for (const label of OPTIONAL_TEXT) {
    const value: unknown = Reflect.get(copy, label)
    if (value !== undefined) {
      Reflect.set(message, label, requiredText(owner, label, value))
    }
  }
  if (copy.data !== undefined) {
    message.data = readData(owner, copy.data)
  }
  for (const label of ['badge', 'ttlSeconds'] as const) {
    if (Reflect.get(copy, label) !== undefined) {
      Reflect.set(message, label, readCount(owner, label, Reflect.get(copy, label)))
    }
  }
  for (const label of ['mutableContent', 'contentAvailable'] as const) {
    if (Reflect.get(copy, label) !== undefined) {
      Reflect.set(message, label, readFlag(owner, label, Reflect.get(copy, label)))
    }
  }
  if (copy.priority !== undefined) {
    if (copy.priority !== 'high' && copy.priority !== 'normal') {
      throw refuseInput(owner, 'priority', "must be 'high' or 'normal'")
    }
    message.priority = copy.priority
  }
  return message
}

/**
 * Reads and checks a push once.
 *
 * @param owner - The component that reads, for the refusal.
 * @param options - The push as the caller gave it.
 * @returns The tokens and the message, copied, each field read once.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` when a field is not of its kind.
 */
export function readPush(owner: string, options: PushSendOptions): ReadPush {
  if (typeof options !== 'object' || options === null) {
    throw refuseInput(owner, 'options', 'must be an object')
  }
  const copy = copyByName(options, PUSH_KEYS)
  const tokens = readTokenList(owner, 'tokens', copy.tokens)
  const message = readOptional(owner, copy)
  message.title = requiredText(owner, 'title', copy.title)
  message.body = requiredText(owner, 'body', copy.body)
  return { tokens, message: message as ReadPush['message'] }
}
