/**
 * @fileoverview Hands Nodemailer the recipients and the body of a message as objects that own every
 * name it reads on them.
 * @layer infrastructure
 *
 * Nodemailer reads `address` off each entry of a list of recipients and `filename`, `path`, `href`,
 * `raw`, `encoding`, `contentType`, `headers` and the rest off each part of a body, and a string has
 * no keys of its own: a name planted on the realm root after the checks of a send are made would be
 * read for it, and `address` would then decide who receives the message. An object with an own key
 * for each name answers for itself. A recipient that is not a bare mailbox (`Bob <bob@x.com>`) stays
 * the string it was, for Nodemailer to parse: that is a limit, stated in the README.
 */

import { nullProto, withOwnKeys } from '../utils/read-options'
import type { SmtpBodyPart, SmtpRecipient } from './smtp-email.types'

/** A bare mailbox: no display name, quoting, comment or group syntax around the address. */
const MAILBOX = /^[^\s<>",;:()[\]\\]+@[^\s<>",;:()[\]\\]+$/u

/** The names Nodemailer reads on a body part (an alternative). */
const BODY_KEYS =
  'path href filename contentType contentTransferEncoding raw content encoding headers httpHeaders tls'.split(
    ' '
  )

/** The names Nodemailer reads on a recipient object. */
const ADDRESS_KEYS = 'name address group'.split(' ')

/**
 * One recipient as an object with its own keys, or the string it was when it is more than a mailbox.
 *
 * @param address - The recipient as the caller gave it.
 * @returns The object, or the string.
 */
function ownAddress(address: string): SmtpRecipient {
  return MAILBOX.test(address) ? withOwnKeys({ name: '', address }, ADDRESS_KEYS) : address
}

/** What {@link ownRecipients} answers for a value: nothing, one recipient, or a list of them. */
type OwnRecipients<T> = T extends undefined
  ? undefined
  : T extends string
    ? SmtpRecipient
    : SmtpRecipient[]

/**
 * The recipients of a header as objects with their own keys.
 *
 * @param value - One recipient, a list of them, or none.
 * @returns The same shape, each mailbox an object.
 */
export function ownRecipients<T extends string | string[] | undefined>(value: T): OwnRecipients<T> {
  if (value === undefined) {
    return undefined as OwnRecipients<T>
  }
  return (typeof value === 'string' ? ownAddress(value) : value.map(ownAddress)) as OwnRecipients<T>
}

/**
 * A body as an object with its own keys.
 *
 * An empty string is no part: Nodemailer reads a falsy body as absent, and an object around it
 * fails the build.
 *
 * @param content - The text or the HTML, or nothing.
 * @returns The part Nodemailer is given, or nothing.
 */
export function ownBody<T extends string | undefined>(
  content: T
): T extends undefined ? undefined : SmtpBodyPart {
  return (
    content === undefined || content === ''
      ? undefined
      : withOwnKeys(nullProto({ content }), BODY_KEYS)
  ) as T extends undefined ? undefined : SmtpBodyPart
}
