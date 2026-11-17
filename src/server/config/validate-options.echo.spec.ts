/**
 * @fileoverview Holds the refusals of the module options to never echoing what the host gave. A
 * value that is not a number may be a secret that was put in the wrong option, and a message, a
 * stack, a JSON dump or an inspect of the error would carry it into a log. A refusal names the
 * option and the kind of value it received; a number is shown, because it cannot be a secret of
 * that shape.
 * @layer infrastructure
 */

import { inspect } from 'node:util'

import type { BymaxNotificationModuleOptions, IEmailProvider, IOtpStorage } from '../interfaces'

import { validateOptions } from './validate-options'

const storage = {} as IOtpStorage
const provider = {} as IEmailProvider
const SECRET = 'SENTINEL_5f2c91'

const otp = (extra: object): BymaxNotificationModuleOptions => ({
  otp: { storage, ...extra } as never
})
const email = (extra: object): BymaxNotificationModuleOptions => ({
  email: { provider, defaultFrom: 'noreply@example.com', ...extra } as never
})

/** Every way a secret can be carried by a value that is not a number. */
const SECRETS: ReadonlyArray<readonly [string, unknown]> = [
  ['a string', SECRET],
  ['a Symbol description', Symbol(SECRET)],
  ['the source of a function', new Function(`return '${SECRET}'`)],
  ['an object that prints it', { toString: () => SECRET, secret: SECRET }],
  ['an array holding it', [SECRET]]
]

/** A refusal, with everything a logger could print of it. */
function everything(options: BymaxNotificationModuleOptions): string {
  try {
    validateOptions(options)
  } catch (error) {
    const body = (error as { getResponse?: () => unknown }).getResponse?.()
    return [
      String((error as Error).message),
      String((error as Error).stack),
      JSON.stringify(error, Object.getOwnPropertyNames(error as object)),
      inspect(error, { depth: 6, showHidden: true }),
      JSON.stringify(body ?? null)
    ].join('\n')
  }
  throw new Error('expected a refusal')
}

const OPTIONS: ReadonlyArray<
  readonly [string, (value: unknown) => BymaxNotificationModuleOptions]
> = [
  ['otp.defaultTtlSeconds', (v) => otp({ defaultTtlSeconds: v })],
  ['otp.defaultMaxAttempts', (v) => otp({ defaultMaxAttempts: v })],
  ['otp.resendCooldownSeconds', (v) => otp({ resendCooldownSeconds: v })],
  ['otp.defaultLength', (v) => otp({ defaultLength: v })],
  ['email.maxAttachmentBytes', (v) => email({ maxAttachmentBytes: v })],
  ['email.maxRecipients', (v) => email({ maxRecipients: v })],
  ['otp.perPurpose.mfa_oob.ttlSeconds', (v) => otp({ perPurpose: { mfa_oob: { ttlSeconds: v } } })],
  [
    'otp.perPurpose.mfa_oob.maxAttempts',
    (v) => otp({ perPurpose: { mfa_oob: { maxAttempts: v } } })
  ],
  [
    'otp.perPurpose.mfa_oob.resendCooldownSeconds',
    (v) => otp({ perPurpose: { mfa_oob: { resendCooldownSeconds: v } } })
  ],
  ['otp.perPurpose.mfa_oob.length', (v) => otp({ perPurpose: { mfa_oob: { length: v } } })],
  ['otp.perPurpose.mfa_oob', (v) => otp({ perPurpose: { mfa_oob: v } })],
  ['otp.perPurpose', (v) => otp({ perPurpose: v })]
]

describe('a refused option never echoes what it was given', () => {
  describe.each(OPTIONS)('%s', (path, build) => {
    // An object is a legal entry of perPurpose, so it is not refused there and has nothing to echo.
    it.each(
      SECRETS.filter(
        ([label]) => path !== 'otp.perPurpose.mfa_oob' || label !== 'an object that prints it'
      )
    )('should not print %s', (_label, value) => {
      expect(everything(build(value))).not.toContain(SECRET)
    })

    it('should name the option', () => {
      expect(everything(build('x'))).toContain(`options.${path}`)
    })
  })

  // A number says nothing a secret could hide in, so it is shown.
  it.each([
    [NaN, 'got NaN'],
    [Infinity, 'got Infinity'],
    [-1, 'got -1']
  ])('should show the number %p', (value, expected) => {
    expect(everything(otp({ defaultMaxAttempts: value }))).toContain(expected)
  })

  it.each([
    ['x', 'got a string'],
    [null, 'got null'],
    [[], 'got an array'],
    [{ a: 1 }, 'got an object'],
    [true, 'got true'],
    [Symbol('s'), 'got a symbol'],
    [() => 1, 'got a function']
  ])('should say what kind of value %p was', (value, expected) => {
    expect(everything(otp({ defaultMaxAttempts: value }))).toContain(expected)
  })
})

describe('the perPurpose container', () => {
  it.each([
    ['null', null],
    ['an array', []],
    ['an array of entries', [{}]],
    ['a string', 'login'],
    ['a number', 5],
    ['true', true]
  ])('should be refused as %s, naming perPurpose and not an entry', (_label, value) => {
    const text = everything(otp({ perPurpose: value }))

    expect(text).toContain('options.otp.perPurpose must be an object')
    expect(text).not.toContain('perPurpose.0')
  })

  it.each([undefined, {}, { mfa_oob: {} }])('should accept %p', (value) => {
    expect(() => validateOptions(otp({ perPurpose: value }))).not.toThrow()
  })
})
