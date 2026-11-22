/**
 * @fileoverview What an adapter may publish of the code a provider's error carried.
 * @layer utils
 *
 * A provider's error can carry a code (`ECONNREFUSED`, an SDK's token). The adapters copy it to the
 * error they throw and read it for the status of the failure, so it must not hold a value the caller
 * declared secret.
 */

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
