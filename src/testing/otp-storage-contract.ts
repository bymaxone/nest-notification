/**
 * @fileoverview Executable contract for third-party `IOtpStorage` implementations.
 * @layer testing
 *
 * `IOtpStorage` is the extension point where a consumer supplies their own
 * persistence, and four of its obligations cannot be checked by a type: the
 * attempt counter and the cooldown must be mutated ATOMICALLY, the TTL must be
 * applied, and keys must be scoped by `(tenantId, recipient, purpose)` so two
 * tenants never collide. A wrong implementation type-checks, passes a casual
 * smoke test, and silently lets the max-attempts ceiling be bypassed under
 * concurrency — which is exactly how a brute-force limit stops limiting.
 *
 * The cases below are plain async functions that throw on violation, so they
 * plug into any runner (`jest`, `vitest`, `node:test`) without this package
 * depending on one:
 *
 * ```ts
 * import { otpStorageContract } from '@bymax-one/nest-notification/testing'
 *
 * describe('MyOtpStorage', () => {
 *   for (const { name, run } of otpStorageContract(() => new MyOtpStorage(client))) {
 *     it(name, run)
 *   }
 * })
 * ```
 */

import type { IOtpStorage, OtpEntry } from '../server/interfaces/otp-storage.interface'

/** One executable obligation. `run` throws when the storage violates it. */
export interface OtpStorageContractCase {
  /** What the case checks, suitable as a test title. */
  name: string
  /** Runs the case against a fresh storage; throws on violation. */
  run: () => Promise<void>
}

/** How the contract obtains a storage to exercise. */
export type OtpStorageFactory = () => IOtpStorage | Promise<IOtpStorage>

/** Tuning for the cases that must observe real time pass. */
export interface OtpStorageContractOptions {
  /**
   * Milliseconds the TTL case waits for an entry to lapse. Must exceed the
   * storage's own expiry granularity — Redis expires in whole seconds, so the
   * default allows for that. Raise it for a backend with coarser granularity.
   */
  expiryWaitMs?: number
}

/** Default wait for the TTL case: past Redis's one-second expiry granularity. */
const DEFAULT_EXPIRY_WAIT_MS = 1_500

/** Concurrency used by the atomicity cases — enough to lose a race that exists. */
const RACERS = 25

// The identifiers below are arbitrary fixtures: every case reads and writes
// through the same constants, so their VALUES cannot change an outcome — only
// their distinctness can, and that is asserted by the cases themselves. No test
// can distinguish one spelling from another, so mutating them is equivalent.
// Stryker disable StringLiteral
const TENANT = 'contract_tenant_a'
const OTHER_TENANT = 'contract_tenant_b'
const RECIPIENT = 'contract@example.com'
const ABSENT_RECIPIENT = 'contract_absent@example.com'
const PURPOSE = 'contract_purpose'
const OTHER_PURPOSE = 'contract_purpose_other'
/** Code stored by the cases that assert nothing about the code itself. */
const ANY_CODE = '111111'
/** A second, distinct code, for the cases that must tell two entries apart. */
const OTHER_CODE = '222222'
// Stryker restore StringLiteral

/** Builds an entry that expires `ttlMs` from now. */
function makeEntry(ttlMs: number, maxAttempts = 3, code: string = ANY_CODE): OtpEntry {
  return { code, expiresAt: Date.now() + ttlMs, attempts: 0, maxAttempts }
}

/** Throws with `message` when `condition` does not hold. */
function check(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`IOtpStorage contract violated: ${message}`)
  }
}

/** Resolves after `ms`, used only by the TTL case. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/**
 * Builds the contract cases for an `IOtpStorage` implementation.
 *
 * Each case obtains its own storage from `factory` and cleans up the keys it
 * wrote, so the cases are order-independent and safe against a shared backend.
 *
 * @param factory - Produces the storage under test; called once per case.
 * @param options - Timing tuning for the case that waits for a TTL to lapse.
 * @returns The cases to run, each throwing on violation.
 */
export function otpStorageContract(
  factory: OtpStorageFactory,
  options: OtpStorageContractOptions = {}
): OtpStorageContractCase[] {
  const expiryWaitMs = options.expiryWaitMs ?? DEFAULT_EXPIRY_WAIT_MS

  const withStorage = async (body: (storage: IOtpStorage) => Promise<void>): Promise<void> => {
    const storage = await factory()
    try {
      await body(storage)
    } finally {
      await storage.delete(TENANT, RECIPIENT, PURPOSE)
      await storage.delete(OTHER_TENANT, RECIPIENT, PURPOSE)
      await storage.clearCooldown(TENANT, RECIPIENT, PURPOSE)
      await storage.clearCooldown(OTHER_TENANT, RECIPIENT, PURPOSE)
    }
  }

  return [
    {
      name: 'stores an entry and reads it back',
      run: () =>
        withStorage(async (storage) => {
          await storage.set(TENANT, RECIPIENT, PURPOSE, makeEntry(60_000))
          const found = await storage.get(TENANT, RECIPIENT, PURPOSE)

          check(found?.code === ANY_CODE, 'get did not return the entry that was set')
        })
    },
    {
      name: 'returns null for an entry that was never set',
      run: () =>
        withStorage(async (storage) => {
          const missing = await storage.get(TENANT, ABSENT_RECIPIENT, PURPOSE)

          check(missing === null, 'get must return null for an absent entry, not undefined')
        })
    },
    {
      name: 'scopes keys by tenant so two tenants never collide',
      run: () =>
        withStorage(async (storage) => {
          await storage.set(TENANT, RECIPIENT, PURPOSE, makeEntry(60_000))
          await storage.set(OTHER_TENANT, RECIPIENT, PURPOSE, makeEntry(60_000, 3, OTHER_CODE))

          const first = await storage.get(TENANT, RECIPIENT, PURPOSE)
          const second = await storage.get(OTHER_TENANT, RECIPIENT, PURPOSE)

          check(
            first?.code === ANY_CODE && second?.code === OTHER_CODE,
            'the same recipient under two tenants shares one key — one tenant can read or ' +
              "overwrite another tenant's code"
          )
        })
    },
    {
      name: 'scopes keys by purpose',
      run: () =>
        withStorage(async (storage) => {
          await storage.set(TENANT, RECIPIENT, PURPOSE, makeEntry(60_000))
          await storage.set(TENANT, RECIPIENT, OTHER_PURPOSE, makeEntry(60_000, 3, OTHER_CODE))

          const found = await storage.get(TENANT, RECIPIENT, PURPOSE)
          await storage.delete(TENANT, RECIPIENT, OTHER_PURPOSE)

          check(found?.code === ANY_CODE, 'two purposes for one recipient share a key')
        })
    },
    {
      name: 'deletes an entry',
      run: () =>
        withStorage(async (storage) => {
          await storage.set(TENANT, RECIPIENT, PURPOSE, makeEntry(60_000))
          await storage.delete(TENANT, RECIPIENT, PURPOSE)

          check((await storage.get(TENANT, RECIPIENT, PURPOSE)) === null, 'delete left the entry')
        })
    },
    {
      name: 'applies the TTL: an expired entry is gone',
      run: () =>
        withStorage(async (storage) => {
          await storage.set(TENANT, RECIPIENT, PURPOSE, makeEntry(1))
          await wait(expiryWaitMs)

          const found = await storage.get(TENANT, RECIPIENT, PURPOSE)
          const consumed = await storage.consumeAttempt(TENANT, RECIPIENT, PURPOSE)

          check(found === null, 'get returned an entry whose expiresAt has passed')
          check(
            consumed.status === 'not_found',
            'consumeAttempt served an expired entry instead of reporting not_found'
          )
        })
    },
    {
      name: 'consumeAttempt reports not_found when there is no entry',
      run: () =>
        withStorage(async (storage) => {
          const result = await storage.consumeAttempt(TENANT, RECIPIENT, PURPOSE)

          check(result.status === 'not_found', 'consumeAttempt must report not_found')
        })
    },
    {
      name: 'consumeAttempt spends one attempt per call and returns the stored entry',
      run: () =>
        withStorage(async (storage) => {
          await storage.set(TENANT, RECIPIENT, PURPOSE, makeEntry(60_000, 3))

          const first = await storage.consumeAttempt(TENANT, RECIPIENT, PURPOSE)

          check(first.status === 'ok', 'the first attempt must succeed')
          check(
            first.status === 'ok' && first.entry.code === ANY_CODE,
            'consumeAttempt must return the STORED code so the caller can compare it'
          )
          check(
            first.status === 'ok' && first.entry.attempts === 1,
            'consumeAttempt must return the entry with the attempt already counted'
          )
        })
    },
    {
      name: 'consumeAttempt reports max_attempts once the ceiling is reached',
      run: () =>
        withStorage(async (storage) => {
          await storage.set(TENANT, RECIPIENT, PURPOSE, makeEntry(60_000, 2))

          await storage.consumeAttempt(TENANT, RECIPIENT, PURPOSE)
          await storage.consumeAttempt(TENANT, RECIPIENT, PURPOSE)
          const third = await storage.consumeAttempt(TENANT, RECIPIENT, PURPOSE)

          check(third.status === 'max_attempts', 'the ceiling was not enforced')
          check(
            (await storage.get(TENANT, RECIPIENT, PURPOSE)) === null,
            'the entry must be deleted once the ceiling is reached'
          )
        })
    },
    {
      name: 'consumeAttempt is ATOMIC under concurrency',
      run: () =>
        withStorage(async (storage) => {
          const maxAttempts = 5
          await storage.set(TENANT, RECIPIENT, PURPOSE, makeEntry(60_000, maxAttempts))

          const results = await Promise.all(
            Array.from({ length: RACERS }, () => storage.consumeAttempt(TENANT, RECIPIENT, PURPOSE))
          )
          const succeeded = results.filter((result) => result.status === 'ok').length

          check(
            succeeded <= maxAttempts,
            `${succeeded} of ${RACERS} concurrent calls consumed an attempt against a ceiling ` +
              `of ${maxAttempts} — the lookup and the increment are not one indivisible ` +
              'operation, so the brute-force limit can be bypassed by sending requests in parallel'
          )
        })
    },
    {
      name: 'tryAcquireCooldown holds until cleared',
      run: () =>
        withStorage(async (storage) => {
          const acquired = await storage.tryAcquireCooldown(TENANT, RECIPIENT, PURPOSE, 60)
          const second = await storage.tryAcquireCooldown(TENANT, RECIPIENT, PURPOSE, 60)

          check(acquired, 'the first acquire must succeed')
          check(!second, 'a second acquire must fail while the cooldown is held')

          const remaining = await storage.getCooldown(TENANT, RECIPIENT, PURPOSE)
          check(remaining > 0, 'getCooldown must report the seconds still to run')

          await storage.clearCooldown(TENANT, RECIPIENT, PURPOSE)
          check(
            await storage.tryAcquireCooldown(TENANT, RECIPIENT, PURPOSE, 60),
            'clearCooldown must release the cooldown'
          )
        })
    },
    {
      name: 'getCooldown reports zero when no cooldown is held',
      run: () =>
        withStorage(async (storage) => {
          check(
            (await storage.getCooldown(TENANT, RECIPIENT, PURPOSE)) === 0,
            'getCooldown must report 0 when nothing is held'
          )
        })
    },
    {
      name: 'tryAcquireCooldown is ATOMIC under concurrency',
      run: () =>
        withStorage(async (storage) => {
          const results = await Promise.all(
            Array.from({ length: RACERS }, () =>
              storage.tryAcquireCooldown(TENANT, RECIPIENT, PURPOSE, 60)
            )
          )
          const winners = results.filter(Boolean).length

          check(
            winners === 1,
            `${winners} of ${RACERS} concurrent acquires won — the check and the set are not one ` +
              'step, so two resends can both pass and the anti-resend window stops holding'
          )
        })
    }
  ]
}
