/**
 * @fileoverview The optional compare-and-delete cases of the `IOtpStorage` contract: they check
 * `deleteIfCode` when a storage implements it and pass trivially when it does not. A storage that
 * runs with `otp.consumeOnVerify` must implement it, and these cases hold it to the property the
 * service relies on: of many concurrent callers exactly one removes the entry.
 * @layer testing
 */

import type { ContractContext, OtpStorageContractCase } from './otp-storage-contract.shared'
import { RACERS, check } from './otp-storage-contract.shared'
import type { OtpEntry } from '../server/interfaces/otp-storage.interface'

/** The stored value the cases write and compare. */
const STORED = 'stored-value-1'

/** A different stored value, standing for a code regenerated in between. */
const REGENERATED = 'stored-value-2'

/** An entry with a live lifetime, holding `code` as its stored value. */
function entryOf(code: string): OtpEntry {
  return { code, expiresAt: Date.now() + 60_000, attempts: 0, maxAttempts: 5 }
}

/**
 * `deleteIfCode` removes exactly the value it was given. `expectedStored` is the STORED value the
 * caller read, never a user's guess, so a different stored value (a code regenerated after the
 * read) is left alone, and an absent entry reports `false`.
 */
export function deleteIfCodeCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'deleteIfCode removes only the stored value it is given (optional)',
    run: () =>
      withStorage(async (storage) => {
        if (storage.deleteIfCode === undefined) {
          return
        }
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, entryOf(STORED))

        const other = await storage.deleteIfCode(
          scope.tenantA,
          scope.recipient,
          scope.purpose,
          REGENERATED
        )
        const kept = await storage.get(scope.tenantA, scope.recipient, scope.purpose)
        const match = await storage.deleteIfCode(
          scope.tenantA,
          scope.recipient,
          scope.purpose,
          STORED
        )
        const gone = await storage.get(scope.tenantA, scope.recipient, scope.purpose)
        const absent = await storage.deleteIfCode(
          scope.tenantA,
          scope.recipient,
          scope.purpose,
          STORED
        )

        check(
          other === false && kept?.code === STORED,
          'deleteIfCode removed an entry whose stored value differs from the one it was given, so a code regenerated after the read is destroyed by the verification that read the old one'
        )
        check(
          match === true && gone === null,
          'deleteIfCode did not remove the entry whose stored value it was given'
        )
        check(absent === false, 'deleteIfCode reported true for an entry that was not there')
      })
  }
}

/**
 * Of {@link RACERS} concurrent `deleteIfCode` calls for one stored value exactly one returns
 * `true`. This is what makes `consumeOnVerify` one-time: a read-then-delete lets several callers
 * each see the value and each report success.
 */
export function deleteIfCodeAtomicCase({
  scope,
  withStorage
}: ContractContext): OtpStorageContractCase {
  return {
    name: 'deleteIfCode is ATOMIC under concurrency (optional)',
    run: () =>
      withStorage(async (storage) => {
        if (storage.deleteIfCode === undefined) {
          return
        }
        const { deleteIfCode } = storage
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, entryOf(STORED))

        const results = await Promise.all(
          Array.from({ length: RACERS }, () =>
            deleteIfCode.call(storage, scope.tenantA, scope.recipient, scope.purpose, STORED)
          )
        )
        const winners = results.filter(Boolean).length

        check(
          winners === 1,
          `${String(winners)} of ${String(RACERS)} concurrent deleteIfCode calls reported removing the same entry — the comparison and the delete are not one indivisible operation, so a one-time code is accepted more than once`
        )
      })
  }
}
