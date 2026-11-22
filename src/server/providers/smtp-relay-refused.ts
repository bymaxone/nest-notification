/**
 * @fileoverview The one answer SmtpEmailProvider.verify() gives for a connection that failed.
 * @layer infrastructure
 *
 * Nodemailer's own text can quote the options, so the answer is the same words whatever the cause.
 */

/**
 * Throws the answer for a relay that did not accept the connection.
 *
 * @throws Error Always, with a fixed message.
 */
export function relayRefused(): never {
  throw new Error('SmtpEmailProvider: the relay did not accept the connection')
}
