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
import type { EmailAttachment, EmailSendOptions } from '../interfaces/email-provider.interface'
import { boundedList, copyByName, refuseInput } from './bounded-list'

const OWNER = 'EmailService'

const isString = (entry: unknown): entry is string => typeof entry === 'string'
const isObject = (entry: unknown): entry is object => typeof entry === 'object' && entry !== null

type EmailTag = NonNullable<EmailSendOptions['tags']>[number]

/** Every field of a tag and of an attachment, read by name. */
const TAG_KEYS = ['name', 'value'] as const satisfies readonly (keyof EmailTag)[]
const ATTACHMENT_KEYS = [
  'filename',
  'content',
  'contentType'
] as const satisfies readonly (keyof EmailAttachment)[]

const KNOWN_ATTACHMENT_KEYS: readonly string[] = ATTACHMENT_KEYS

/** The fields of a tag or an attachment that the lists above leave out; `never` while they list them all. */
export type UnlistedEntryKey =
  | Exclude<keyof EmailTag, (typeof TAG_KEYS)[number]>
  | Exclude<keyof EmailAttachment, (typeof ATTACHMENT_KEYS)[number]>

/** The prototype getter of a typed array's byte length, which an own property cannot shadow. */
const byteLengthOf = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype) as object,
  'byteLength'
)?.get as (this: Uint8Array) => number

/**
 * The size of an attachment's content in bytes: the UTF-8 length of a string, and for bytes the
 * length the typed array's own getter answers, so an own `length` or `byteLength` property set on
 * a `Uint8Array` or a `Buffer` cannot make the content look smaller than it is.
 *
 * @param content - A string, a `Buffer` or a `Uint8Array`.
 * @returns The number of bytes.
 */
export function attachmentBytes(content: string | Uint8Array): number {
  return typeof content === 'string' ? Buffer.byteLength(content) : byteLengthOf.call(content)
}

/**
 * Copies an attachment, each field read once by name, after refusing a field the library does not
 * carry (it would be dropped, and a dropped inline-image field breaks the message without a word)
 * and a field of another kind than the contract declares.
 */
function readAttachment(entry: object): Record<string, unknown> {
  if (Object.keys(entry).some((key) => !KNOWN_ATTACHMENT_KEYS.includes(key))) {
    throw refuseInput(OWNER, 'attachments', 'an attachment has a field the library does not carry')
  }
  const copy = copyByName(entry, ATTACHMENT_KEYS)
  const { filename, content, contentType } = copy
  if (
    (filename !== undefined && typeof filename !== 'string') ||
    (contentType !== undefined && typeof contentType !== 'string')
  ) {
    throw refuseInput(OWNER, 'attachments', 'an attachment has a field of an unexpected kind')
  }
  if (typeof content !== 'string' && !(content instanceof Uint8Array)) {
    throw refuseInput(OWNER, 'attachments', 'an attachment has no readable content')
  }
  return copy
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
  const read = copyByName(input, keys)
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
    read.tags = boundedList(OWNER, 'tags', tags, isObject).map((tag) => copyByName(tag, TAG_KEYS))
  }
  const attachments: unknown = read.attachments
  if (attachments !== undefined) {
    read.attachments = boundedList(OWNER, 'attachments', attachments, isObject).map(readAttachment)
  }
  return read as T
}
