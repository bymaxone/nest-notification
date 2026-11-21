/**
 * @fileoverview Reads the lists and the flags of a send once, each of the kind the send uses it as.
 * @layer utils
 *
 * What a caller passes to `send` reaches the provider, the byte budget and the redaction. A list of
 * a million entries, an attachment whose content is a number (its `length` is `undefined`, and
 * `undefined > limit` is false), or a flag that is the string `'false'` would each be read the wrong
 * way, so the send refuses them before anything is built, audited or sent.
 */

import { NotificationException } from '../errors/notification-exception'
import { boundedList, refuseInput } from './bounded-list'

const OWNER = 'EmailService'

const isString = (entry: unknown): entry is string => typeof entry === 'string'
const isObject = (entry: unknown): entry is object => typeof entry === 'object' && entry !== null

/** An attachment's content is text or bytes; anything else has no length the budget can read. */
function hasReadableContent(entry: { content?: unknown }): boolean {
  return typeof entry.content === 'string' || entry.content instanceof Uint8Array
}

/** A recipient field: one string or a bounded list of them, read into a copy. */
function recipients(label: string, value: unknown): string | string[] {
  // A recipient field keeps its own refusal: the same code a list over the channel's limit gets.
  return typeof value === 'string'
    ? value
    : boundedList(
        OWNER,
        label,
        value,
        isString,
        (reason) =>
          new NotificationException('EMAIL_INVALID_RECIPIENT', {
            reason: reason.startsWith('expected at most')
              ? 'too_many_recipients'
              : 'not_a_list_of_strings',
            field: label,
            detail: reason
          })
      )
}

/**
 * Returns the input with each list and flag read once into a copy of the kind the send uses.
 *
 * @param input - The send as the caller gave it.
 * @param keys - Every field of the send, by name.
 * @returns The same fields, the lists being the copies.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` for a list that is too long or of
 *   another kind, an attachment of no readable content, or a `publishProviderText` that is not a
 *   boolean.
 */
export function readSendInput<T extends object>(input: T, keys: readonly (keyof T & string)[]): T {
  // Each named field is read once, by property access, and the copy is what the send goes on with.
  const read: Record<string, unknown> = {}
  for (const key of keys) {
    const value: unknown = Reflect.get(input, key)
    if (value !== undefined) {
      Reflect.set(read, key, value)
    }
  }
  const publish = read.publishProviderText
  if (publish !== undefined && typeof publish !== 'boolean') {
    throw refuseInput(OWNER, 'publishProviderText', 'expected a boolean')
  }
  for (const label of ['to', 'cc', 'bcc']) {
    const value: unknown = Reflect.get(read, label)
    if (value !== undefined) {
      Reflect.set(read, label, recipients(label, value))
    }
  }
  const values: unknown = read.auditRedactValues
  if (values !== undefined) {
    read.auditRedactValues = boundedList(OWNER, 'auditRedactValues', values, isString)
  }
  // An entry is copied, each of its fields read once: a getter that answers a small `content` to the
  // check and the byte budget and a large one to the provider is read once, here, and never again.
  const tags: unknown = read.tags
  if (tags !== undefined) {
    read.tags = boundedList(OWNER, 'tags', tags, isObject).map((tag) => ({ ...tag }))
  }
  const attachments: unknown = read.attachments
  if (attachments !== undefined) {
    read.attachments = boundedList(OWNER, 'attachments', attachments, isObject).map((entry) => {
      const copy: { content?: unknown } = { ...entry }
      if (!hasReadableContent(copy)) {
        throw refuseInput(OWNER, 'attachments', 'an attachment has no readable content')
      }
      return copy
    })
  }
  return read as T
}
