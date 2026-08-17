/**
 * @fileoverview Specs for the published `IOtpStorage` contract: it must pass
 * against the bundled reference storage AND fail against a storage that
 * violates each obligation, since a contract that cannot fail is decoration.
 * @layer testing
 */

import type { ConsumeAttemptResult, IOtpStorage } from '../server/interfaces/otp-storage.interface'
import { InMemoryOtpStorage } from '../server/providers/in-memory-otp.storage'

import { otpStorageContract } from './otp-storage-contract'

/** Short enough to keep the suite fast, long enough for the 1 ms TTL to lapse. */
const FAST_EXPIRY = { expiryWaitMs: 25 }

/**
 * Wraps a storage in a plain object that forwards every method, so a test can
 * override one of them. A spread cannot do this: the methods live on the
 * prototype, and `{ ...instance }` copies none of them.
 */
const delegating = (inner: IOtpStorage, overrides: Partial<IOtpStorage>): IOtpStorage => ({
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
  ...overrides
})

const runCase = async (storage: IOtpStorage, name: string): Promise<void> => {
  const found = otpStorageContract(() => storage, FAST_EXPIRY).find((c) => c.name.includes(name))
  if (!found) {
    throw new Error(`no contract case matching "${name}"`)
  }
  await found.run()
}

describe('otpStorageContract', () => {
  // The bundled reference storage must satisfy every obligation the contract
  // states — if it did not, the contract would be describing something no
  // implementation in this repository actually does.
  it('should pass entirely against the bundled InMemoryOtpStorage', async () => {
    const storage = new InMemoryOtpStorage()

    for (const contractCase of otpStorageContract(() => storage, FAST_EXPIRY)) {
      await expect(contractCase.run()).resolves.toBeUndefined()
    }
  })

  // Building the case list must not touch the storage: a consumer registers the
  // cases with their runner first and only then does the runner execute them.
  it('should not call the factory while only building the list', () => {
    const factory = jest.fn(() => new InMemoryOtpStorage())

    const cases = otpStorageContract(factory)

    // The count is part of the published promise, so it is asserted exactly:
    // a generic "more than zero" would pass with 12 of the 13 cases removed.
    expect(cases).toHaveLength(18)
    expect(factory).not.toHaveBeenCalled()
  })

  // SECURITY: a contract that cannot fail is decoration. Each case below is
  // pointed at a storage that violates exactly the obligation it covers, so the
  // suite proves the check has teeth rather than that it merely runs.
  it('should catch a tenant-blind key scheme', async () => {
    const shared = new InMemoryOtpStorage()
    const tenantBlind = delegating(shared, {
      set: (_tenantId, recipient, purpose, entry) => shared.set('one', recipient, purpose, entry),
      get: (_tenantId, recipient, purpose) => shared.get('one', recipient, purpose),
      delete: (_tenantId, recipient, purpose) => shared.delete('one', recipient, purpose),
      clearCooldown: (_t, recipient, purpose) => shared.clearCooldown('one', recipient, purpose)
    })

    await expect(runCase(tenantBlind, 'scopes keys by tenant')).rejects.toThrow(
      /one tenant can read or overwrite another tenant's code/
    )
  })

  it('should catch a non-atomic attempt counter', async () => {
    const inner = new InMemoryOtpStorage()
    const racy = delegating(inner, {
      // The read-then-write shape every naive implementation reaches for: the
      // await between them is where concurrent callers all see the same count.
      consumeAttempt: async (tenantId, recipient, purpose): Promise<ConsumeAttemptResult> => {
        const entry = await inner.get(tenantId, recipient, purpose)
        if (!entry) {
          return { status: 'not_found' }
        }
        if (entry.attempts >= entry.maxAttempts) {
          await inner.delete(tenantId, recipient, purpose)
          return { status: 'max_attempts' }
        }
        const updated = { ...entry, attempts: entry.attempts + 1 }
        await inner.update(tenantId, recipient, purpose, updated)
        return { status: 'ok', entry: updated }
      }
    })

    await expect(runCase(racy, 'consumeAttempt is ATOMIC')).rejects.toThrow(
      /25 of 25 concurrent calls consumed an attempt against a ceiling of 5 — the lookup and the increment are not one indivisible operation, so the brute-force limit can be bypassed by sending requests in parallel/
    )
  })

  it('should catch a non-atomic cooldown acquire', async () => {
    const inner = new InMemoryOtpStorage()
    const racy = delegating(inner, {
      tryAcquireCooldown: async (tenantId, recipient, purpose, seconds): Promise<boolean> => {
        const held = await inner.getCooldown(tenantId, recipient, purpose)
        if (held > 0) {
          return false
        }
        await inner.tryAcquireCooldown(tenantId, recipient, purpose, seconds)
        return true
      }
    })

    await expect(runCase(racy, 'tryAcquireCooldown is ATOMIC')).rejects.toThrow(
      /25 of 25 concurrent acquires won — the check and the set are not one step, so two resends can both pass and the anti-resend window stops holding/
    )
  })

  it('should catch a storage that ignores the TTL', async () => {
    const inner = new InMemoryOtpStorage()
    const everlasting = delegating(inner, {
      // Stores with the expiry pushed far out, so the entry outlives its own
      // `expiresAt` — the shape of a backend that never sets a key TTL.
      set: (tenantId, recipient, purpose, entry) =>
        inner.set(tenantId, recipient, purpose, { ...entry, expiresAt: Date.now() + 60_000 })
    })

    await expect(runCase(everlasting, 'applies the TTL')).rejects.toThrow(
      /get returned an entry whose expiresAt has passed/
    )
  })

  it('should catch a delete that does not delete', async () => {
    const inner = new InMemoryOtpStorage()
    const sticky = delegating(inner, { delete: async (): Promise<void> => undefined })

    await expect(runCase(sticky, 'deletes an entry')).rejects.toThrow(/delete left the entry/)
  })

  // Every remaining case gets the same treatment: a storage that violates
  // exactly its obligation, and an assertion on the message it reports. A case
  // whose condition can never fail is decoration, and only a violating storage
  // proves otherwise — mutation testing finds the ones that were never proven.
  describe('each case fails against a storage that violates it', () => {
    const violations: Array<{
      caseName: string
      message: RegExp
      break: (inner: IOtpStorage) => Partial<IOtpStorage>
    }> = [
      {
        caseName: 'stores an entry and reads it back',
        message: /get did not return the entry that was set/,
        break: (inner) => ({
          get: async (t, r, p) => {
            const found = await inner.get(t, r, p)
            return found ? { ...found, code: 'different' } : null
          }
        })
      },
      {
        caseName: 'returns null for an entry that was never set',
        message: /must return null for an absent entry/,
        // Returning an ENTRY for a key never written violates the obligation
        // without laundering a type: the case asks for null and gets an object.
        break: () => ({
          get: async () => ({
            code: 'unexpected',
            expiresAt: Date.now() + 60_000,
            attempts: 0,
            maxAttempts: 3
          })
        })
      },
      {
        caseName: 'scopes keys by recipient',
        message:
          /two recipients under one tenant share a key — one user can overwrite or verify another user's code/,
        break: (inner) => ({
          set: (t, _r, p, entry) => inner.set(t, 'one', p, entry),
          get: (t, _r, p) => inner.get(t, 'one', p),
          delete: (t, _r, p) => inner.delete(t, 'one', p)
        })
      },
      {
        // The SECOND recipient's read decides this operand: a storage that
        // serves the first correctly and loses the other still violates the
        // obligation, and only this shape proves the operand is load-bearing.
        caseName: 'scopes keys by recipient',
        message: /two recipients under one tenant share a key/,
        break: (inner) => ({
          set: (t, r, p, entry) =>
            r.includes('absent') ? Promise.resolve() : inner.set(t, r, p, entry)
        })
      },
      {
        caseName: 'scopes keys by purpose',
        message: /two purposes for one recipient share a key/,
        break: (inner) => ({
          set: (t, r, _purpose, entry) => inner.set(t, r, 'one', entry),
          get: (t, r, _purpose) => inner.get(t, r, 'one'),
          delete: (t, r, _purpose) => inner.delete(t, r, 'one')
        })
      },
      {
        // The SECOND tenant's read is what this operand decides: a storage
        // that serves tenant A correctly and loses tenant B still violates the
        // obligation, and only this shape proves the operand is load-bearing.
        caseName: 'scopes keys by tenant',
        message: /one tenant can read or overwrite another tenant's code/,
        break: (inner) => ({
          set: (t, r, p, entry) =>
            t.endsWith('tenant_b') ? Promise.resolve() : inner.set(t, r, p, entry)
        })
      },
      {
        // `get` honours the TTL but `consumeAttempt` serves the expired entry —
        // the half of the TTL obligation the first assertion cannot see.
        caseName: 'applies the TTL',
        message: /consumeAttempt served an expired entry/,
        break: (inner) => ({
          consumeAttempt: async (t, r, p) => ({
            status: 'ok',
            entry: { code: '111111', expiresAt: Date.now(), attempts: 1, maxAttempts: 3 }
          })
        })
      },
      {
        caseName: 'consumeAttempt reports not_found when there is no entry',
        message: /consumeAttempt must report not_found/,
        break: () => ({ consumeAttempt: async () => ({ status: 'max_attempts' as const }) })
      },
      {
        caseName: 'consumeAttempt spends one attempt',
        message: /the first attempt must succeed/,
        break: () => ({ consumeAttempt: async () => ({ status: 'not_found' as const }) })
      },
      {
        caseName: 'consumeAttempt spends one attempt',
        message: /must return the STORED code/,
        break: (inner) => ({
          consumeAttempt: async (t, r, p) => {
            const result = await inner.consumeAttempt(t, r, p)
            return result.status === 'ok'
              ? { status: 'ok', entry: { ...result.entry, code: 'redacted' } }
              : result
          }
        })
      },
      {
        caseName: 'consumeAttempt spends one attempt',
        message: /with the attempt already counted/,
        break: (inner) => ({
          consumeAttempt: async (t, r, p) => {
            const result = await inner.consumeAttempt(t, r, p)
            return result.status === 'ok'
              ? { status: 'ok', entry: { ...result.entry, attempts: 0 } }
              : result
          }
        })
      },
      {
        caseName: 'reports max_attempts',
        message: /the ceiling was not enforced/,
        break: (inner) => ({
          consumeAttempt: async (t, r, p) => {
            const found = await inner.get(t, r, p)
            return found ? { status: 'ok', entry: found } : { status: 'not_found' }
          }
        })
      },
      {
        caseName: 'reports max_attempts',
        message: /must be deleted once the ceiling is reached/,
        break: (inner) => ({
          consumeAttempt: async (t, r, p) => {
            const result = await inner.consumeAttempt(t, r, p)
            if (result.status === 'max_attempts') {
              await inner.set(t, r, p, {
                code: '111111',
                expiresAt: Date.now() + 60_000,
                attempts: 2,
                maxAttempts: 2
              })
            }
            return result
          }
        })
      },
      {
        caseName: 'tryAcquireCooldown holds until cleared',
        message: /the first acquire must succeed/,
        break: () => ({ tryAcquireCooldown: async () => false })
      },
      {
        caseName: 'tryAcquireCooldown holds until cleared',
        message: /a second acquire must fail while the cooldown is held/,
        break: () => ({ tryAcquireCooldown: async () => true })
      },
      {
        caseName: 'tryAcquireCooldown holds until cleared',
        message: /getCooldown must report the seconds still to run/,
        break: (inner) => ({
          tryAcquireCooldown: (t, r, p, s) => inner.tryAcquireCooldown(t, r, p, s),
          getCooldown: async () => 0
        })
      },
      {
        caseName: 'tryAcquireCooldown holds until cleared',
        message: /clearCooldown must release the cooldown/,
        break: () => ({ clearCooldown: async (): Promise<void> => undefined })
      },
      {
        caseName: 'update preserves the remaining TTL',
        message: /update reset the expiry, extending the code beyond its TTL/,
        break: (inner) => ({
          update: (t, r, p, entry) =>
            inner.set(t, r, p, { ...entry, expiresAt: Date.now() + 60_000 })
        })
      },
      {
        caseName: 'update does not resurrect an expired entry',
        message: /update recreated an entry that had already expired/,
        break: (inner) => ({
          update: (t, r, p, entry) =>
            inner.set(t, r, p, { ...entry, expiresAt: Date.now() + 60_000 })
        })
      },
      {
        caseName: 'scopes the cooldown by tenant',
        message:
          /a cooldown held for one tenant blocked another — cooldown keys are not scoped by tenant, so one tenant can suppress another tenant resends/,
        break: (inner) => ({
          tryAcquireCooldown: (_t, r, p, s) => inner.tryAcquireCooldown('one', r, p, s),
          getCooldown: (_t, r, p) => inner.getCooldown('one', r, p),
          clearCooldown: (_t, r, p) => inner.clearCooldown('one', r, p)
        })
      },
      {
        caseName: 'scopes the cooldown by purpose',
        message:
          /a cooldown held for one purpose blocked another — a password reset and an email verification would share one anti-resend window/,
        break: (inner) => ({
          tryAcquireCooldown: (t, r, _p, s) => inner.tryAcquireCooldown(t, r, 'one', s),
          getCooldown: (t, r, _p) => inner.getCooldown(t, r, 'one'),
          clearCooldown: (t, r, _p) => inner.clearCooldown(t, r, 'one')
        })
      },
      {
        caseName: 'getCooldown reports zero',
        message: /must report 0 when nothing is held/,
        break: () => ({ getCooldown: async () => 42 })
      }
    ]

    for (const violation of violations) {
      it(`catches: ${violation.message.source}`, async () => {
        const inner = new InMemoryOtpStorage()

        await expect(
          runCase(delegating(inner, violation.break(inner)), violation.caseName)
        ).rejects.toThrow(violation.message)
      })
    }
  })

  // The cleanup runs even when a case fails, so a violation in one case cannot
  // leave keys behind that make the next one fail for the wrong reason.
  it('should clean up its keys even when a case throws', async () => {
    const storage = new InMemoryOtpStorage()
    const failing = delegating(storage, { get: async (): Promise<null> => null })

    await expect(runCase(failing, 'stores an entry and reads it back')).rejects.toThrow(
      /get did not return the entry that was set/
    )
    // The entry the failing case wrote must be gone despite the throw.
    // The scope is random per invocation, so the assertion asks the storage
    // whether ANY key survived rather than naming one.
    expect(storage.size()).toEqual({ otps: 0, cooldowns: 0 })
  })
})
