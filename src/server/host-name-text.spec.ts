/**
 * @fileoverview Holds the library's own log and error text to the rule that a name taken from the
 * host (a storage name, a locale, a class name) reaches it bounded and escaped, so a name with a line
 * break or a bidi override cannot forge a second line or reorder the text.
 * @layer logging
 */

import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxNotificationModule } from './bymax-notification.module'
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
  Object.defineProperty(named, 'name', { value: name })
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
})
