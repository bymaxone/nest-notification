/**
 * @fileoverview Releases the cooldown and the entry of a recipient, each whatever the other does.
 * @layer utils
 */

import type { IOtpStorage } from '../interfaces/otp-storage.interface'

/** The recipient and purpose whose state is released. */
interface Scope {
  tenantId: string
  recipient: string
  purpose: string
}

/**
 * Clears the resend cooldown and deletes the entry. Both run, so a cooldown that cannot be cleared
 * does not leave the orphan entry behind, and an entry that cannot be deleted does not leave the
 * cooldown held.
 *
 * @param storage - The store holding the state.
 * @param scope - The recipient and purpose.
 * @throws The first failure, once both have run.
 */
export async function releaseStored(storage: IOtpStorage, scope: Scope): Promise<void> {
  const failures: unknown[] = []
  for (const undo of [
    (): Promise<void> => storage.clearCooldown(scope.tenantId, scope.recipient, scope.purpose),
    (): Promise<void> => storage.delete(scope.tenantId, scope.recipient, scope.purpose)
  ]) {
    try {
      await undo()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) {
    throw failures[0]
  }
}
