/**
 * @fileoverview Holds the options snapshot to reading what the host gave once. Options are
 * validated and then used, and a getter or a Proxy that answers differently on the second read
 * would pass the validation with one value and be stored with another. The module therefore takes
 * a copy first, validates the copy and resolves the copy.
 * @layer infrastructure
 */

import type { BymaxNotificationModuleOptions, IEmailProvider, IOtpStorage } from '../interfaces'

import { snapshotOptions } from './snapshot-options'

const storage = {} as IOtpStorage
const provider = {} as IEmailProvider

/** An accessor that answers `first` once and `later` for every read after. */
function flipping(first: unknown, later: unknown): { get: () => unknown; reads: () => number } {
  let reads = 0
  return {
    get: () => {
      reads += 1
      return reads === 1 ? first : later
    },
    reads: () => reads
  }
}

describe('snapshotOptions', () => {
  it('should read each option once', () => {
    const attempts = flipping(3, Number.NaN)
    const ttl = flipping(60, -1)
    const otp = { storage }
    Object.defineProperty(otp, 'defaultMaxAttempts', { get: attempts.get, enumerable: true })
    Object.defineProperty(otp, 'defaultTtlSeconds', { get: ttl.get, enumerable: true })

    const copy = snapshotOptions({ otp } as never)

    expect(copy.otp?.defaultMaxAttempts).toBe(3)
    expect(copy.otp?.defaultTtlSeconds).toBe(60)
    expect(attempts.reads()).toBe(1)
    expect(ttl.reads()).toBe(1)
  })

  it('should read the sections and the perPurpose container once', () => {
    const email = flipping({ provider, defaultFrom: 'a@b.com' }, null)
    const perPurpose = flipping({ mfa_oob: { maxAttempts: 2 } }, null)
    const options = {} as Record<string, unknown>
    Object.defineProperty(options, 'email', { get: email.get, enumerable: true })
    const otp = { storage }
    Object.defineProperty(otp, 'perPurpose', { get: perPurpose.get, enumerable: true })
    options.otp = otp

    const copy = snapshotOptions(options as never)

    expect(copy.email?.defaultFrom).toBe('a@b.com')
    expect(copy.otp?.perPurpose).toEqual({ mfa_oob: { maxAttempts: 2 } })
    expect(email.reads()).toBe(1)
    expect(perPurpose.reads()).toBe(1)
  })

  it('should read each perPurpose entry once', () => {
    const attempts = flipping(2, Number.NaN)
    const entry = {}
    Object.defineProperty(entry, 'maxAttempts', { get: attempts.get, enumerable: true })

    const copy = snapshotOptions({ otp: { storage, perPurpose: { mfa_oob: entry } } } as never)

    expect(copy.otp?.perPurpose?.['mfa_oob']?.maxAttempts).toBe(2)
    expect(attempts.reads()).toBe(1)
  })

  it('should hand back sections the host cannot change afterwards', () => {
    const options = {
      email: { provider, defaultFrom: 'a@b.com' },
      otp: { storage, defaultMaxAttempts: 3, perPurpose: { mfa_oob: { maxAttempts: 2 } } },
      audit: { swallowErrors: true },
      global: { defaultLocale: 'en' }
    } as unknown as BymaxNotificationModuleOptions

    const copy = snapshotOptions(options)
    ;(options.otp as { defaultMaxAttempts: number }).defaultMaxAttempts = 99
    ;(options.otp?.perPurpose?.['mfa_oob'] as { maxAttempts: number }).maxAttempts = 99
    ;(options.email as { defaultFrom: string }).defaultFrom = 'x@y.com'
    ;(options.audit as { swallowErrors: boolean }).swallowErrors = false
    ;(options.global as { defaultLocale: string }).defaultLocale = 'pt'

    expect(copy.otp?.defaultMaxAttempts).toBe(3)
    expect(copy.otp?.perPurpose?.['mfa_oob']?.maxAttempts).toBe(2)
    expect(copy.email?.defaultFrom).toBe('a@b.com')
    expect(copy.audit?.swallowErrors).toBe(true)
    expect(copy.global?.defaultLocale).toBe('en')
  })

  // Providers, stores and repositories are the host's objects: they are not copied.
  it('should keep the host objects by reference', () => {
    const repository = { create: jest.fn() }
    const copy = snapshotOptions({
      email: { provider, defaultFrom: 'a@b.com' },
      otp: { storage },
      audit: { repository }
    } as never)

    expect(copy.email?.provider).toBe(provider)
    expect(copy.otp?.storage).toBe(storage)
    expect(copy.audit?.repository).toBe(repository)
  })

  // An array is not a section or an entry, and spreading it into `{}` would hide it from the
  // validation that refuses it: it is kept as it is.
  it('should keep an array where a section or an entry is expected', () => {
    const entry: unknown[] = []
    const email: unknown[] = ['x']

    const copy = snapshotOptions({
      email,
      otp: { storage, perPurpose: { mfa_oob: entry } }
    } as never)

    expect(copy.email).toBe(email)
    expect(copy.otp?.perPurpose?.['mfa_oob']).toBe(entry)
  })

  it('should leave absent sections absent and a section that is not an object as it is', () => {
    expect(snapshotOptions({ email: { provider, defaultFrom: 'a@b.com' } } as never)).toEqual({
      email: { provider, defaultFrom: 'a@b.com' }
    })
    expect(snapshotOptions({ otp: null } as never)).toEqual({ otp: null })
    expect(
      snapshotOptions({ otp: { storage, perPurpose: 'login' } } as never).otp?.perPurpose
    ).toBe('login')
    expect(
      snapshotOptions({ otp: { storage, perPurpose: [{}] } } as never).otp?.perPurpose
    ).toEqual([{}])
    expect(
      snapshotOptions({ otp: { storage, perPurpose: { a: null, b: 5 } } } as never).otp?.perPurpose
    ).toEqual({ a: null, b: 5 })
  })
})
