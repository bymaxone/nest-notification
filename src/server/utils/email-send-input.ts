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
function isAttachment(entry: unknown): entry is { content: string | Uint8Array } {
  if (!isObject(entry)) {
    return false
  }
  const content: unknown = Reflect.get(entry, 'content')
  return typeof content === 'string' || content instanceof Uint8Array
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
            reason: 'too_many_recipients',
            field: label,
            detail: reason
          })
      )
}

/**
 * Returns the input with each list and flag read once into a copy of the kind the send uses.
 *
 * @param input - The send as the caller gave it.
 * @returns The same fields, the lists being the copies.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` for a list that is too long or of
 *   another kind, an attachment of no readable content, or a `publishProviderText` that is not a
 *   boolean.
 */
export function readSendInput<T extends object>(input: T): T {
  // Each field is read once here, and the copy is what the send goes on with.
  const read = { ...input } as Record<string, unknown>
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
  const lists: ReadonlyArray<readonly [string, (entry: unknown) => boolean]> = [
    ['attachments', isAttachment],
    ['tags', isObject],
    ['auditRedactValues', isString]
  ]
  for (const [label, isEntry] of lists) {
    const value: unknown = Reflect.get(read, label)
    if (value !== undefined) {
      Reflect.set(
        read,
        label,
        boundedList(OWNER, label, value, isEntry as (e: unknown) => e is unknown)
      )
    }
  }
  return read as T
}
