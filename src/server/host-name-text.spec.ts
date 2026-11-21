/**
 * @fileoverview Holds the library's own log and error text to the rule that a name taken from the
 * host (a storage name, a locale, a class name) reaches it bounded and escaped, so a name with a line
 * break or a bidi override cannot forge a second line or reorder the text.
 * @layer logging
 */

import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxNotificationModule } from './bymax-notification.module'
import type { NotificationException } from './errors/notification-exception'
import type { IOtpStorage } from './interfaces'
import { InMemoryOtpStorage } from './providers/in-memory-otp.storage'
import { resolveOptions } from './config/resolved-options'
import { makeAudit, makeProvider, makeRenderer } from './services/__tests__/email-service.fixtures'
import { dummyRepo, makeOptions } from './services/__tests__/otp-service.fixtures'
import { EmailService } from './services/email.service'
import { OtpService } from './services/otp.service'
import { loggedText } from './__tests__/logged'

const HOSTILE = 'evil\nFORGED LINE\u202e\u200b'
const ESCAPED = 'evil\\u000aFORGED LINE\\u202e\\u200b'
const LONG = 'n'.repeat(5000)

/** A storage that keeps `InMemoryOtpStorage` behaviour under a name the host chose. */
function namedStorage(name: string, withDelete: boolean): IOtpStorage {
  const inner = new InMemoryOtpStorage()
  const named = Object.create(inner) as IOtpStorage & { name: string }
  Object.defineProperty(named, 'name', { value: name, configurable: true })
  if (!withDelete) {
    Object.defineProperty(named, 'deleteIfCode', { value: undefined })
  }
  return named
}

describe('host names in library text', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('should escape the storage name in the consumeOnVerify refusal', () => {
    const build = (): OtpService =>
      new OtpService(
        makeOptions({ consumeOnVerify: true }),
        namedStorage(HOSTILE, false),
        makeAudit()
      )

    expect(build).toThrow(`(the ${ESCAPED} storage does not)`)
  })

  it('should cut a long storage name in the consumeOnVerify refusal', () => {
    const build = (): OtpService =>
      new OtpService(makeOptions({ consumeOnVerify: true }), namedStorage(LONG, false), makeAudit())

    expect(build).toThrow(`(the ${'n'.repeat(200)}… storage does not)`)
  })

  it('should escape the storage name in the failures-not-carried line', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const storage = namedStorage(HOSTILE, true)
    Object.defineProperty(storage, 'getFailures', { value: undefined })

    new OtpService(makeOptions({}), storage, makeAudit()).onModuleInit()

    const line = loggedText(warn.mock.calls[0])
    expect(line).toContain(`The ${ESCAPED} OTP storage does not implement`)
    expect(line).not.toContain('\n')
  })

  it('should escape and cut the default locale in the template-not-resolved line', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const options = resolveOptions({
      global: { defaultLocale: `${HOSTILE}${LONG}` },
      otp: { storage: InMemoryOtpStorage },
      email: { provider: makeProvider(), defaultFrom: 'no-reply@acme.com' },
      audit: { repository: dummyRepo }
    })
    const renderer = makeRenderer()
    renderer.hasTemplate.mockResolvedValue(false)
    const emailService = new EmailService(options, makeProvider(), renderer, makeAudit())

    new OtpService(options, new InMemoryOtpStorage(), makeAudit(), emailService).onModuleInit()
    await new Promise((resolve) => setImmediate(resolve))

    const line = loggedText(warn.mock.calls.find((call) => loggedText(call).includes('neither')))
    expect(line).toContain(`neither '${ESCAPED}`)
    expect(line).toContain('…')
    expect(line).not.toContain('\n')
    expect(line).not.toContain('n'.repeat(201))
  })

  it('should escape a class name in the forRootAsync refusal', async () => {
    class Placeholder {
      constructor(readonly dependency: unknown) {}
    }
    Object.defineProperty(Placeholder, 'name', { value: HOSTILE })

    const compiling = Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRootAsync({
          useFactory: () => ({ otp: { storage: Placeholder as unknown as IOtpStorage } })
        })
      ]
    }).compile()

    await expect(compiling).rejects.toThrow(`cannot construct '${ESCAPED}'`)
  })

  describe('a name that is a getter which throws', () => {
    /** A storage whose `name` getter throws, as host code may define it. */
    function throwingNameStorage(withDelete: boolean): IOtpStorage {
      const storage = namedStorage('placeholder', withDelete)
      Object.defineProperty(storage, 'name', {
        get() {
          throw new Error('name getter of the host')
        }
      })
      return storage
    }

    it('should read the storage name as unreadable in the consumeOnVerify refusal', () => {
      const build = (): OtpService =>
        new OtpService(
          makeOptions({ consumeOnVerify: true }),
          throwingNameStorage(false),
          makeAudit()
        )

      expect(build).toThrow('(the [unreadable] storage does not)')
    })

    it('should read the storage name as unreadable in the failures-not-carried line', () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
      const storage = throwingNameStorage(true)
      Object.defineProperty(storage, 'getFailures', { value: undefined })

      new OtpService(makeOptions({}), storage, makeAudit()).onModuleInit()

      expect(loggedText(warn.mock.calls[0])).toContain('The [unreadable] OTP storage')
    })

    it('should read the class name as unreadable in the forRootAsync refusal', async () => {
      class Placeholder {
        constructor(readonly dependency: unknown) {}
      }
      Object.defineProperty(Placeholder, 'name', {
        get() {
          throw new Error('name getter of the host')
        }
      })

      const compiling = Test.createTestingModule({
        imports: [
          BymaxNotificationModule.forRootAsync({
            useFactory: () => ({ otp: { storage: Placeholder as unknown as IOtpStorage } })
          })
        ]
      }).compile()

      await expect(compiling).rejects.toThrow("cannot construct '[unreadable]'")
    })
  })

  describe('the storage name as data', () => {
    it('should cut and escape it in the details of the unavailable storage error', async () => {
      const storage = namedStorage(`${HOSTILE}${LONG}`, true)
      Object.defineProperty(storage, 'tryAcquireCooldown', {
        value: async () => {
          throw Object.assign(new Error('down'), { code: 'ECONNREFUSED' })
        }
      })
      const service = new OtpService(makeOptions({}), storage, makeAudit())

      const generating = service.generate({
        tenantId: 'acme',
        recipient: 'a@example.com',
        purpose: 'login',
        deliverVia: 'manual'
      })

      const failure = (await generating.catch((error: unknown) => error)) as NotificationException
      const details = (failure.getResponse() as { error: { details: { providerName: string } } })
        .error.details
      expect(details.providerName.startsWith(ESCAPED)).toBe(true)
      expect(details.providerName.endsWith('…')).toBe(true)
      expect(details.providerName).not.toContain('\n')
      expect(details.providerName).not.toContain('n'.repeat(201))
    })

    it('should cut and escape it in the audit entry', async () => {
      const audit = makeAudit()
      const service = new OtpService(
        makeOptions({}),
        namedStorage(`${HOSTILE}${LONG}`, true),
        audit
      )

      await service.generate({
        tenantId: 'acme',
        recipient: 'a@example.com',
        purpose: 'login',
        deliverVia: 'manual'
      })

      const entry = audit.create.mock.calls[0]?.[0]
      expect(entry?.providerName.startsWith(ESCAPED)).toBe(true)
      expect(entry?.providerName.endsWith('…')).toBe(true)
      expect(entry?.providerName.length).toBeLessThan(2100)
    })
  })
})
