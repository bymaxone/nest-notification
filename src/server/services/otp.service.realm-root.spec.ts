/**
 * @fileoverview Holds `OtpService` to the realm check the adapters make: while `Object.prototype` holds
 * a key that is not standard, or a built-in the check compares was replaced, `generate` and `verify`
 * are refused with the typed refusal, at the entry and again after each store call whose answer is
 * about to decide something. The store given to the service says what reached it.
 * @layer domain
 */

import type { IOtpStorage } from '../interfaces/otp-storage.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import {
  emailSendTemplate,
  emailServiceStub,
  makeAudit,
  makeOptions,
  ref
} from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

const REFUSAL = { code: 'notification.invalid_scope_identifier' }
const SECRET = 'a-secret-of-at-least-thirty-two-bytes!'

function plant(): void {
  Object.defineProperty(Object.prototype, 'planted', {
    value: 1,
    configurable: true,
    writable: true,
    enumerable: true
  })
}

/** A store that plants a key on the realm root once the named method has answered, and counts its calls. */
function planting(after: string | undefined): { storage: IOtpStorage; called: string[] } {
  const inner = new InMemoryOtpStorage()
  const called: string[] = []
  let planted = false
  const storage = new Proxy(inner, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown
      if (typeof value !== 'function') {
        return value
      }
      return async (...args: unknown[]) => {
        called.push(String(property))
        const answer = await (value as (...a: unknown[]) => unknown).apply(target, args)
        if (property === after && !planted) {
          planted = true
          plant()
        }
        return answer
      }
    }
  }) as IOtpStorage
  return { storage, called }
}

function service(storage: IOtpStorage, otp: Record<string, unknown> = {}): OtpService {
  return new OtpService(
    makeOptions({ codeSecret: SECRET, ...otp }),
    storage,
    makeAudit(),
    emailServiceStub
  )
}

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

beforeEach(() => {
  emailSendTemplate.mockReset()
  emailSendTemplate.mockResolvedValue({ messageId: 'm1' })
})

afterEach(() => {
  Reflect.deleteProperty(Object.prototype, 'planted')
})

describe('OtpService while the realm root is polluted', () => {
  it('should refuse generate at its entry, before any store call or delivery', async () => {
    const { storage, called } = planting(undefined)
    plant()

    await expect(service(storage).generate({ ...ref })).rejects.toMatchObject(REFUSAL)

    expect(called).toStrictEqual([])
    expect(emailSendTemplate).not.toHaveBeenCalled()
  })

  it('should refuse verify at its entry, before any store call', async () => {
    const { storage, called } = planting(undefined)
    plant()

    await expect(service(storage).verify({ ...ref, code: '123456' })).rejects.toMatchObject(REFUSAL)

    expect(called).toStrictEqual([])
  })

  it('should refuse generate when a key is planted while the cooldown is being taken, before a code is stored or sent', async () => {
    const { storage, called } = planting('tryAcquireCooldown')

    await expect(service(storage).generate({ ...ref })).rejects.toMatchObject(REFUSAL)

    expect(called).not.toContain('set')
    expect(emailSendTemplate).not.toHaveBeenCalled()
  })

  it('should refuse verify, and never accept the code, when a key is planted while the attempt is counted', async () => {
    const { storage } = planting('consumeAttempt')
    const issuing = service(storage)
    await issuing.generate({ ...ref })
    const sent = emailSendTemplate.mock.calls.at(-1)?.[0] as { data: { code: string } }

    await expect(issuing.verify({ ...ref, code: sent.data.code })).rejects.toMatchObject(REFUSAL)
  })
})

describe('OtpService when the realm check refuses after a store call', () => {
  it('should release the cooldown it took, so the recipient can generate again once the root is clean', async () => {
    const { storage } = planting('tryAcquireCooldown')
    const issuing = service(storage)
    await expect(issuing.generate({ ...ref })).rejects.toMatchObject(REFUSAL)
    Reflect.deleteProperty(Object.prototype, 'planted')

    const again = await issuing.generate({ ...ref })

    expect(again.expiresAt).toBeGreaterThan(Date.now())
  })

  it('should refuse verify, and never accept the code, when a key is planted while the code is consumed', async () => {
    const { storage } = planting('deleteIfCode')
    const consuming = service(storage, { consumeOnVerify: true })
    await consuming.generate({ ...ref })
    const sent = emailSendTemplate.mock.calls.at(-1)?.[0] as { data: { code: string } }

    await expect(consuming.verify({ ...ref, code: sent.data.code })).rejects.toMatchObject(REFUSAL)
  })
})

describe('OtpService with a built-in replaced, which the verdict would have read', () => {
  it('should refuse a purpose nothing registered when Set.prototype.has answers true', async () => {
    const { storage } = planting(undefined)
    const strict = service(storage, { strictPurposes: true, perPurpose: { login: { length: 8 } } })

    const attempt = replacing(
      Set.prototype,
      'has',
      () => true,
      () => strict.generate({ ...ref, purpose: 'unknown_flow', deliverVia: 'manual' })
    )

    await expect(attempt).rejects.toMatchObject(REFUSAL)
  })

  it('should keep a locked code locked when Map.prototype.has answers false', async () => {
    const issuing = new InMemoryOtpStorage()
    const locked = service(issuing, { defaultMaxAttempts: 1, codeSecret: SECRET })
    await locked.generate({ ...ref })
    const sent = emailSendTemplate.mock.calls.at(-1)?.[0] as { data: { code: string } }
    await locked.verify({ ...ref, code: sent.data.code === '999999' ? '999998' : '999999' })

    const attempt = replacing(
      Map.prototype,
      'has',
      () => false,
      () => locked.verify({ ...ref, code: sent.data.code })
    )

    await expect(attempt).rejects.toMatchObject(REFUSAL)
  })
})
