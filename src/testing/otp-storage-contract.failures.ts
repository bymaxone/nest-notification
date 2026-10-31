/**
 * @fileoverview The optional failure-counter cases of the `IOtpStorage` contract: they check
 * `getFailures`, `recordFailure` and `clearFailures` when a storage implements all three and
 * pass trivially when it does not.
 * @layer testing
 */

import type { ContractContext, OtpStorageContractCase } from './otp-storage-contract.shared'
import { RACERS, check, wait } from './otp-storage-contract.shared'
import type { IOtpStorage } from '../server/interfaces/otp-storage.interface'

/** The three optional failure methods, present together or not at all. */
interface FailureStorage extends IOtpStorage {
  getFailures: NonNullable<IOtpStorage['getFailures']>
  recordFailure: NonNullable<IOtpStorage['recordFailure']>
  clearFailures: NonNullable<IOtpStorage['clearFailures']>
}

/** Whether the storage carries failed attempts across a re-issue (the optional methods). */
export function hasFailureMethods(storage: IOtpStorage): storage is FailureStorage {
  return (
    storage.getFailures !== undefined &&
    storage.recordFailure !== undefined &&
    storage.clearFailures !== undefined
  )
}

/** Failure lifetime used by the cases that do not exercise expiry. */
const FAILURE_TTL_SECONDS = 60

export function failureCountCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'counts failures per scope (optional: getFailures, recordFailure, clearFailures)',
    run: () =>
      withStorage(async (storage) => {
        if (!hasFailureMethods(storage)) {
          return
        }
        const counts = [
          await storage.recordFailure(
            scope.tenantA,
            scope.recipient,
            scope.purpose,
            FAILURE_TTL_SECONDS
          ),
          await storage.recordFailure(
            scope.tenantA,
            scope.recipient,
            scope.purpose,
            FAILURE_TTL_SECONDS
          ),
          await storage.recordFailure(
            scope.tenantA,
            scope.recipient,
            scope.purpose,
            FAILURE_TTL_SECONDS
          )
        ]
        const read = await storage.getFailures(scope.tenantA, scope.recipient, scope.purpose)
        const none = await storage.getFailures(scope.tenantA, scope.absentRecipient, scope.purpose)

        check(
          counts.join() === '1,2,3',
          `recordFailure returned ${counts.join()} for three failures instead of 1,2,3`
        )
        check(read === 3, `getFailures returned ${String(read)} after three failures`)
        check(none === 0, 'getFailures returned a count for a scope that never failed')
      })
  }
}

export function failureScopeCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'scopes the failure counter by tenant, recipient and purpose',
    run: () =>
      withStorage(async (storage) => {
        if (!hasFailureMethods(storage)) {
          return
        }
        await storage.recordFailure(
          scope.tenantA,
          scope.recipient,
          scope.purpose,
          FAILURE_TTL_SECONDS
        )

        const otherTenant = await storage.getFailures(scope.tenantB, scope.recipient, scope.purpose)
        const otherRecipient = await storage.getFailures(
          scope.tenantA,
          scope.absentRecipient,
          scope.purpose
        )
        const otherPurpose = await storage.getFailures(
          scope.tenantA,
          scope.recipient,
          scope.otherPurpose
        )

        check(otherTenant === 0, 'a failure recorded for one tenant counted against another')
        check(otherRecipient === 0, 'a failure recorded for one recipient counted against another')
        check(otherPurpose === 0, 'a failure recorded for one purpose counted against another')
      })
  }
}

export function failureBoundaryCase({
  scope,
  withStorage
}: ContractContext): OtpStorageContractCase {
  return {
    name: 'keeps the tenant and recipient boundary when composing a failure-counter key',
    run: () =>
      withStorage(async (storage) => {
        if (!hasFailureMethods(storage)) {
          return
        }
        for (const { left, right } of scope.boundaryShifts) {
          await storage.recordFailure(left[0], left[1], scope.purpose, FAILURE_TTL_SECONDS)
          const bled = await storage.getFailures(right[0], right[1], scope.purpose)

          check(
            bled === 0,
            'a failure recorded for one tenant counted against another whose id and recipient ' +
              'differ only in where the boundary falls — the counter key concatenates the two ' +
              'fields without encoding the split, so one tenant can lock another out. The entry ' +
              'key, the cooldown key and the counter key are composed separately and all need this'
          )
        }
      })
  }
}

export function failureClearCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'clearFailures removes only its own counter and is idempotent',
    run: () =>
      withStorage(async (storage) => {
        if (!hasFailureMethods(storage)) {
          return
        }
        await storage.recordFailure(
          scope.tenantA,
          scope.recipient,
          scope.purpose,
          FAILURE_TTL_SECONDS
        )
        await storage.recordFailure(
          scope.tenantA,
          scope.absentRecipient,
          scope.purpose,
          FAILURE_TTL_SECONDS
        )

        await storage.clearFailures(scope.tenantA, scope.recipient, scope.purpose)
        await storage.clearFailures(scope.tenantA, scope.recipient, scope.purpose)

        check(
          (await storage.getFailures(scope.tenantA, scope.recipient, scope.purpose)) === 0,
          'getFailures still counted failures after clearFailures'
        )
        check(
          (await storage.getFailures(scope.tenantA, scope.absentRecipient, scope.purpose)) === 1,
          'clearFailures removed the counter of another recipient'
        )
      })
  }
}

export function failureTtlCase({
  scope,
  withStorage,
  expiryWaitMs
}: ContractContext): OtpStorageContractCase {
  return {
    name: 'a failure counter lapses after its lifetime',
    run: () =>
      withStorage(async (storage) => {
        if (!hasFailureMethods(storage)) {
          return
        }
        // A fraction of a second: a storage rounds the lifetime up to its own granularity
        // (Redis keeps whole seconds), which `expiryWaitMs` is there to outlast.
        await storage.recordFailure(scope.tenantA, scope.recipient, scope.purpose, 0.001)
        await wait(expiryWaitMs)

        check(
          (await storage.getFailures(scope.tenantA, scope.recipient, scope.purpose)) === 0,
          'getFailures counted a failure whose lifetime had passed — a counter that never lapses ' +
            'locks a recipient out for good'
        )
        check(
          (await storage.recordFailure(
            scope.tenantA,
            scope.recipient,
            scope.purpose,
            FAILURE_TTL_SECONDS
          )) === 1,
          'a lapsed counter did not start again from one'
        )
      })
  }
}

export function failureAtomicCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'recordFailure is ATOMIC under concurrency',
    run: () =>
      withStorage(async (storage) => {
        if (!hasFailureMethods(storage)) {
          return
        }
        const counts = await Promise.all(
          Array.from({ length: RACERS }, () =>
            storage.recordFailure(
              scope.tenantA,
              scope.recipient,
              scope.purpose,
              FAILURE_TTL_SECONDS
            )
          )
        )
        const distinct = new Set(counts).size

        check(
          distinct === RACERS,
          `${String(RACERS)} concurrent failures produced only ${String(distinct)} distinct counts — the ` +
            'read and the write are not one step, so concurrent wrong guesses are lost and the ' +
            'attempt ceiling can be exceeded'
        )
      })
  }
}
