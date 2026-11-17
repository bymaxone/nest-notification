/**
 * @fileoverview Holds the module to storing what it validated. A getter that answers with a valid
 * value the first time and an invalid one afterwards passes validation, and the service must be
 * built from the value that passed, in `forRoot` and in `forRootAsync`.
 * @layer application
 */

import { Test } from '@nestjs/testing'

import { BYMAX_NOTIFICATION_OPTIONS } from './bymax-notification.constants'
import { BymaxNotificationModule } from './bymax-notification.module'
import type { IEmailProvider, IOtpStorage } from './interfaces'
import type { ResolvedNotificationOptions } from './config/resolved-options'

const storage = {
  name: 'fake',
  set: async () => undefined,
  get: async () => null
} as unknown as IOtpStorage
const provider: IEmailProvider = {
  name: 'fake',
  isConfigured: () => true,
  send: async () => ({ messageId: 'x' })
}

/** An options object whose `field` answers `first` once and `later` after that. */
function flipping<T extends object>(base: T, field: string, first: unknown, later: unknown): T {
  let reads = 0
  Object.defineProperty(base, field, {
    enumerable: true,
    get: () => {
      reads += 1
      return reads === 1 ? first : later
    }
  })
  return base
}

describe('BymaxNotificationModule options that answer differently on a second read', () => {
  it('should store the attempts bound that was validated in forRoot', async () => {
    const otp = flipping({ storage }, 'defaultMaxAttempts', 3, Number.NaN)

    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRoot({ otp } as never)]
    }).compile()

    const resolved = moduleRef.get<ResolvedNotificationOptions>(BYMAX_NOTIFICATION_OPTIONS)
    expect(resolved.otp?.defaultMaxAttempts).toBe(3)
    await moduleRef.close()
  })

  it('should store the attachment bound that was validated in forRoot', async () => {
    const email = flipping(
      { provider, defaultFrom: 'a@b.com' },
      'maxAttachmentBytes',
      1024,
      Number.NaN
    )

    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRoot({ email } as never)]
    }).compile()

    const resolved = moduleRef.get<ResolvedNotificationOptions>(BYMAX_NOTIFICATION_OPTIONS)
    expect(resolved.email?.maxAttachmentBytes).toBe(1024)
    await moduleRef.close()
  })

  it('should store the perPurpose attempts bound that was validated in forRoot', async () => {
    const entry = flipping({}, 'maxAttempts', 2, Number.NaN)

    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRoot({
          otp: { storage, perPurpose: { mfa_oob: entry } }
        } as never)
      ]
    }).compile()

    const resolved = moduleRef.get<ResolvedNotificationOptions>(BYMAX_NOTIFICATION_OPTIONS)
    expect(resolved.otp?.perPurpose['mfa_oob']?.maxAttempts).toBe(2)
    await moduleRef.close()
  })

  // What the validation refuses is refused after the copy too: an array entry must not become an
  // empty object that passes.
  it.each([
    [
      'an array entry',
      { perPurpose: { mfa_oob: [] } },
      'options.otp.perPurpose.mfa_oob must be an object, got an array'
    ],
    [
      'a null entry',
      { perPurpose: { mfa_oob: null } },
      'options.otp.perPurpose.mfa_oob must be an object, got null'
    ],
    [
      'a string entry',
      { perPurpose: { mfa_oob: 'x' } },
      'options.otp.perPurpose.mfa_oob must be an object, got a string'
    ],
    [
      'an array container',
      { perPurpose: [] },
      'options.otp.perPurpose must be an object, got an array'
    ]
  ])('should refuse %s in forRoot and in forRootAsync', async (_label, extra, message) => {
    expect(() => BymaxNotificationModule.forRoot({ otp: { storage, ...extra } } as never)).toThrow(
      message
    )
    await expect(
      Test.createTestingModule({
        imports: [
          BymaxNotificationModule.forRootAsync({
            useFactory: () => ({ otp: { storage, ...extra } }) as never
          })
        ]
      }).compile()
    ).rejects.toThrow(message)
  })

  // A host may pass classes whose options are getters on the prototype (a ConfigService behind
  // each): the values they supply are the values the services get.
  it('should keep the options a class instance supplies from its prototype', async () => {
    class Otp {
      readonly storage = storage
      get defaultTtlSeconds(): number {
        return 120
      }
      get defaultMaxAttempts(): number {
        return 4
      }
    }
    class Email {
      readonly provider = provider
      get defaultFrom(): string {
        return 'noreply@relay.example'
      }
      get maxRecipients(): number {
        return 7
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRoot({ otp: new Otp(), email: new Email() } as never)]
    }).compile()

    const resolved = moduleRef.get<ResolvedNotificationOptions>(BYMAX_NOTIFICATION_OPTIONS)
    expect(resolved.otp?.defaultTtlSeconds).toBe(120)
    expect(resolved.otp?.defaultMaxAttempts).toBe(4)
    expect(resolved.email?.defaultFrom).toBe('noreply@relay.example')
    expect(resolved.email?.maxRecipients).toBe(7)
    await moduleRef.close()
  })

  // The options themselves must be an object, and the refusal says so.
  it.each([undefined, null, 'x', 5, true, []])(
    'should refuse %p as the options in forRoot and in forRootAsync',
    async (value) => {
      const message = '[BymaxNotificationModule] options must be an object'

      expect(() => BymaxNotificationModule.forRoot(value as never)).toThrow(message)
      await expect(
        Test.createTestingModule({
          imports: [BymaxNotificationModule.forRootAsync({ useFactory: () => value as never })]
        }).compile()
      ).rejects.toThrow(message)
    }
  )

  it('should store the attempts bound that was validated in forRootAsync', async () => {
    const otp = flipping({ storage }, 'defaultMaxAttempts', 3, Number.NaN)

    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRootAsync({ useFactory: () => ({ otp }) as never })]
    }).compile()

    const resolved = moduleRef.get<ResolvedNotificationOptions>(BYMAX_NOTIFICATION_OPTIONS)
    expect(resolved.otp?.defaultMaxAttempts).toBe(3)
    await moduleRef.close()
  })
})
