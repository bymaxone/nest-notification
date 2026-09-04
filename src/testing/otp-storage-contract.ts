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

import { randomUUID } from 'node:crypto'

import type { IOtpStorage, OtpEntry } from '../server/interfaces/otp-storage.interface'

// The identifiers below are arbitrary fixtures: every case reads and writes
// through the same values, so their SPELLING cannot change an outcome — only
// their distinctness can, and that is asserted by the cases themselves. No test
// can distinguish one spelling from another, so mutating them is equivalent.
// Stryker disable StringLiteral: equivalent — these identifiers are arbitrary fixtures read and written through the same constants, so no test can distinguish one spelling from another; only their distinctness carries meaning and the cases assert that
const KEY_PREFIX = 'nest_notification_contract'
const TENANT_A = 'tenant_a'
const TENANT_B = 'tenant_b'
const RECIPIENT_LOCAL = 'contract@example.com'
const ABSENT_LOCAL = 'absent@example.com'
const PURPOSE_MAIN = 'purpose_main'
const PURPOSE_OTHER = 'purpose_other'
/** Code stored by the cases that assert nothing about the code itself. */
const ANY_CODE = '111111'
/** A second, distinct code, for the cases that must tell two entries apart. */
const OTHER_CODE = '222222'
// Stryker restore StringLiteral

/**
 * Names the keys one contract run owns.
 *
 * Two suites running in parallel against one backend — a runner executing test
 * files concurrently is the ordinary case — would otherwise write and clean up
 * the same keys, and each would see the other's state as a violation. A random
 * scope per invocation keeps runs independent without asking the caller to
 * arrange it.
 */
interface ContractScope {
  tenantA: string
  tenantB: string
  recipient: string
  absentRecipient: string
  purpose: string
  otherPurpose: string
  /** `(tenant, recipient)` pair whose delimiter sits one field to the left. */
  shiftedLeft: readonly [string, string]
  /** The same characters with the delimiter one field to the right. */
  shiftedRight: readonly [string, string]
}

/**
 * Builds a fresh, collision-free scope for one `otpStorageContract()` call.
 *
 * The composed strings are arbitrary: only their distinctness and their
 * uniqueness per run carry meaning, so no test can tell one spelling from
 * another and mutating the pieces is equivalent.
 */
// Stryker disable StringLiteral: equivalent — the composed key strings are arbitrary; only their distinctness and their uniqueness per run carry meaning, neither of which a spelling change alters
function makeScope(): ContractScope {
  const run = randomUUID()
  return {
    tenantA: `${KEY_PREFIX}_${run}_${TENANT_A}`,
    tenantB: `${KEY_PREFIX}_${run}_${TENANT_B}`,
    recipient: `${run}_${RECIPIENT_LOCAL}`,
    absentRecipient: `${run}_${ABSENT_LOCAL}`,
    purpose: `${KEY_PREFIX}_${run}_${PURPOSE_MAIN}`,
    otherPurpose: `${KEY_PREFIX}_${run}_${PURPOSE_OTHER}`,
    // Same characters, two different (tenant, recipient) splits. A key built by
    // joining the raw values around `:` maps both onto one string.
    shiftedLeft: [`${KEY_PREFIX}_${run}_x:y`, 'z'],
    shiftedRight: [`${KEY_PREFIX}_${run}_x`, 'y:z']
  }
}
// Stryker restore StringLiteral

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
   * Milliseconds the TTL cases wait for an entry to lapse. Must exceed the
   * storage's own expiry granularity — Redis expires in whole seconds, so the
   * default allows for that. Raise it for a backend with coarser granularity.
   */
  expiryWaitMs?: number
}

/** Default wait for the TTL cases: past Redis's one-second expiry granularity. */
const DEFAULT_EXPIRY_WAIT_MS = 1_500

/** Concurrency used by the atomicity cases — enough to lose a race that exists. */
const RACERS = 25

/** What every case is handed: the keys it owns and how to obtain a storage. */
interface ContractContext {
  scope: ContractScope
  expiryWaitMs: number
  withStorage: (body: (storage: IOtpStorage) => Promise<void>) => Promise<void>
}

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

/** Resolves after `ms`, used only by the TTL cases. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Removes every key a case may have written, whether or not it threw. */
async function cleanUp(storage: IOtpStorage, scope: ContractScope): Promise<void> {
  const keys = [
    [scope.tenantA, scope.purpose],
    [scope.tenantA, scope.otherPurpose],
    [scope.tenantB, scope.purpose]
  ] as const
  for (const [tenant, purpose] of keys) {
    await storage.delete(tenant, scope.recipient, purpose)
    await storage.clearCooldown(tenant, scope.recipient, purpose)
    await storage.delete(tenant, scope.absentRecipient, purpose)
    await storage.clearCooldown(tenant, scope.absentRecipient, purpose)
  }
  for (const [tenant, recipient] of [scope.shiftedLeft, scope.shiftedRight]) {
    await storage.delete(tenant, recipient, scope.purpose)
    await storage.clearCooldown(tenant, recipient, scope.purpose)
  }
}

function roundTripCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'stores an entry and reads it back',
    run: () =>
      withStorage(async (storage) => {
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, makeEntry(60_000))
        const found = await storage.get(scope.tenantA, scope.recipient, scope.purpose)

        check(found?.code === ANY_CODE, 'get did not return the entry that was set')
      })
  }
}

function absentCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'returns null for an entry that was never set',
    run: () =>
      withStorage(async (storage) => {
        const missing = await storage.get(scope.tenantA, scope.absentRecipient, scope.purpose)

        check(missing === null, 'get must return null for an absent entry, not undefined')
      })
  }
}

function tenantScopeCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'scopes keys by tenant so two tenants never collide',
    run: () =>
      withStorage(async (storage) => {
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, makeEntry(60_000))
        await storage.set(
          scope.tenantB,
          scope.recipient,
          scope.purpose,
          makeEntry(60_000, 3, OTHER_CODE)
        )

        const first = await storage.get(scope.tenantA, scope.recipient, scope.purpose)
        const second = await storage.get(scope.tenantB, scope.recipient, scope.purpose)

        check(
          first?.code === ANY_CODE && second?.code === OTHER_CODE,
          'the same recipient under two tenants shares one key — one tenant can read or ' +
            "overwrite another tenant's code"
        )
      })
  }
}

function recipientScopeCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'scopes keys by recipient',
    run: () =>
      withStorage(async (storage) => {
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, makeEntry(60_000))
        await storage.set(
          scope.tenantA,
          scope.absentRecipient,
          scope.purpose,
          makeEntry(60_000, 3, OTHER_CODE)
        )

        const first = await storage.get(scope.tenantA, scope.recipient, scope.purpose)
        const second = await storage.get(scope.tenantA, scope.absentRecipient, scope.purpose)
        await storage.delete(scope.tenantA, scope.absentRecipient, scope.purpose)

        check(
          first?.code === ANY_CODE && second?.code === OTHER_CODE,
          'two recipients under one tenant share a key — one user can overwrite or verify ' +
            "another user's code"
        )
      })
  }
}

function purposeScopeCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'scopes keys by purpose',
    run: () =>
      withStorage(async (storage) => {
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, makeEntry(60_000))
        await storage.set(
          scope.tenantA,
          scope.recipient,
          scope.otherPurpose,
          makeEntry(60_000, 3, OTHER_CODE)
        )

        const found = await storage.get(scope.tenantA, scope.recipient, scope.purpose)

        check(found?.code === ANY_CODE, 'two purposes for one recipient share a key')
      })
  }
}

function deleteCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'deletes an entry',
    run: () =>
      withStorage(async (storage) => {
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, makeEntry(60_000))
        await storage.delete(scope.tenantA, scope.recipient, scope.purpose)

        const found = await storage.get(scope.tenantA, scope.recipient, scope.purpose)

        check(found === null, 'delete left the entry')
      })
  }
}

function ttlCase({ scope, withStorage, expiryWaitMs }: ContractContext): OtpStorageContractCase {
  return {
    name: 'applies the TTL: an expired entry is gone',
    run: () =>
      withStorage(async (storage) => {
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, makeEntry(1))
        await wait(expiryWaitMs)

        const found = await storage.get(scope.tenantA, scope.recipient, scope.purpose)
        const consumed = await storage.consumeAttempt(scope.tenantA, scope.recipient, scope.purpose)

        check(found === null, 'get returned an entry whose expiresAt has passed')
        check(
          consumed.status === 'not_found',
          'consumeAttempt served an expired entry instead of reporting not_found'
        )
      })
  }
}

function updateKeepsTtlCase({
  scope,
  withStorage,
  expiryWaitMs
}: ContractContext): OtpStorageContractCase {
  return {
    name: 'update preserves the remaining TTL',
    run: () =>
      withStorage(async (storage) => {
        // `consumeOnVerify: false` marks an entry validated through `update`,
        // so an implementation that resets the key's TTL on write extends a
        // live credential past the lifetime the caller configured.
        const entry = makeEntry(1)
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, entry)
        // The real caller marks `validated` here; this case measures the TTL,
        // so it writes the entry back unchanged and lets the expiry decide.
        await storage.update(scope.tenantA, scope.recipient, scope.purpose, entry)
        await wait(expiryWaitMs)

        const found = await storage.get(scope.tenantA, scope.recipient, scope.purpose)

        check(found === null, 'update reset the expiry, extending the code beyond its TTL')
      })
  }
}

function updateAfterExpiryCase({
  scope,
  withStorage,
  expiryWaitMs
}: ContractContext): OtpStorageContractCase {
  return {
    name: 'update does not resurrect an expired entry',
    run: () =>
      withStorage(async (storage) => {
        const entry = makeEntry(1)
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, entry)
        await wait(expiryWaitMs)
        await storage.update(scope.tenantA, scope.recipient, scope.purpose, entry)

        const found = await storage.get(scope.tenantA, scope.recipient, scope.purpose)

        check(found === null, 'update recreated an entry that had already expired')
      })
  }
}

function consumeNotFoundCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'consumeAttempt reports not_found when there is no entry',
    run: () =>
      withStorage(async (storage) => {
        const result = await storage.consumeAttempt(scope.tenantA, scope.recipient, scope.purpose)

        check(result.status === 'not_found', 'consumeAttempt must report not_found')
      })
  }
}

function consumeSpendsCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'consumeAttempt spends one attempt per call and returns the stored entry',
    run: () =>
      withStorage(async (storage) => {
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, makeEntry(60_000, 3))

        const first = await storage.consumeAttempt(scope.tenantA, scope.recipient, scope.purpose)

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
  }
}

function consumeCeilingCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'consumeAttempt reports max_attempts once the ceiling is reached',
    run: () =>
      withStorage(async (storage) => {
        await storage.set(scope.tenantA, scope.recipient, scope.purpose, makeEntry(60_000, 2))

        await storage.consumeAttempt(scope.tenantA, scope.recipient, scope.purpose)
        await storage.consumeAttempt(scope.tenantA, scope.recipient, scope.purpose)
        const third = await storage.consumeAttempt(scope.tenantA, scope.recipient, scope.purpose)
        const found = await storage.get(scope.tenantA, scope.recipient, scope.purpose)

        check(third.status === 'max_attempts', 'the ceiling was not enforced')
        check(found === null, 'the entry must be deleted once the ceiling is reached')
      })
  }
}

function consumeAtomicCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'consumeAttempt is ATOMIC under concurrency',
    run: () =>
      withStorage(async (storage) => {
        const maxAttempts = 5
        await storage.set(
          scope.tenantA,
          scope.recipient,
          scope.purpose,
          makeEntry(60_000, maxAttempts)
        )

        const results = await Promise.all(
          Array.from({ length: RACERS }, () =>
            storage.consumeAttempt(scope.tenantA, scope.recipient, scope.purpose)
          )
        )
        const succeeded = results.filter((result) => result.status === 'ok').length

        check(
          succeeded <= maxAttempts,
          `${succeeded} of ${RACERS} concurrent calls consumed an attempt against a ceiling ` +
            `of ${maxAttempts} — the lookup and the increment are not one indivisible ` +
            'operation, so the brute-force limit can be bypassed by sending requests in parallel'
        )
      })
  }
}

function cooldownHoldsCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'tryAcquireCooldown holds until cleared',
    run: () =>
      withStorage(async (storage) => {
        const acquired = await storage.tryAcquireCooldown(
          scope.tenantA,
          scope.recipient,
          scope.purpose,
          60
        )
        const second = await storage.tryAcquireCooldown(
          scope.tenantA,
          scope.recipient,
          scope.purpose,
          60
        )
        const remaining = await storage.getCooldown(scope.tenantA, scope.recipient, scope.purpose)
        await storage.clearCooldown(scope.tenantA, scope.recipient, scope.purpose)
        const reacquired = await storage.tryAcquireCooldown(
          scope.tenantA,
          scope.recipient,
          scope.purpose,
          60
        )

        check(acquired, 'the first acquire must succeed')
        check(!second, 'a second acquire must fail while the cooldown is held')
        check(remaining > 0, 'getCooldown must report the seconds still to run')
        check(reacquired, 'clearCooldown must release the cooldown')
      })
  }
}

function cooldownZeroCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'getCooldown reports zero when no cooldown is held',
    run: () =>
      withStorage(async (storage) => {
        const remaining = await storage.getCooldown(scope.tenantA, scope.recipient, scope.purpose)

        check(remaining === 0, 'getCooldown must report 0 when nothing is held')
      })
  }
}

function cooldownTenantScopeCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'scopes the cooldown by tenant',
    run: () =>
      withStorage(async (storage) => {
        await storage.tryAcquireCooldown(scope.tenantA, scope.recipient, scope.purpose, 60)
        const other = await storage.tryAcquireCooldown(
          scope.tenantB,
          scope.recipient,
          scope.purpose,
          60
        )

        check(
          other,
          'a cooldown held for one tenant blocked another — cooldown keys are not scoped by ' +
            'tenant, so one tenant can suppress another tenant resends'
        )
      })
  }
}

function cooldownRecipientScopeCase({
  scope,
  withStorage
}: ContractContext): OtpStorageContractCase {
  return {
    name: 'scopes the cooldown by recipient',
    run: () =>
      withStorage(async (storage) => {
        await storage.tryAcquireCooldown(scope.tenantA, scope.recipient, scope.purpose, 60)
        const other = await storage.tryAcquireCooldown(
          scope.tenantA,
          scope.absentRecipient,
          scope.purpose,
          60
        )
        await storage.clearCooldown(scope.tenantA, scope.absentRecipient, scope.purpose)

        check(
          other,
          'a cooldown held for one recipient blocked another — one user can suppress another ' +
            "user's resends"
        )
      })
  }
}

function cooldownPurposeScopeCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'scopes the cooldown by purpose',
    run: () =>
      withStorage(async (storage) => {
        await storage.tryAcquireCooldown(scope.tenantA, scope.recipient, scope.purpose, 60)
        const other = await storage.tryAcquireCooldown(
          scope.tenantA,
          scope.recipient,
          scope.otherPurpose,
          60
        )

        check(
          other,
          'a cooldown held for one purpose blocked another — a password reset and an email ' +
            'verification would share one anti-resend window'
        )
      })
  }
}

function cooldownAtomicCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'tryAcquireCooldown is ATOMIC under concurrency',
    run: () =>
      withStorage(async (storage) => {
        const results = await Promise.all(
          Array.from({ length: RACERS }, () =>
            storage.tryAcquireCooldown(scope.tenantA, scope.recipient, scope.purpose, 60)
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
}

/** Every obligation this contract executes, in the order it reports them. */
function keyBoundaryCase({ scope, withStorage }: ContractContext): OtpStorageContractCase {
  return {
    name: 'keeps the tenant and recipient boundary when composing a key',
    run: () =>
      withStorage(async (storage) => {
        const [leftTenant, leftRecipient] = scope.shiftedLeft
        const [rightTenant, rightRecipient] = scope.shiftedRight

        await storage.set(leftTenant, leftRecipient, scope.purpose, makeEntry(60_000))
        const bled = await storage.get(rightTenant, rightRecipient, scope.purpose)

        check(
          bled === null,
          'an entry written for one tenant was readable by another whose id and recipient ' +
            'differ only in where the boundary falls — the key concatenates the two fields ' +
            'without encoding the split, so one tenant can read and consume another OTP. ' +
            'Hash or length-prefix each field before joining; no digest strength repairs it'
        )
      })
  }
}

const CASE_BUILDERS = [
  roundTripCase,
  absentCase,
  tenantScopeCase,
  recipientScopeCase,
  purposeScopeCase,
  deleteCase,
  ttlCase,
  updateKeepsTtlCase,
  updateAfterExpiryCase,
  consumeNotFoundCase,
  consumeSpendsCase,
  consumeCeilingCase,
  consumeAtomicCase,
  cooldownHoldsCase,
  cooldownZeroCase,
  cooldownTenantScopeCase,
  cooldownRecipientScopeCase,
  cooldownPurposeScopeCase,
  cooldownAtomicCase,
  keyBoundaryCase
] as const

/**
 * Builds the contract cases for an `IOtpStorage` implementation.
 *
 * Each case obtains its own storage from `factory` and cleans up the keys it
 * wrote, so the cases are order-independent. Every call gets a random key scope,
 * so two suites running in parallel against one backend cannot see each other's
 * state as a violation.
 *
 * @param factory - Produces the storage under test; called once per case.
 * @param options - Timing tuning for the cases that wait for a TTL to lapse.
 * @returns The cases to run, each throwing on violation.
 */
export function otpStorageContract(
  factory: OtpStorageFactory,
  options: OtpStorageContractOptions = {}
): OtpStorageContractCase[] {
  const scope = makeScope()
  const context: ContractContext = {
    scope,
    expiryWaitMs: options.expiryWaitMs ?? DEFAULT_EXPIRY_WAIT_MS,
    withStorage: async (body) => {
      const storage = await factory()
      try {
        await body(storage)
      } finally {
        await cleanUp(storage, scope)
      }
    }
  }
  return CASE_BUILDERS.map((build) => build(context))
}
