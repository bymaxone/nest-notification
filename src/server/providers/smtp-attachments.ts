/**
 * @fileoverview Maps the library's attachments onto the shape Nodemailer takes.
 * @layer infrastructure
 */

import type { EmailAttachment } from '../interfaces/email-provider.interface'
import { nullProto } from '../utils/read-options'
import type { SmtpAttachment } from './smtp-email.types'

/**
 * Maps the library's attachments onto Nodemailer's shape.
 *
 * `EmailAttachment.content` is documented as a `Buffer` **or a base64 string**, so a string is
 * tagged `encoding: 'base64'` — left untagged, Nodemailer would treat the base64 text as the literal
 * body and deliver a corrupt file. Each attachment has no prototype: Nodemailer reads keys this
 * library never sets (`path`, `href`, `raw`), and a key planted on the realm root must not answer for
 * them.
 *
 * @param attachments - The attachments to map, if any.
 * @returns The mapped attachments, or `undefined` when there are none.
 */
export function mapSmtpAttachments(
  attachments: ReadonlyArray<EmailAttachment> | undefined
): SmtpAttachment[] | undefined {
  return attachments?.map((attachment) => {
    // Each field is read once: the encoding and the content must describe the same value.
    const { filename, content, contentType, cid, contentDisposition } = attachment
    return nullProto({
      filename,
      content,
      contentType,
      encoding: typeof content === 'string' ? 'base64' : undefined,
      cid,
      contentDisposition
    })
  })
}
