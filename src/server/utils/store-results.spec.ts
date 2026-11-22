/**
 * @fileoverview Holds the answer of every checked store operation to the kind the library reads it
 * as: a table of good answers that pass and bad ones that are refused, one row per kind.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'
import { checkConfigured, checkStoreResult } from './store-results'

const ENTRY = { code: '123456', expiresAt: 1_700_000_000_000, attempts: 1, maxAttempts: 3 }
const NOT_BOOLEAN: unknown[] = ['false', 'true', 'OK', '', 0, 1, {}, [], null, undefined]
const NOT_COUNT: unknown[] = [
  undefined,
  null,
  Number.NaN,
  Infinity,
  {},
  0,
  -1,
  1.5,
  true,
  'abc',
  '1'
]
const BAD_RESULTS: Array<[string, unknown]> = [
  ['undefined', undefined],
  ['null', null],
  ['a string', 'ok'],
  ['an unknown status', { status: 'oops' }],
  ['no status', {}],
  ['ok without an entry', { status: 'ok' }],
  ['ok with a null entry', { status: 'ok', entry: null }],
  ['ok with a string code of another kind', { status: 'ok', entry: { ...ENTRY, code: 123456 } }],
  ['ok with NaN expiresAt', { status: 'ok', entry: { ...ENTRY, expiresAt: Number.NaN } }],
  ['ok with NaN attempts', { status: 'ok', entry: { ...ENTRY, attempts: Number.NaN } }],
  ['ok with negative attempts', { status: 'ok', entry: { ...ENTRY, attempts: -1 } }],
  ['ok with fractional maxAttempts', { status: 'ok', entry: { ...ENTRY, maxAttempts: 2.5 } }],
  ['ok with validated as a string', { status: 'ok', entry: { ...ENTRY, validated: 'false' } }]
]

function refusal(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

describe.each(['tryAcquireCooldown', 'deleteIfCode'])('the answer of %s', (operation) => {
  it.each([true, false])('should pass %p through', (value) => {
    expect(checkStoreResult(operation, value, 's')).toBe(value)
  })

  it.each(NOT_BOOLEAN)('should refuse %p with OTP_STORAGE_FAILED', (value) => {
    const caught = refusal(() => checkStoreResult(operation, value, 's'))

    expect(caught).toBeInstanceOf(NotificationException)
    expect((caught as NotificationException).code).toBe('notification.otp_storage_failed')
  })
})

describe('the answer of recordFailure', () => {
  it.each(NOT_COUNT)('should refuse %p', (value) => {
    expect(refusal(() => checkStoreResult('recordFailure', value, 's'))).toBeInstanceOf(
      NotificationException
    )
  })

  it.each([1, 7])('should pass %p', (value) => {
    expect(checkStoreResult('recordFailure', value, 's')).toBe(value)
  })
})

describe('the answer of consumeAttempt', () => {
  it.each(['not_found', 'max_attempts'] as const)('should pass the status %s', (status) => {
    expect(checkStoreResult('consumeAttempt', { status }, 's')).toEqual({ status })
  })

  it('should return a fresh ok result holding the entry fields', () => {
    const raw = { status: 'ok', entry: { ...ENTRY, validated: true, metadata: { a: 1 }, extra: 1 } }

    const result = checkStoreResult('consumeAttempt', raw, 's')

    expect(result).toEqual({
      status: 'ok',
      entry: { ...ENTRY, validated: true, metadata: { a: 1 } }
    })
    expect(result).not.toBe(raw)
  })

  it('should read every field of the entry once', () => {
    const reads: string[] = []
    const entry = {}
    for (const [key, value] of Object.entries(ENTRY)) {
      Object.defineProperty(entry, key, {
        enumerable: true,
        get() {
          reads.push(key)
          return value
        }
      })
    }

    checkStoreResult('consumeAttempt', { status: 'ok', entry }, 's')

    expect([...reads].sort()).toEqual(Object.keys(ENTRY).sort())
  })

  it.each(BAD_RESULTS)('should refuse %s', (_label, value) => {
    const caught = refusal(() => checkStoreResult('consumeAttempt', value, 's'))

    expect(caught).toBeInstanceOf(NotificationException)
    expect((caught as NotificationException).code).toBe('notification.otp_storage_failed')
  })
})

describe('what a refusal and an accepted entry carry', () => {
  it('should name the store in the details of a refusal', () => {
    const caught = refusal(() => checkStoreResult('tryAcquireCooldown', 'x', 'the-store'))

    expect((caught as NotificationException).getResponse()).toMatchObject({
      error: { details: { providerName: 'the-store' } }
    })
  })

  it('should accept an entry of zero attempts and zero maximum', () => {
    const result = checkStoreResult(
      'consumeAttempt',
      { status: 'ok', entry: { ...ENTRY, attempts: 0, maxAttempts: 0 } },
      's'
    )

    expect(result).toEqual({ status: 'ok', entry: { ...ENTRY, attempts: 0, maxAttempts: 0 } })
  })

  it('should leave metadata out of an entry that has none', () => {
    const result = checkStoreResult('consumeAttempt', { status: 'ok', entry: ENTRY }, 's') as {
      entry: object
    }

    expect('metadata' in result.entry).toBe(false)
    expect('validated' in result.entry).toBe(false)
  })
})

describe('an operation whose answer is not read', () => {
  it('should pass anything through, whatever the name inherits', () => {
    expect(checkStoreResult('get', 'x', 's')).toBe('x')
    expect(checkStoreResult('constructor', 'x', 's')).toBe('x')
  })
})

describe('the answer of isConfigured', () => {
  it.each([true, false])('should pass %p', (value) => {
    expect(checkConfigured(value)).toBe(value)
  })

  it.each(['false', 1, 0, {}, null, undefined])('should refuse %p', (value) => {
    expect(refusal(() => checkConfigured(value))).toBeInstanceOf(NotificationException)
  })
})
