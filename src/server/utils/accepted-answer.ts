/**
 * @fileoverview The answer of a send the provider accepted. After the acceptance the message is the
 * provider's to deliver (RFC 5321 section 6.1), so nothing may turn the answer into a failure: a
 * caller told the send failed sends it again.
 * @layer util
 */

import { NOTIFICATION_ERROR_CODES } from '../errors/notification-error-codes'
import { libraryCode } from './provider-refusal'
import { pinOnce } from './realm-root'

// Taken at load, so nothing replaced later decides which answers are marked.
const apply = Reflect.apply
const createBare = Object.create
const defineOwn = Object.defineProperty
const LOADED_ADD = WeakSet.prototype.add
const LOADED_HAS = WeakSet.prototype.has
const answers = new WeakSet<object>()

/**
 * Marks an object the library built as the answer of an accepted send, and gives it an own `then`
 * that is not a function: resolving a promise with it calls nothing planted on a prototype, so it
 * can be returned without checking the realm and refusing.
 *
 * @param answer - A fresh object the library built.
 * @returns The same object.
 */
export function accepted<T extends object>(answer: T): T {
  const descriptor = createBare(null) as { value: undefined }
  descriptor.value = undefined
  defineOwn(answer, 'then', descriptor)
  apply(LOADED_ADD, answers, [answer])
  return answer
}

/**
 * Whether the value is an answer marked by {@link accepted}.
 *
 * @param value - Anything a send path resolved with.
 * @returns `true` for a marked answer.
 */
export function isAccepted(value: unknown): boolean {
  return apply(LOADED_HAS, answers, [value])
}

/**
 * Waits for the audit write of an accepted send. A refusal of the changed realm is warned about and
 * goes no further; any other failure, such as `AUDIT_LOG_FAILED`, is thrown as the host asked.
 *
 * @param write - The audit write, already pinned.
 * @param warn - Where the refusal is reported.
 * @param owner - The service whose send it is.
 */
export async function auditAfterAcceptance(
  write: Promise<void>,
  warn: (error: unknown) => void,
  owner: string
): Promise<void> {
  try {
    await pinOnce(write, owner)
  } catch (error) {
    if (libraryCode(error) !== NOTIFICATION_ERROR_CODES.INVALID_SCOPE_IDENTIFIER) {
      throw error
    }
    warn(error)
  }
}
