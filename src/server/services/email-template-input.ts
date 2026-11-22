/**
 * @fileoverview Builds the send input a template send hands to the send itself.
 * @layer application
 */

import { nullProto, readName } from '../utils/read-options'
import type { EmailSendInput, EmailSendTemplateInput } from './email.service'

/** A tag of a message. */
type EmailTag = { name: string; value: string }

/**
 * The send input a template send hands to the send itself. Each optional field is carried only when
 * the caller gave it, so an absent field never becomes an `{ x: undefined }` key that the send would
 * read as an explicit value rather than a missing one.
 *
 * @param input - What the caller asked for.
 * @param rendered - The rendered subject and body.
 * @param tags - The tags of the message, the template's among them.
 * @returns The input of the send.
 */
export function templateSendInput(
  input: EmailSendTemplateInput,
  rendered: { subject: string; html: string; text?: string | undefined },
  tags: EmailTag[]
): EmailSendInput {
  // The renderer's answer is the host's object: its fields are read by name, so one it leaves out is
  // absent and not a key planted on the realm root.
  const text = readName(rendered, 'text') as string | undefined
  // No prototype: the send reads `text`, `cc`, `bcc`, `attachments` and the rest by name off this
  // object, and a field that is not set must be absent, not a key planted on the realm root.
  return nullProto({
    tenantId: input.tenantId,
    to: input.to,
    subject: readName(rendered, 'subject') as string,
    html: readName(rendered, 'html') as string,
    tags,
    ...(text !== undefined ? { text } : {}),
    ...(input.from !== undefined ? { from: input.from } : {}),
    ...(input.fromName !== undefined ? { fromName: input.fromName } : {}),
    ...(input.replyTo !== undefined ? { replyTo: input.replyTo } : {}),
    ...(input.userId !== undefined ? { userId: input.userId } : {}),
    ...(input.auditRedactValues !== undefined
      ? { auditRedactValues: input.auditRedactValues }
      : {}),
    ...(input.publishProviderText !== undefined
      ? { publishProviderText: input.publishProviderText }
      : {})
  })
}
