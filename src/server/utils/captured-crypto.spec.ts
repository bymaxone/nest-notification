/**
 * @fileoverview Holds the hash and keyed-hash helpers to the digest they were built to give: a
 * method of the objects `crypto.createHash` and `crypto.createHmac` return, replaced after the import,
 * changes nothing they answer, and a replaced one is one the realm check counts.
 * @layer infrastructure
 */

import { createHash, createHmac } from 'node:crypto'

import { createCodeDigester } from './code-digest'
import { HASH_PROTOTYPE, HMAC_PROTOTYPE, hmacSha256Hex, sha256Hex } from './captured-crypto'
import { hashTenantRecipient } from './hash'

const SECRET = 'a-secret-of-at-least-thirty-two-bytes!'

/** Runs `body` with `holder[name]` replaced, and puts the original property back at once. */
function replacing<T>(holder: object, name: string, value: unknown, body: () => T): T {
  const original = Object.getOwnPropertyDescriptor(holder, name) as PropertyDescriptor
  Object.defineProperty(holder, name, { value, configurable: true, writable: true })
  try {
    return body()
  } finally {
    Object.defineProperty(holder, name, original)
  }
}

const REPLACEMENTS = [
  [
    'update',
    function (this: unknown) {
      return this
    }
  ],
  [
    'digest',
    function () {
      return 'constant'
    }
  ]
] as const

describe('the helpers read the methods of the hash objects once, when they load', () => {
  it('should be the prototypes of the objects crypto returns', () => {
    expect(HASH_PROTOTYPE).toBe(Object.getPrototypeOf(createHash('sha256')))
    expect(HMAC_PROTOTYPE).toBe(Object.getPrototypeOf(createHmac('sha256', 'k')))
  })

  describe.each([
    ['Hash', HASH_PROTOTYPE],
    ['Hmac', HMAC_PROTOTYPE]
  ] as const)('%s', (_label, prototype) => {
    it.each(REPLACEMENTS)(
      'should give the same sha256 and keyed digests when %s is replaced',
      (name, replacement) => {
        const hashed = createHash('sha256').update('abc').digest('hex')
        const keyed = createHmac('sha256', 'k').update('x').update('y').digest('hex')

        const [sha, hmac] = replacing(prototype, name, replacement, () => [
          sha256Hex('abc'),
          hmacSha256Hex(Buffer.from('k'), 'x', 'y')
        ])

        expect(sha).toBe(hashed)
        expect(hmac).toBe(keyed)
      }
    )

    it.each(REPLACEMENTS)(
      'should key two recipients and digest two codes differently when %s is replaced',
      (name, replacement) => {
        const [keyOne, keyTwo, digestOne, digestTwo] = replacing(
          prototype,
          name,
          replacement,
          () => {
            const digest = createCodeDigester(SECRET)
            return [
              hashTenantRecipient('acme', 'a@x.com'),
              hashTenantRecipient('acme', 'b@x.com'),
              digest('111111'),
              digest('222222')
            ]
          }
        )

        expect(keyOne).not.toBe(keyTwo)
        expect(digestOne).not.toBe(digestTwo)
      }
    )
  })
})
