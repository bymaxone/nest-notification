/**
 * @fileoverview Puts the masked recipient where an error's text carries the raw one.
 * @layer utils
 */

/**
 * Replaces every occurrence of the recipient in `text` with its masked form.
 *
 * A store's error text can name the key or the address it failed on, and the audit entry that
 * carries the text is the place `audit.maskRecipient` promises the address does not appear.
 *
 * @param text - The text an audit entry would carry.
 * @param recipient - The recipient as the caller gave it.
 * @param masked - The recipient as `audit.maskRecipient` returns it.
 * @returns The text with every occurrence of `recipient` replaced; `text` itself when `recipient` is empty.
 */
export function maskRecipientInText(text: string, recipient: string, masked: string): string {
  return recipient === '' ? text : text.split(recipient).join(masked)
}
