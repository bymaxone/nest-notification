/**
 * @fileoverview Specs for the 1.4.15 options rules: a group whose omission turns a protection off
 * refuses a `null`; the `global` group and the `perPurpose` container must be objects the library
 * can read, and a built-in such as a `Map` or a `Date` is not one; the `codeType` of an entry is
 * checked; `defaultTags` is read once like every other option; and a length error names the option
 * in its message.
 * @layer infrastructure
 */

import { NotificationException } from '../errors/notification-exception'
import type { IEmailProvider, IOtpStorage } from '../interfaces'

import { resolveOptions } from './resolved-options'
import { snapshotOptions } from './snapshot-options'
import { validateOptions } from './validate-options'

const storage = {} as IOtpStorage
const provider = {} as IEmailProvider

/** Copies, validates and resolves the options as the module does. */
function resolved(options: Record<string, unknown>): ReturnType<typeof resolveOptions> {
  const own = snapshotOptions(options as never)
  validateOptions(own)
  return resolveOptions(own)
}

describe('a group whose omission turns a protection off', () => {
  const base = { otp: { storage } }

  it('should refuse a null audit, naming the option', () => {
    expect(() => resolved({ ...base, audit: null })).toThrow(
      '[BymaxNotificationModule] options.audit must be an object'
    )
  })

  it('should treat an undefined audit as omitted', () => {
    expect(() => resolved({ ...base, audit: undefined })).not.toThrow()
  })

  it.each([5, 'repo', true, []])('should refuse an audit that is %p', (value) => {
    expect(() => resolved({ ...base, audit: value })).toThrow()
  })

  it.each(['email', 'otp'])('should keep reading a null %s as not set', (key) => {
    const options = { ...base, [key]: null }
    if (key === 'otp') {
      Object.assign(options, { email: { provider, defaultFrom: 'a@b.com' } })
    }

    expect(() => resolved(options)).not.toThrow()
  })
})

describe('the global group', () => {
  const base = { otp: { storage } }

  it.each([5, 'x', true, []])('should refuse global that is %p', (value) => {
    expect(() => resolved({ ...base, global: value })).toThrow(
      '[BymaxNotificationModule] options.global must be an object'
    )
  })

  it.each([null, undefined])('should read a global of %p as not set', (value) => {
    expect(() => resolved({ ...base, global: value })).not.toThrow()
  })

  // The module drops a null global when it copies the options, so only the validator itself sees it:
  // on its own it refuses a null, which is not an object.
  it('should refuse a null global when the validator is given one directly', () => {
    expect(() => validateOptions({ ...base, global: null } as never)).toThrow(
      '[BymaxNotificationModule] options.global must be an object'
    )
  })
})

describe('the perPurpose container', () => {
  const containerOf = (perPurpose: unknown): Record<string, unknown> => ({
    otp: { storage, perPurpose }
  })

  it.each([
    ['a Map', new Map([['mfa_oob', {}]])],
    ['a Set', new Set()],
    ['a Date', new Date(0)],
    ['a RegExp', /x/],
    ['a class that extends Map', new (class Purposes extends Map<string, object> {})()]
  ])('should refuse %s naming otp.perPurpose', (_label, value) => {
    expect(() => resolved(containerOf(value))).toThrow(
      'options.otp.perPurpose must be a plain object or a class instance'
    )
  })

  it('should keep reading a plain object, a null prototype and a class instance', () => {
    class Purposes {
      get mfa_oob(): object {
        return { maxAttempts: 2 }
      }
    }
    const bare = Object.assign(Object.create(null) as object, { mfa_oob: { maxAttempts: 3 } })

    expect(resolved(containerOf({ mfa_oob: {} })).otp?.perPurpose).toHaveProperty('mfa_oob')
    expect(resolved(containerOf(bare)).otp?.perPurpose.mfa_oob?.maxAttempts).toBe(3)
    expect(resolved(containerOf(new Purposes())).otp?.perPurpose.mfa_oob?.maxAttempts).toBe(2)
  })
})

describe('a perPurpose entry codeType', () => {
  const entryOf = (codeType: unknown): Record<string, unknown> => ({
    otp: { storage, perPurpose: { mfa_oob: { codeType } } }
  })

  it.each(['hex', 'NUMERIC', 5, true, {}, []])('should refuse %p naming the option', (value) => {
    expect(() => resolved(entryOf(value))).toThrow(
      '[BymaxNotificationModule] options.otp.perPurpose.mfa_oob.codeType must be one of: '
    )
  })

  it.each(['numeric', 'alpha', 'alphanumeric'])('should accept %s', (value) => {
    expect(resolved(entryOf(value)).otp?.perPurpose.mfa_oob?.codeType).toBe(value)
  })

  it.each([undefined, null])('should read %p as not set', (value) => {
    expect(resolved(entryOf(value)).otp?.perPurpose.mfa_oob?.codeType).toBe('numeric')
  })
})

describe('email.defaultTags', () => {
  const emailOf = (defaultTags: unknown): Record<string, unknown> => ({
    email: { provider, defaultFrom: 'a@b.com', defaultTags }
  })

  it('should read each tag once, when the options are copied', () => {
    let reads = 0
    const tag = {
      name: 'campaign',
      get value(): string {
        reads += 1
        return reads === 1 ? 'first' : 'second'
      }
    }
    const own = snapshotOptions(emailOf([tag]) as never)

    expect(own.email?.defaultTags).toEqual([{ name: 'campaign', value: 'first' }])
    expect(own.email?.defaultTags?.[0]).not.toBe(tag)
    expect(reads).toBe(1)
  })

  it('should not share the array with the host', () => {
    const tags = [{ name: 'a', value: 'b' }]

    const own = snapshotOptions(emailOf(tags) as never)

    expect(own.email?.defaultTags).not.toBe(tags)
  })

  it.each([undefined, null])('should read %p as not set', (value) => {
    expect(snapshotOptions(emailOf(value) as never).email).not.toHaveProperty('defaultTags')
  })

  it.each(['x', 5, {}, [null]])('should hand %p on as it is', (value) => {
    expect(snapshotOptions(emailOf(value) as never).email?.defaultTags).toEqual(value)
  })
})

describe('OTP_INVALID_LENGTH', () => {
  it('should name the option in e.message, not only in the response', () => {
    let thrown: unknown
    try {
      resolved({ otp: { storage, defaultLength: 99 } })
    } catch (error) {
      thrown = error
    }

    const text =
      '[BymaxNotificationModule] options.otp.defaultLength must be an integer from 1 to 32, got 99'
    expect(thrown).toBeInstanceOf(NotificationException)
    expect((thrown as Error).message).toBe(text)
    expect((thrown as NotificationException).getResponse()).toMatchObject({
      error: { code: 'notification.otp_invalid_length', message: text }
    })
  })
})
