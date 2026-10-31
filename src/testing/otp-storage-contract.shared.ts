/**
 * @fileoverview Types and helpers shared by the `IOtpStorage` contract and its optional
 * failure-counter cases.
 * @layer testing
 */

import type { IOtpStorage } from '../server/interfaces/otp-storage.interface'

/**
 * Names the keys one contract run owns.
 *
 * Two suites running in parallel against one backend — a runner executing test
 * files concurrently is the ordinary case — would otherwise write and clean up
 * the same keys, and each would see the other's state as a violation. A random
 * scope per invocation keeps runs independent without asking the caller to
 * arrange it.
 */
export interface ContractScope {
  tenantA: string
  tenantB: string
  recipient: string
  absentRecipient: string
  purpose: string
  otherPurpose: string
  /**
   * Two `(tenant, recipient)` splits of the same characters, one per delimiter a
   * raw join might use. A key built as `${tenant}${delimiter}${recipient}` maps both
   * members of a shift onto one string, and a single delimiter only catches the
   * joins that use exactly it.
   */
  boundaryShifts: readonly BoundaryShift[]
}

/** The same characters split at two different positions. */
export interface BoundaryShift {
  /** The pair whose delimiter sits one field to the left. */
  left: readonly [string, string]
  /** The pair with the delimiter one field to the right. */
  right: readonly [string, string]
}

/** One executable obligation. `run` throws when the storage violates it. */
export interface OtpStorageContractCase {
  /** What the case checks, suitable as a test title. */
  name: string
  /** Runs the case against a fresh storage; throws on violation. */
  run: () => Promise<void>
}

/** Concurrency used by the atomicity cases — enough to lose a race that exists. */
export const RACERS = 25

/** What every case is handed: the keys it owns and how to obtain a storage. */
export interface ContractContext {
  scope: ContractScope
  expiryWaitMs: number
  withStorage: (body: (storage: IOtpStorage) => Promise<void>) => Promise<void>
}

/** Throws with `message` when `condition` does not hold. */
export function check(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`IOtpStorage contract violated: ${message}`)
  }
}

/** Resolves after `ms`, used only by the TTL cases. */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}
