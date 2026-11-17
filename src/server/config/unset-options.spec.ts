/**
 * @fileoverview Holds the options to one meaning of "not set": a key that reads as `undefined` or
 * `null` takes the default, in every group, whatever way the host wrote it (an absent key, an
 * explicit `undefined`, an explicit `null`, or a getter that answers either). The default is the
 * value the option has when it is left out, and the options are validated after that.
 * @layer infrastructure
 */

import { resolveOptions } from './resolved-options'
import { snapshotOptions } from './snapshot-options'
import { validateOptions } from './validate-options'
import type { IEmailProvider, IOtpStorage } from '../interfaces'

const storage = {} as IOtpStorage
const provider = {} as IEmailProvider

type Build = (extra: Record<string, unknown>) => Record<string, unknown>

/** The sections whose options have a default, each built with the options set to `extra`. */
const SECTIONS: ReadonlyArray<readonly [string, Build, readonly string[]]> = [
  [
    'otp',
    (extra) => ({ otp: { storage, ...extra } }),
    [
      'defaultLength',
      'defaultCodeType',
      'defaultTtlSeconds',
      'defaultMaxAttempts',
      'resendCooldownSeconds',
      'consumeOnVerify',
      'strictPurposes'
    ]
  ],
  [
    'email',
    (extra) => ({ email: { provider, defaultFrom: 'a@b.com', ...extra } }),
    ['maxAttachmentBytes', 'maxRecipients', 'defaultTags']
  ],
  [
    'global',
    (extra) => ({ email: { provider, defaultFrom: 'a@b.com' }, global: extra }),
    ['redisNamespace', 'defaultLocale']
  ],
  [
    'audit',
    (extra) => ({
      email: { provider, defaultFrom: 'a@b.com' },
      audit: { repository: {}, ...extra }
    }),
    ['swallowErrors']
  ]
]

/** What the options resolve to, without the functions. */
function resolved(options: Record<string, unknown>): unknown {
  const own = snapshotOptions(options as never)
  validateOptions(own)
  return JSON.parse(JSON.stringify(resolveOptions(own)))
}

describe.each(SECTIONS)('an option of %s that reads as not set', (section, build, keys) => {
  const baseline = resolved(build({}))

  describe.each(keys)('%s', (key) => {
    it.each([
      ['an explicit undefined', undefined],
      ['an explicit null', null]
    ])('should take the default for %s', (_label, value) => {
      expect(resolved(build({ [key]: value }))).toEqual(baseline)
    })

    it('should take the default for a getter that answers null', () => {
      const extra = {}
      Object.defineProperty(extra, key, { enumerable: true, get: () => null })

      expect(resolved(build(extra))).toEqual(baseline)
    })
  })
})

describe('a perPurpose entry option that reads as not set', () => {
  const entry = (extra: object): Record<string, unknown> => ({
    otp: { storage, perPurpose: { mfa_oob: extra } }
  })
  const baseline = resolved(entry({}))

  describe.each(['length', 'codeType', 'ttlSeconds', 'maxAttempts', 'resendCooldownSeconds'])(
    '%s',
    (key) => {
      it.each([undefined, null])('should take the default for %p', (value) => {
        expect(resolved(entry({ [key]: value }))).toEqual(baseline)
      })
    }
  )

  it.each([undefined, null])('should take the default for a perPurpose that is %p', (value) => {
    expect(resolved({ otp: { storage, perPurpose: value } })).toEqual(
      resolved({ otp: { storage } })
    )
  })
})
