/**
 * @fileoverview Holds the module to warning once, at startup, when `global.redisNamespace` is set:
 * the option never reaches `RedisOtpStorage`, which takes its own `namespace`, so a host that set
 * only the global one would write under the default prefix without knowing it. The warning is a
 * constant line with no value, written whether or not the value differs from the default, and
 * written by both registration forms.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'
import type { DynamicModule } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxNotificationModule } from './bymax-notification.module'
import type { BymaxNotificationModuleOptions } from './interfaces/notification-module-options.interface'
import { NoOpEmailProvider } from './providers/no-op-email.provider'
import { loggedEvent, loggedText } from './__tests__/logged'

const EVENT = 'NOTIFICATION_REDIS_NAMESPACE_UNUSED'
const SENTINEL_NAMESPACE = 'app-a-sentinel'

const withGlobal = (global?: { redisNamespace?: string }): BymaxNotificationModuleOptions => ({
  email: { provider: new NoOpEmailProvider(), defaultFrom: 'noreply@acme.com' },
  ...(global === undefined ? {} : { global })
})

/** Both forms build the options the same way, so the same cases run against each. */
const FORMS: ReadonlyArray<{
  readonly form: string
  readonly register: (options: BymaxNotificationModuleOptions) => Promise<void>
}> = [
  {
    form: 'forRoot',
    register: async (options) => {
      BymaxNotificationModule.forRoot(options)
    }
  },
  {
    form: 'forRootAsync',
    register: async (options) => {
      const moduleRef = await Test.createTestingModule({
        imports: [BymaxNotificationModule.forRootAsync({ useFactory: () => options })]
      }).compile()
      await moduleRef.close()
    }
  }
]

describe.each(FORMS)('global.redisNamespace warning with $form', ({ register }) => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const unused = (): unknown[][] =>
    warn.mock.calls.filter((call) => loggedEvent(call) === EVENT) as unknown[][]

  it('should warn once when the option is set', async () => {
    await register(withGlobal({ redisNamespace: SENTINEL_NAMESPACE }))

    expect(unused()).toHaveLength(1)
  })

  it('should warn even when the value is the default, since comparing would need the storage', async () => {
    await register(withGlobal({ redisNamespace: 'notification' }))

    expect(unused()).toHaveLength(1)
  })

  it('should say the option does not reach RedisOtpStorage and name its namespace option', async () => {
    await register(withGlobal({ redisNamespace: SENTINEL_NAMESPACE }))

    expect(loggedText(unused()[0])).toBe(
      '[BYMAX_NOTIFICATION_REDIS_NAMESPACE_UNUSED] global.redisNamespace is deprecated and does not reach ' +
        'RedisOtpStorage: pass the `namespace` constructor option of RedisOtpStorage instead.'
    )
  })

  it('should never write the value the host gave', async () => {
    await register(withGlobal({ redisNamespace: SENTINEL_NAMESPACE }))

    expect(JSON.stringify(unused())).not.toContain(SENTINEL_NAMESPACE)
  })

  it.each([
    ['no global section', undefined],
    ['a global section without it', {}],
    ['an explicit undefined', { redisNamespace: undefined }]
  ])('should stay silent with %s', async (_label, global) => {
    await register(withGlobal(global as { redisNamespace?: string } | undefined))

    expect(unused()).toHaveLength(0)
  })
})

describe('the module result', () => {
  it('should still build with the option set, so the warning is only a warning', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)

    const built: DynamicModule = BymaxNotificationModule.forRoot(
      withGlobal({ redisNamespace: 'x' })
    )

    expect(built.module).toBe(BymaxNotificationModule)
    jest.restoreAllMocks()
  })
})
