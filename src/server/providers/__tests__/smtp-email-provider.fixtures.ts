/**
 * @fileoverview Shared fixtures for the SmtpEmailProvider spec files. Lives
 * under `__tests__/`, which the coverage and mutation configs exclude.
 * @layer infrastructure
 */

import type { EmailSendOptions } from '../../interfaces/email-provider.interface'

export const baseOptions: EmailSendOptions = {
  to: 'jane@acme.com',
  from: 'noreply@acme.com',
  subject: 'Your code',
  html: '<p>Secret 123456</p>',
  text: 'Secret 123456'
}

/**
 * What an adapter handed to the transport, without the keys that are set to `undefined`: the adapter
 * gives Nodemailer an own key for every name it reads, set to `undefined` when the host set none, so
 * a key planted on the realm root cannot answer for it. A spec that asks what the host configured
 * compares this, and a spec of the planted keys asserts on the object itself.
 */
export function definedOnly(value: unknown): Record<string, unknown> {
  const isOptions = (item: unknown): item is object =>
    typeof item === 'object' && item !== null && !Array.isArray(item) && !ArrayBuffer.isView(item)
  const strip = (item: unknown): unknown =>
    isOptions(item)
      ? Object.fromEntries(
          Object.entries(item)
            .filter(([, entry]) => entry !== undefined)
            .map(([key, entry]) => [key, strip(entry)])
        )
      : item
  return strip(value) as Record<string, unknown>
}
