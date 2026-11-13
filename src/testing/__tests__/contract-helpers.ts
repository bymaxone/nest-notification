/**
 * @fileoverview Shared helpers for the `otpStorageContract` spec files. Lives under `__tests__/`,
 * which the coverage and mutation configs exclude.
 * @layer testing
 */

import type { IOtpStorage } from '../../server/interfaces/otp-storage.interface'
import { otpStorageContract } from '../otp-storage-contract'

/** Short enough to keep the suite fast, long enough for the 1 ms TTL to lapse. */
export const FAST_EXPIRY = { expiryWaitMs: 25 }

/**
 * Wraps a storage in a plain object that forwards every method, so a test can
 * override one of them. A spread cannot do this: the methods live on the
 * prototype, and `{ ...instance }` copies none of them.
 */
export const delegating = (inner: IOtpStorage, overrides: Partial<IOtpStorage>): IOtpStorage => ({
  name: inner.name,
  isConfigured: () => inner.isConfigured(),
  set: (...args) => inner.set(...args),
  get: (...args) => inner.get(...args),
  consumeAttempt: (...args) => inner.consumeAttempt(...args),
  update: (...args) => inner.update(...args),
  delete: (...args) => inner.delete(...args),
  tryAcquireCooldown: (...args) => inner.tryAcquireCooldown(...args),
  getCooldown: (...args) => inner.getCooldown(...args),
  clearCooldown: (...args) => inner.clearCooldown(...args),
  ...(inner.getFailures ? { getFailures: inner.getFailures.bind(inner) } : {}),
  ...(inner.recordFailure ? { recordFailure: inner.recordFailure.bind(inner) } : {}),
  ...(inner.clearFailures ? { clearFailures: inner.clearFailures.bind(inner) } : {}),
  ...overrides
})

export const runCase = async (storage: IOtpStorage, name: string): Promise<void> => {
  const found = otpStorageContract(() => storage, FAST_EXPIRY).find((c) => c.name.includes(name))
  if (!found) {
    throw new Error(`no contract case matching "${name}"`)
  }
  await found.run()
}
