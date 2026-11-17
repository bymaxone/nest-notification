/**
 * @fileoverview Holds every numeric module option to a value the library can act on, at startup.
 * A bound written as NaN passes a `< 1` test and then compares false against everything: an
 * attempts bound of NaN never locks, a cooldown of NaN never holds, a TTL of NaN never expires.
 * Each option, and each `perPurpose` entry that overrides it, has its own table.
 * @layer infrastructure
 */

import type { BymaxNotificationModuleOptions, IEmailProvider, IOtpStorage } from '../interfaces'

import { validateOptions } from './validate-options'

const storage = {} as IOtpStorage
const provider = {} as IEmailProvider

const otp = (extra: object): BymaxNotificationModuleOptions => ({
  otp: { storage, ...extra } as never
})
const perPurpose = (entry: object): BymaxNotificationModuleOptions =>
  otp({ perPurpose: { mfa_oob: entry } })
const email = (extra: object): BymaxNotificationModuleOptions => ({
  email: { provider, defaultFrom: 'noreply@example.com', ...extra } as never
})

const NOT_NUMBERS = ['5', '', null, true, {}, []] as const
const NOT_FINITE = [NaN, Infinity, -Infinity] as const

/** A bound that must be an integer of at least 1. */
const ATTEMPTS = [...NOT_NUMBERS, ...NOT_FINITE, 0, -1, 2.5, 2 ** 53, 1e21]
/** A duration in seconds that must be a finite number above zero. */
const TTL = [...NOT_NUMBERS, ...NOT_FINITE, 0, -5]
/** A duration in seconds that must be a finite number, zero meaning none. */
const COOLDOWN = [...NOT_NUMBERS, ...NOT_FINITE, -1]

describe('validateOptions numeric options', () => {
  describe('otp.defaultMaxAttempts', () => {
    it.each([1, 5, 100])('should accept %p', (value) => {
      expect(() => validateOptions(otp({ defaultMaxAttempts: value }))).not.toThrow()
    })

    it('should accept the largest safe integer', () => {
      expect(() =>
        validateOptions(otp({ defaultMaxAttempts: Number.MAX_SAFE_INTEGER }))
      ).not.toThrow()
    })

    it.each(ATTEMPTS)('should refuse %p', (value) => {
      expect(() => validateOptions(otp({ defaultMaxAttempts: value }))).toThrow(
        /options\.otp\.defaultMaxAttempts must be (an integer|at least 1)/
      )
    })
  })

  describe('otp.defaultTtlSeconds', () => {
    it.each([1, 600, 0.5])('should accept %p', (value) => {
      expect(() => validateOptions(otp({ defaultTtlSeconds: value }))).not.toThrow()
    })

    it.each(TTL)('should refuse %p', (value) => {
      expect(() => validateOptions(otp({ defaultTtlSeconds: value }))).toThrow(
        /options\.otp\.defaultTtlSeconds must be (a finite number|greater than 0)/
      )
    })
  })

  // Zero is the documented way to switch the cooldown off.
  describe('otp.resendCooldownSeconds', () => {
    it.each([0, 1, 60])('should accept %p', (value) => {
      expect(() => validateOptions(otp({ resendCooldownSeconds: value }))).not.toThrow()
    })

    it.each(COOLDOWN)('should refuse %p', (value) => {
      expect(() => validateOptions(otp({ resendCooldownSeconds: value }))).toThrow(
        /options\.otp\.resendCooldownSeconds must be (a finite number|0 or greater)/
      )
    })
  })

  describe('otp.perPurpose entries', () => {
    it('should accept valid overrides', () => {
      expect(() =>
        validateOptions(
          perPurpose({ maxAttempts: 3, ttlSeconds: 120, resendCooldownSeconds: 0, length: 8 })
        )
      ).not.toThrow()
    })

    it.each(ATTEMPTS)('should refuse maxAttempts %p', (value) => {
      expect(() => validateOptions(perPurpose({ maxAttempts: value }))).toThrow(
        /options\.otp\.perPurpose\.mfa_oob\.maxAttempts must be (an integer|at least 1)/
      )
    })

    it.each(TTL)('should refuse ttlSeconds %p', (value) => {
      expect(() => validateOptions(perPurpose({ ttlSeconds: value }))).toThrow(
        /options\.otp\.perPurpose\.mfa_oob\.ttlSeconds must be (a finite number|greater than 0)/
      )
    })

    it.each(COOLDOWN)('should refuse resendCooldownSeconds %p', (value) => {
      expect(() => validateOptions(perPurpose({ resendCooldownSeconds: value }))).toThrow(
        /options\.otp\.perPurpose\.mfa_oob\.resendCooldownSeconds must be (a finite number|0 or greater)/
      )
    })

    it.each([0, 33, 2.5, NaN, '8', null])('should refuse length %p', (value) => {
      expect(() => validateOptions(perPurpose({ length: value }))).toThrow(
        expect.objectContaining({ code: 'notification.otp_invalid_length' })
      )
    })

    // An entry is an object of overrides. Anything else would have been read for fields it does
    // not have, so it is refused with the library's own message, not a TypeError.
    it.each([null, 'x', 5, true, []])('should refuse the entry %p', (entry) => {
      expect(() => validateOptions(otp({ perPurpose: { mfa_oob: entry } }))).toThrow(
        'options.otp.perPurpose.mfa_oob must be an object'
      )
    })

    // An entry that sets nothing keeps the defaults, and an absent field is not a value.
    it('should accept an entry that sets nothing, and an undefined field', () => {
      expect(() => validateOptions(perPurpose({}))).not.toThrow()
      expect(() => validateOptions(perPurpose({ maxAttempts: undefined }))).not.toThrow()
    })
  })

  // The recipient bound is a count too: past the largest safe integer it bounds nothing.
  describe('email.maxRecipients', () => {
    it.each([1, 50, Number.MAX_SAFE_INTEGER])('should accept %p', (value) => {
      expect(() => validateOptions(email({ maxRecipients: value }))).not.toThrow()
    })

    it.each([2 ** 53, 1e21])('should refuse %p', (value) => {
      expect(() => validateOptions(email({ maxRecipients: value }))).toThrow(
        'options.email.maxRecipients must be a positive integer'
      )
    })
  })

  describe('email.maxAttachmentBytes', () => {
    it.each([0, 1, 10_485_760])('should accept %p', (value) => {
      expect(() => validateOptions(email({ maxAttachmentBytes: value }))).not.toThrow()
    })

    it.each([...NOT_NUMBERS, ...NOT_FINITE, -1])('should refuse %p', (value) => {
      expect(() => validateOptions(email({ maxAttachmentBytes: value }))).toThrow(
        /options\.email\.maxAttachmentBytes must be (a finite number|0 or greater)/
      )
    })
  })

  // A number says nothing a secret could hide in, so it is shown; anything else is named by kind,
  // because it may be a credential put in the wrong option (the echo spec holds that to every
  // option).
  it.each([
    [NaN, 'got NaN'],
    [Infinity, 'got Infinity'],
    ['3', 'got a string'],
    [null, 'got null'],
    [true, 'got true'],
    [[], 'got an array'],
    [{ secret: 'x' }, 'got an object']
  ])('should say what the value %p was', (value, expected) => {
    expect(() => validateOptions(otp({ defaultMaxAttempts: value }))).toThrow(
      `must be an integer of at most 9007199254740991, ${expected}`
    )
  })
})
