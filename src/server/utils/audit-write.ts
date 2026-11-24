/**
 * @fileoverview Writes one audit entry through a host's repository: the host's failures are the
 * `swallowErrors` policy's to absorb, and a refusal of the realm is never one of them.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'
import { checkedAwait } from './realm-root'

/**
 * Starts the write, checks the realm, then awaits it. A synchronous throw and a rejection both go
 * to the policy; the realm refusal is thrown between the two, outside what the policy absorbs.
 *
 * @param start - Calls the host's `create`.
 * @param swallowErrors - When `false`, a host failure surfaces as `AUDIT_LOG_FAILED`.
 * @param warn - Records a swallowed failure.
 * @param owner - The boundary named in a realm refusal.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` on a changed realm, `AUDIT_LOG_FAILED`
 * on a host failure when `swallowErrors` is `false`.
 */
export async function writeAudit(
  start: () => Promise<void>,
  swallowErrors: boolean,
  warn: (error: unknown) => void,
  owner: string
): Promise<void> {
  const absorb = (error: unknown): void => {
    if (!swallowErrors) {
      // The cause rides on `Error.cause` only: `details` is serialized into the HTTP response.
      throw new NotificationException('AUDIT_LOG_FAILED', undefined, { cause: error })
    }
    warn(error)
  }
  let pending: Promise<void>
  try {
    pending = start()
  } catch (error) {
    return absorb(error)
  }
  const checked = checkedAwait(pending, owner)
  try {
    await checked
  } catch (error) {
    absorb(error)
  }
}
