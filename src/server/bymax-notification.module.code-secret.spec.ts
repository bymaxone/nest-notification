/**
 * @fileoverview Specifies the startup warning for an OTP channel that stores codes in
 * plaintext: it is emitted once per module, only when the OTP channel is configured without
 * `otp.codeSecret`, by `forRoot` and by `forRootAsync` alike.
 * @layer infrastructure
 */
import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxNotificationModule } from './bymax-notification.module'
import type { IEmailProvider, IOtpStorage } from './interfaces'
import { InMemoryOtpStorage } from './providers/in-memory-otp.storage'

const emailProvider: IEmailProvider = {
  name: 'fake',
  isConfigured: () => true,
  send: async () => ({ messageId: 'x' })
}
const validEmail = { provider: emailProvider, defaultFrom: 'noreply@example.com' }
const storage = (): IOtpStorage => new InMemoryOtpStorage()
const SECRET = 'a-secret-of-at-least-thirty-two-bytes!'

describe('plaintext OTP code storage warning', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const warned = (): string[] => warnSpy.mock.calls.map((call) => String(call[0]))

  // An OTP channel without the secret stores codes in the clear; say so, naming the option.
  it('should warn once from forRoot when the OTP channel has no secret', () => {
    BymaxNotificationModule.forRoot({ otp: { storage: storage() } })

    const messages = warned().filter((m) => m.includes('otp.codeSecret'))
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain('plaintext')
  })

  // With the secret the warning has nothing to say.
  it('should not warn when the secret is configured', () => {
    BymaxNotificationModule.forRoot({ otp: { storage: storage(), codeSecret: SECRET } })

    expect(warned().filter((m) => m.includes('otp.codeSecret'))).toHaveLength(0)
  })

  // An email-only module has no OTP codes to protect.
  it('should not warn for a module without the OTP channel', () => {
    BymaxNotificationModule.forRoot({ email: validEmail })

    expect(warned().filter((m) => m.includes('otp.codeSecret'))).toHaveLength(0)
  })

  // forRootAsync resolves the options inside DI; it must warn too, once per module.
  it('should warn once from forRootAsync when the OTP channel has no secret', async () => {
    await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRootAsync({
          useFactory: () => ({ otp: { storage: storage() } })
        })
      ]
    }).compile()

    expect(warned().filter((m) => m.includes('otp.codeSecret'))).toHaveLength(1)
  })

  it('should not warn from forRootAsync when the secret is configured', async () => {
    await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRootAsync({
          useFactory: () => ({ otp: { storage: storage(), codeSecret: SECRET } })
        })
      ]
    }).compile()

    expect(warned().filter((m) => m.includes('otp.codeSecret'))).toHaveLength(0)
  })
})
