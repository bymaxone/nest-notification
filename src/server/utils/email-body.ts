/**
 * @fileoverview Refuses an html or text part that is not a string.
 * @layer utils
 *
 * A transport reads more than strings: nodemailer sends a Buffer as content and reads an object as a
 * content descriptor (a `path` included), and the Resend SDK forwards what it is given. The scrub
 * that removes a body echoed in an error compares strings, so a part of another type would be sent
 * and never compared. The refusal is made before anything is built, audited or sent, and it names
 * the part, never its value.
 */

import { NotificationException } from '../errors/notification-exception'

/**
 * Throws `EMAIL_MISSING_BODY` when the html or the text part is present and is not a string. An
 * absent part (`undefined` or `null`) is not refused: a text-only message is a message.
 *
 * @param html - The html part as the caller gave it.
 * @param text - The text part as the caller gave it.
 * @throws NotificationException `EMAIL_MISSING_BODY` with `details.part` naming the first wrong part.
 */
export function assertBodyParts(html: unknown, text: unknown): void {
  for (const [part, value] of [
    ['html', html],
    ['text', text]
  ] as const) {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      throw new NotificationException(
        'EMAIL_MISSING_BODY',
        { part, reason: 'not_a_string' },
        { message: 'The html and text parts of an email must be strings' }
      )
    }
  }
}
