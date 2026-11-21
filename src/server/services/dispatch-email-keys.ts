/**
 * @fileoverview The fields of an email dispatch payload, by name, for the reader that copies them
 * once.
 * @layer domain
 */

import type { EmailDispatchPayload } from './notification.service'

/** Every field of {@link EmailDispatchPayload}, read by name. */
export const DISPATCH_EMAIL_KEYS = [
  'to',
  'template',
  'data',
  'locale',
  'subject',
  'html',
  'text',
  'from',
  'fromName',
  'replyTo',
  'tags',
  'userId'
] as const satisfies readonly (keyof EmailDispatchPayload)[]

/** The fields of {@link EmailDispatchPayload} that the list leaves out; `never` while it lists them all. */
export type UnlistedDispatchEmailKey = Exclude<
  keyof EmailDispatchPayload,
  (typeof DISPATCH_EMAIL_KEYS)[number]
>
