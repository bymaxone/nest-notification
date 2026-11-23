/**
 * @fileoverview Holds every `node:crypto` function the OTP issue and verify paths call to the one the
 * module took when it loaded: a host, a test or a dependency that replaces one after the import
 * (`crypto.randomInt = () => 0`, a `timingSafeEqual` that answers `true`) changes nothing the library
 * does. Each row replaces one function after the import and shows the property it protects.
 * @layer domain
 */

import { NoOpEmailProvider } from '../providers/no-op-email.provider'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import {
  emailSendTemplate,
  emailServiceStub,
  makeAudit,
  makeOptions,
  ref
} from '../services/__tests__/otp-service.fixtures'
import { OtpService } from '../services/otp.service'

import { createCodeDigester } from './code-digest'
import { generateOtpCode } from './code-generator'
import { hashTenantRecipient } from './hash'
import { safeCompare } from './timing-safe-compare'

const crypto = jest.requireActual<Record<string, unknown>>('node:crypto')
const SECRET = 'a-secret-of-at-least-thirty-two-bytes!'

/**
 * Runs `body` with `crypto[name]` replaced, and puts the original property back once it has finished,
 * whether it answered at once or through a promise.
 */
function withReplaced<T>(replacements: Record<string, unknown>, body: () => T): T {
  const originals = Object.entries(replacements).map(
    ([name]) => [name, Object.getOwnPropertyDescriptor(crypto, name) as PropertyDescriptor] as const
  )
  for (const [name, value] of Object.entries(replacements)) {
    Object.defineProperty(crypto, name, { value, configurable: true, writable: true })
  }
  const restore = (): void => {
    for (const [name, descriptor] of originals) {
      Object.defineProperty(crypto, name, descriptor)
    }
  }
  let result: T
  try {
    result = body()
  } catch (error) {
    restore()
    throw error
  }
  if (result instanceof Promise) {
    return result.finally(restore) as T
  }
  restore()
  return result
}

describe('node:crypto functions read once, when the modules load', () => {
  it('should draw unpredictable codes when randomInt is replaced by one that answers 0', () => {
    const codes = withReplaced({ randomInt: () => 0 }, () =>
      Array.from({ length: 20 }, () => generateOtpCode(6, 'numeric'))
    )

    expect(new Set(codes).size).toBeGreaterThan(1)
    expect(codes.every((code) => code === '000000')).toBe(false)
  })

  it('should digest two codes differently when createHmac is replaced by one that answers a constant', () => {
    const fake = { update: () => fake, digest: () => 'constant' }

    const [one, other] = withReplaced({ createHmac: () => fake }, () => {
      const digest = createCodeDigester(SECRET)
      return [digest('111111'), digest('222222')]
    })

    expect(one).not.toBe(other)
  })

  it('should refuse a wrong code when timingSafeEqual is replaced by one that answers true', () => {
    const accepted = withReplaced({ timingSafeEqual: () => true }, () =>
      safeCompare('123456', '654321')
    )

    expect(accepted).toBe(false)
  })

  describe('a built-in the OTP paths call, replaced after the import', () => {
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

    it('should refuse a wrong code when Buffer.from answers one byte for any text', () => {
      const accepted = replacing(
        Buffer,
        'from',
        () => Buffer.alloc(1),
        () => safeCompare('abc', 'xyz')
      )

      expect(accepted).toBe(false)
    })

    it('should accept the right code when Buffer.from answers one byte for any text', () => {
      const accepted = replacing(
        Buffer,
        'from',
        () => Buffer.alloc(1),
        () => safeCompare('abc', 'abc')
      )

      expect(accepted).toBe(true)
    })

    it('should key the digest with the secret when Buffer.from answers one byte for any text', () => {
      const keyed = createCodeDigester(SECRET)('111111')

      const replaced = replacing(
        Buffer,
        'from',
        () => Buffer.alloc(1),
        () => createCodeDigester(SECRET)('111111')
      )

      expect(replaced).toBe(keyed)
    })

    it('should draw every character of a code when charAt answers 0', () => {
      const codes = replacing(
        String.prototype,
        'charAt',
        () => '0',
        () => Array.from({ length: 20 }, () => generateOtpCode(6, 'numeric'))
      )

      expect(codes.every((code) => code === '000000')).toBe(false)
      expect(codes.every((code) => /^[0-9]{6}$/u.test(code))).toBe(true)
    })
  })

  it('should key two recipients differently when createHash is replaced by one that answers a constant', () => {
    const fake = { update: () => fake, digest: () => 'constant' }

    const [one, other] = withReplaced({ createHash: () => fake }, () => [
      hashTenantRecipient('acme', 'a@x.com'),
      hashTenantRecipient('acme', 'b@x.com')
    ])

    expect(one).not.toBe(other)
  })

  it('should give two sends different ids when randomUUID is replaced by one that repeats', async () => {
    const provider = new NoOpEmailProvider()
    const message = { to: 'a@x.com', from: 'f@x.com', subject: 's', html: '<p>x</p>' }

    const ids = await withReplaced({ randomUUID: () => 'fixed' }, async () => [
      (await provider.send(message)).messageId,
      (await provider.send(message)).messageId
    ])

    expect(ids[0]).not.toBe(ids[1])
  })

  it('should issue unpredictable codes and refuse a wrong one with every function replaced at once', async () => {
    const storage = new InMemoryOtpStorage()
    const service = new OtpService(
      makeOptions({ codeSecret: SECRET }),
      storage,
      makeAudit(),
      emailServiceStub
    )
    emailSendTemplate.mockReset()
    emailSendTemplate.mockResolvedValue({ messageId: 'm1' })
    const fake = { update: () => fake, digest: () => 'constant' }

    const outcome = await withReplaced(
      {
        randomInt: () => 0,
        createHmac: () => fake,
        createHash: () => fake,
        timingSafeEqual: () => true,
        randomUUID: () => 'fixed'
      },
      async () => {
        const base = { ...ref, tenantId: 'acme' }
        await service.generate({ ...base })
        const sent = emailSendTemplate.mock.calls.at(-1)?.[0] as { data: { code: string } }
        const wrong = sent.data.code === '999999' ? '999998' : '999999'
        return { code: sent.data.code, wrong: await service.verify({ ...base, code: wrong }) }
      }
    )

    expect(outcome.code).not.toBe('000000')
    expect(outcome.wrong).toMatchObject({ valid: false })
  })
})
