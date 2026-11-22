/**
 * @fileoverview The one error a provider's failure becomes where it enters the library.
 * @layer utils
 *
 * A provider's error can carry the address it refused in its message, its stack and any link of its
 * cause chain. The send keeps none of that: what travels on as the `cause` is a fresh error that
 * holds the text after the secrets are removed and the address-shaped tokens are masked, and the
 * provider's own code when it has one.
 */

import { errorCodeOf } from './availability'

/**
 * The provider's code, unless it holds a value the caller declared secret: a code is a token the
 * provider chose, and nothing says it is safe to publish.
 *
 * @param code - The code the provider's error carried, if any.
 * @param secrets - The values declared secret for the send.
 * @returns `code`, or `undefined` when there is none or it holds a secret.
 */
export function codeWithoutSecrets(
  code: string | undefined,
  secrets: readonly string[] | undefined
): string | undefined {
  return secrets?.some((secret) => secret !== '' && code?.includes(secret)) ? undefined : code
}

/**
 * Builds the `cause` of a failed send.
 *
 * @param text - The provider's message with secrets removed and address tokens masked.
 * @param error - What the provider raised, read only for its code.
 * @param secrets - The values declared secret for the send, which the code must not hold.
 * @returns A new `Error` that carries `text` and the code, and nothing else of `error`.
 */
export function maskedFailure(text: string, error: unknown, secrets: readonly string[]): Error {
  const failure = new Error(text)
  const code = codeWithoutSecrets(errorCodeOf(error), secrets)
  return code === undefined ? failure : Object.assign(failure, { code })
}
