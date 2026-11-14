/**
 * @fileoverview Tells a backing service that is unavailable from one that answered and said no.
 * @layer utils
 *
 * A Redis outage, a refused connection or a timed-out provider is a condition of the world, and an
 * HTTP caller should be told to try again later (503). A wrong password, a malformed command or a
 * defect in the library is not, and answering 503 for it invites retries that cannot succeed. This
 * is the one place that draws the line, for the OTP store and for the email providers alike.
 */

/** Error codes Node, nodemailer and the platform set when a peer cannot be reached or stops answering. */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ESOCKETTIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNABORTED',
  // Set by the reference providers when a provider answered that it is down, or could not be asked.
  'EUNAVAILABLE',
  // nodemailer's own codes: connection, socket and DNS failures.
  'ECONNECTION',
  'ESOCKET',
  'EDNS'
])

/**
 * The texts ioredis 6.0.0 rejects a command with when it cannot reach the server: a closed
 * connection, a command that timed out, a stream that cannot be written with the offline queue off,
 * a command that ran out of reconnection attempts.
 * Matched whole, so a defect whose message merely mentions a phrase is not mistaken for an outage.
 */
const UNAVAILABLE_MESSAGES: readonly RegExp[] = [
  /^Connection is closed\.$/,
  /^Command timed out$/,
  /^Stream isn't writeable and enableOfflineQueue options is false$/,
  /^Reached the max retries per request limit \(which is \d+\)\./
]

/** Error replies a Redis server gives while it cannot serve: a replica, a loading dataset, a down cluster. */
const UNAVAILABLE_REPLY = /^(?:READONLY|LOADING|CLUSTERDOWN)\b/

/** The ioredis error name for a command that ran out of reconnection attempts. */
const MAX_RETRIES_NAME = 'MaxRetriesPerRequestError'

/** Links of a cause chain read; a provider or SDK chooses how deep its chain is. */
const MAX_LINKS = 8

/** Reads one property, `undefined` when the read throws: the value comes from code that is not ours. */
function read(value: unknown, key: string): unknown {
  try {
    return Reflect.get(Object(value), key)
  } catch {
    return undefined
  }
}

/** Whether one error, ignoring its causes, is an unavailability. */
function isUnavailableLink(error: unknown): boolean {
  const code = read(error, 'code')
  if (typeof code === 'string' && UNAVAILABLE_CODES.has(code)) {
    return true
  }
  if (read(error, 'name') === MAX_RETRIES_NAME) {
    return true
  }
  const message = read(error, 'message')
  return (
    typeof message === 'string' &&
    (UNAVAILABLE_REPLY.test(message) ||
      UNAVAILABLE_MESSAGES.some((pattern) => pattern.test(message)))
  )
}

/**
 * Whether a failure from a backing service means the service is unavailable: unreachable, closed,
 * timed out, or a server that cannot serve right now. The error and its first few `cause` links are
 * read, so a provider that wraps the original error is still recognised.
 *
 * Everything else, including every error that names a fault of the caller, the configuration or
 * the library, is not unavailability and keeps whatever status it already had.
 *
 * @param error - The failure to classify.
 * @returns `true` when retrying later is the right response.
 */
export function isUnavailableError(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error
  // `read` answers `undefined` for `null` and `undefined`, so the end of a chain walks itself out:
  // the next link is `undefined`, which has been seen once the walk reaches it twice.
  for (let remaining = MAX_LINKS; remaining > 0; remaining -= 1) {
    if (seen.has(current)) {
      return false
    }
    seen.add(current)
    if (isUnavailableLink(current)) {
      return true
    }
    current = read(current, 'cause')
  }
  return false
}

/** A code as the platform and the SDKs write one: short, upper case, no spaces. */
const CODE_TOKEN = /^[A-Z][A-Z0-9_]{1,31}$/

/**
 * The first error code found on an error or its first few causes, when it is a short token.
 *
 * A provider wraps the failure of its client in an error of its own, and the wrapper has to carry
 * the code across or the status of the failure can no longer be told from its text. Only a
 * token is carried: a code is never allowed to smuggle the provider's words, a recipient or a
 * secret into a place that is logged and serialized.
 *
 * @param error - The failure the client raised.
 * @returns The code, or `undefined` when none is a token.
 */
export function errorCodeOf(error: unknown): string | undefined {
  const seen = new Set<unknown>()
  let current: unknown = error
  for (let remaining = MAX_LINKS; remaining > 0; remaining -= 1) {
    if (seen.has(current)) {
      return undefined
    }
    seen.add(current)
    const code = read(current, 'code')
    if (typeof code === 'string' && CODE_TOKEN.test(code)) {
      return code
    }
    current = read(current, 'cause')
  }
  return undefined
}
