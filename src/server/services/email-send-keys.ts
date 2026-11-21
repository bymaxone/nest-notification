/**
 * @fileoverview The fields of a send and of a template send, by name, for the reader that copies
 * them once.
 * @layer domain
 */

import type { EmailSendInput, EmailSendTemplateInput } from './email.service'

/**
 * Every field of {@link EmailSendInput}, read by name: a send whose fields come from a class
 * (getters, a prototype, non-enumerable properties) keeps every one of them, which a spread of own
 * enumerable properties would drop. A field the type gains and this list misses fails to compile.
 */
export const SEND_KEYS = [
  'tenantId',
  'to',
  'subject',
  'html',
  'text',
  'from',
  'fromName',
  'replyTo',
  'cc',
  'bcc',
  'tags',
  'attachments',
  'userId',
  'auditRedactValues',
  'publishProviderText'
] as const satisfies readonly (keyof EmailSendInput)[]

/** The fields of {@link EmailSendInput} that {@link SEND_KEYS} leaves out; `never` while it lists them all. */
export type UnlistedSendKey = Exclude<keyof EmailSendInput, (typeof SEND_KEYS)[number]>

/** Every field of {@link EmailSendTemplateInput}, read by name for the same reason as {@link SEND_KEYS}. */
export const TEMPLATE_KEYS = [
  'tenantId',
  'to',
  'template',
  'data',
  'locale',
  'from',
  'fromName',
  'replyTo',
  'tags',
  'userId',
  'auditRedactValues',
  'publishProviderText'
] as const satisfies readonly (keyof EmailSendTemplateInput)[]

/** The fields of {@link EmailSendTemplateInput} that {@link TEMPLATE_KEYS} leaves out; `never` while it lists them all. */
export type UnlistedTemplateKey = Exclude<
  keyof EmailSendTemplateInput,
  (typeof TEMPLATE_KEYS)[number]
>
