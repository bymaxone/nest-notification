/**
 * @fileoverview Gives a resend cooldown back after the realm check refused the call that took it.
 * @layer utils
 */

import { NOTIFICATION_ERROR_CODES } from '../../shared/constants/error-codes'
import type { IOtpStorage } from '../interfaces/otp-storage.interface'
import { isLibraryError } from './is-library-error'

/**
 * Releases the cooldown when `error` is the realm refusal: the store took the lock before the refusal,
 * and no code was stored or sent, so the recipient must not be locked out of generating. Any other
 * error leaves the lock alone. A failure of the release is dropped: the refusal is what the caller sees.
 *
 * @param storage - The wrapped store.
 * @param ref - The tenant, recipient and purpose.
 * @param error - What the call failed with.
 */
export async function releaseCooldownAfterRefusal(
  storage: IOtpStorage,
  ref: { tenantId: string; recipient: string; purpose: string },
  error: unknown
): Promise<void> {
  if (!isLibraryError(error) || error.code !== NOTIFICATION_ERROR_CODES.INVALID_SCOPE_IDENTIFIER) {
    return
  }
  try {
    await storage.clearCooldown(ref.tenantId, ref.recipient, ref.purpose)
  } catch {
    // The refusal is what the caller sees.
  }
}
