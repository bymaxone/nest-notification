/**
 * @fileoverview Reads the message a provider is asked to send once, by name.
 * @layer utils
 *
 * The reference adapters are public: a host can call `send` on one directly with a plain object. A
 * field it leaves out must be absent, not whatever a key planted on the realm root answers, so the
 * adapters work from this copy, which has no prototype and holds each field once.
 */

import type { EmailSendOptions } from '../interfaces/email-provider.interface'
import { copyByName } from './bounded-list'

/** Every field of {@link EmailSendOptions}, by name. */
const SEND_OPTION_KEYS = [
  'to',
  'from',
  'fromName',
  'subject',
  'html',
  'text',
  'replyTo',
  'cc',
  'bcc',
  'tags',
  'headers',
  'attachments',
  'redactValues',
  'publishProviderText'
] as const satisfies readonly (keyof EmailSendOptions)[]

/** The fields of {@link EmailSendOptions} that the list leaves out; `never` while it lists them all. */
export type UnlistedSendOptionKey = Exclude<
  keyof EmailSendOptions,
  (typeof SEND_OPTION_KEYS)[number]
>

/**
 * Copies a message for an adapter.
 *
 * @param options - The message as the caller gave it.
 * @returns A copy with no prototype, each field read once.
 */
export function readSendOptions(options: EmailSendOptions): EmailSendOptions {
  return copyByName(options, SEND_OPTION_KEYS) as unknown as EmailSendOptions
}
