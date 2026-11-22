/**
 * @fileoverview Specs for the pooled transport and the shutdown of SmtpEmailProvider: the `pool`
 * option and its validation, what `close()` does and does not do to a send in flight, the fixed
 * warning when a close fails, and Nest closing the provider with the application.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxNotificationModule } from '../bymax-notification.module'

import { baseOptions, definedOnly } from './__tests__/smtp-email-provider.fixtures'
import { SmtpEmailProvider } from './smtp-email.provider'
import type { SmtpEmailProviderOptions } from './smtp-email.types'

// `mock`-prefixed names are allowed inside the hoisted jest.mock factory.
const mockSendMail = jest.fn()
const mockClose = jest.fn()
const mockCreateTransport = jest.fn()

// `nodemailer` is an optional peer dep that is NOT installed; the virtual flag lets jest register a
// mock module for the lazy `import('nodemailer')`.
jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})

/** A trap or getter that throws, as host code may. */
function throwing(): never {
  throw new Error('host code threw')
}

/** A Proxy whose handler has been revoked: every operation on it throws. */
function revokedProxy(): object {
  const { proxy, revoke } = Proxy.revocable({}, {})
  revoke()
  return proxy
}

/** The transport config handed to `createTransport` on the most recent init. */
function lastTransportConfig(): Record<string, unknown> {
  return definedOnly(mockCreateTransport.mock.calls.at(-1)?.[0])
}

beforeEach(() => {
  jest.clearAllMocks()
  mockClose.mockReset()
  mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail, close: mockClose }))
  mockSendMail.mockResolvedValue({ messageId: '<abc@relay>' })
})

describe('SmtpEmailProvider pool option', () => {
  it.each([
    ['maxConnections of 0', { maxConnections: 0 }, 'maxConnections'],
    ['a negative maxConnections', { maxConnections: -1 }, 'maxConnections'],
    ['a fractional maxConnections', { maxConnections: 1.5 }, 'maxConnections'],
    ['a string maxConnections', { maxConnections: '5' }, 'maxConnections'],
    ['maxMessages of 0', { maxMessages: 0 }, 'maxMessages'],
    ['a fractional maxMessages', { maxMessages: 2.5 }, 'maxMessages'],
    ['a string maxMessages', { maxMessages: '100' }, 'maxMessages']
  ])('should refuse %s', (_label, pool, field) => {
    expect(() => new SmtpEmailProvider({ host: 'h', pool: pool as never })).toThrow(
      `SmtpEmailProvider: pool.${field} must be a positive integer`
    )
  })

  // An array is not the object the option describes.
  it.each([
    ['an empty array', []],
    ['an array of limits', [{ maxConnections: 3 }]]
  ])('should refuse a pool given as %s', (_label, pool) => {
    expect(() => new SmtpEmailProvider({ host: 'h', pool: pool as never })).toThrow(
      'SmtpEmailProvider: pool must be an object'
    )
  })

  // Nor is a typed array, a buffer or anything else that has a length: each is `typeof` an object.
  it.each([
    ['a Uint8Array', new Uint8Array(0)],
    ['an Int32Array', new Int32Array(2)],
    ['a Buffer', Buffer.alloc(0)],
    ['an ArrayBuffer', new ArrayBuffer(0)],
    ['a DataView', new DataView(new ArrayBuffer(1))],
    ['an array-like object', { length: 0 }],
    [
      'an arguments object',
      (function (..._: unknown[]) {
        return arguments
      })()
    ]
  ])('should refuse a pool given as %s', (_label, pool) => {
    expect(() => new SmtpEmailProvider({ host: 'h', pool: pool as never })).toThrow(
      'SmtpEmailProvider: pool must be an object'
    )
  })

  // A limit past the largest safe integer is not an integer a count can be held to: 2**53 and its
  // neighbours compare equal after one more step, and a pool of that size is no limit at all.
  it.each([
    ['maxConnections of 2**53', { maxConnections: 2 ** 53 }, 'maxConnections'],
    ['maxConnections of 1e21', { maxConnections: 1e21 }, 'maxConnections'],
    ['maxMessages of 2**53', { maxMessages: 2 ** 53 }, 'maxMessages'],
    ['maxMessages of the largest double', { maxMessages: Number.MAX_VALUE }, 'maxMessages'],
    ['maxMessages of Infinity', { maxMessages: Infinity }, 'maxMessages']
  ])('should refuse %s', (_label, pool, field) => {
    expect(() => new SmtpEmailProvider({ host: 'h', pool })).toThrow(
      `SmtpEmailProvider: pool.${field} must be a positive integer of at most 9007199254740991`
    )
  })

  it('should accept the largest safe integer for both limits', () => {
    expect(
      () =>
        new SmtpEmailProvider({
          host: 'h',
          pool: { maxConnections: Number.MAX_SAFE_INTEGER, maxMessages: Number.MAX_SAFE_INTEGER }
        })
    ).not.toThrow()
  })

  // Reading the option is host code too: a getter or a Proxy that throws must end in the same
  // refusal as any other value that is not an options object, not in its own error.
  it.each([
    ['a throwing length getter', Object.defineProperty({}, 'length', { get: throwing })],
    ['a throwing limit getter', Object.defineProperty({}, 'maxConnections', { get: throwing })],
    ['a Proxy that throws on every read', new Proxy({}, { get: throwing })],
    ['a Proxy that throws on its prototype', new Proxy({}, { getPrototypeOf: throwing })],
    ['a revoked Proxy', revokedProxy()]
  ])('should refuse a pool given as %s', (_label, pool) => {
    expect(() => new SmtpEmailProvider({ host: 'h', pool: pool as never })).toThrow(
      'SmtpEmailProvider: pool must be an object'
    )
  })

  // The options are the host's object, and a timeout is checked once, when the provider is built:
  // changing it afterwards must not reach the transport, or the check could be walked around.
  it.each(['connectionTimeout', 'greetingTimeout', 'socketTimeout'] as const)(
    'should keep the %s it was built with when the options object changes',
    async (option) => {
      const options = { host: 'h', [option]: 5_000 }
      const provider = new SmtpEmailProvider(options)
      Object.assign(options, { [option]: 3_000_000_000 })

      await provider.send(baseOptions).catch(() => undefined)

      expect(lastTransportConfig()[option]).toBe(5_000)
    }
  )

  // A value is read once and the provider keeps what it validated: a getter that answers with a
  // valid bound and then an invalid one must not get the invalid one into the transport.
  it.each(['connectionTimeout', 'greetingTimeout', 'socketTimeout'] as const)(
    'should keep the %s that was validated when the option answers differently after',
    async (option) => {
      let reads = 0
      const options = { host: 'h' }
      Object.defineProperty(options, option, {
        enumerable: true,
        get: () => {
          reads += 1
          return reads === 1 ? 5_000 : 3_000_000_000
        }
      })
      const provider = new SmtpEmailProvider(options)

      await provider.send(baseOptions).catch(() => undefined)

      expect(lastTransportConfig()[option]).toBe(5_000)
    }
  )

  // A key that reads as undefined or null is not set and takes the default, as it does when it is
  // left out, and the checks run on what is left.
  it.each([
    ['port', 587],
    ['connectionTimeout', 10_000],
    ['greetingTimeout', 10_000],
    ['socketTimeout', 20_000]
  ] as const)(
    'should take the default %s for an undefined and a null',
    async (option, expected) => {
      for (const value of [undefined, null]) {
        jest.clearAllMocks()
        const provider = new SmtpEmailProvider({ host: 'h', [option]: value } as never)

        await provider.send(baseOptions).catch(() => undefined)

        expect(lastTransportConfig()[option]).toBe(expected)
      }
    }
  )

  // `credentials` is not in this table: its default is an unauthenticated session, so a null is
  // refused (see the nested options spec) and only an undefined is read as omitted.
  it.each([undefined, null])('should send unpooled and without a login for %p', async (value) => {
    const provider = new SmtpEmailProvider({
      host: 'h',
      pool: value,
      credentials: undefined,
      tls: value,
      sendTimeoutMs: value
    } as never)

    await provider.send(baseOptions).catch(() => undefined)

    expect(lastTransportConfig()).toMatchObject({ host: 'h', tls: {} })
    expect(lastTransportConfig()).not.toHaveProperty('auth')
    expect(lastTransportConfig()).not.toHaveProperty('pool')
  })

  it.each([undefined, null])('should not be configured when the host is %p', (host) => {
    expect(new SmtpEmailProvider({ host } as never).isConfigured()).toBe(false)
  })

  // A host may pass a class whose options are getters on the prototype (a ConfigService behind
  // each): they are read by property access, once, like own properties.
  it('should keep the options a class instance supplies from its prototype', async () => {
    const reads = { host: 0, port: 0 }
    class RelayOptions {
      get host(): string {
        reads.host += 1
        return 'relay.example'
      }
      get port(): number {
        reads.port += 1
        return 2525
      }
      get connectionTimeout(): number {
        return 7_000
      }
      get pool(): { maxConnections: number } {
        return { maxConnections: 3 }
      }
    }
    const provider = new SmtpEmailProvider(new RelayOptions())

    expect(provider.isConfigured()).toBe(true)
    await provider.send(baseOptions).catch(() => undefined)

    expect(lastTransportConfig()).toMatchObject({
      host: 'relay.example',
      port: 2525,
      connectionTimeout: 7_000,
      pool: true,
      maxConnections: 3
    })
    expect(reads).toEqual({ host: 1, port: 1 })
  })

  // Every option of SmtpEmailProviderOptions reaches the transport. The literal must list every
  // key (the compiler refuses a missing one), so a new option forces this case to be updated and
  // fails until the provider keeps it.
  it('should keep every option of SmtpEmailProviderOptions', async () => {
    const options = {
      host: 'relay.example',
      port: 2525,
      secure: true,
      requireTls: false,
      credentials: { user: 'u', pass: 'p' },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 1_000,
      greetingTimeout: 2_000,
      socketTimeout: 3_000,
      sendTimeoutMs: 4_000,
      pool: { maxConnections: 2, maxMessages: 5 }
    } satisfies Required<SmtpEmailProviderOptions>

    await new SmtpEmailProvider(options).send(baseOptions).catch(() => undefined)

    expect(lastTransportConfig()).toMatchObject({
      host: 'relay.example',
      port: 2525,
      secure: true,
      requireTLS: false,
      auth: { user: 'u', pass: 'p' },
      tls: { rejectUnauthorized: false },
      connectionTimeout: 1_000,
      greetingTimeout: 2_000,
      socketTimeout: 3_000,
      pool: true,
      maxConnections: 2,
      maxMessages: 5
    })
  })

  // The limits are read once, at construction: a getter that answers differently later must not
  // change what the transport is built with.
  it('should read the limits of the pool once', async () => {
    let reads = 0
    const pool = {
      get maxConnections(): number {
        reads += 1
        return reads === 1 ? 3 : 99
      }
    }
    const provider = new SmtpEmailProvider({ host: 'h', pool })

    await provider.send(baseOptions).catch(() => undefined)

    expect(lastTransportConfig()).toMatchObject({ pool: true, maxConnections: 3 })
  })

  it.each([
    ['true', true],
    ['a string', 'yes']
  ])('should refuse a pool given as %s', (_label, pool) => {
    expect(() => new SmtpEmailProvider({ host: 'h', pool: pool as never })).toThrow(
      'SmtpEmailProvider: pool must be an object'
    )
  })

  it.each([{}, { maxConnections: 3 }, { maxMessages: 50 }, { maxConnections: 3, maxMessages: 50 }])(
    'should accept the pool %j',
    (pool) => {
      expect(() => new SmtpEmailProvider({ host: 'h', pool })).not.toThrow()
    }
  )

  it('should hand a pooled transport its two limits when they are set', async () => {
    await new SmtpEmailProvider({
      host: 'h',
      pool: { maxConnections: 3, maxMessages: 50 }
    }).send(baseOptions)

    expect(lastTransportConfig()).toMatchObject({ pool: true, maxConnections: 3, maxMessages: 50 })
  })

  it('should hand a pooled transport only the limit that is set', async () => {
    await new SmtpEmailProvider({ host: 'h', pool: { maxMessages: 7 } }).send(baseOptions)

    const config = lastTransportConfig()
    expect(config).toMatchObject({ pool: true, maxMessages: 7 })
    expect(config).not.toHaveProperty('maxConnections')
  })

  it('should hand a pooled transport the nodemailer defaults for an empty pool', async () => {
    await new SmtpEmailProvider({ host: 'h', pool: {} }).send(baseOptions)

    const config = lastTransportConfig()
    expect(config).toMatchObject({ pool: true })
    expect(config).not.toHaveProperty('maxConnections')
    expect(config).not.toHaveProperty('maxMessages')
  })

  it('should leave the transport config as it was without a pool', async () => {
    await new SmtpEmailProvider({ host: 'h' }).send(baseOptions)

    const config = lastTransportConfig()
    expect(config).not.toHaveProperty('pool')
    expect(config).not.toHaveProperty('maxConnections')
    expect(config).not.toHaveProperty('maxMessages')
  })
})

describe('SmtpEmailProvider close', () => {
  it('should close the transport it built, once', async () => {
    const provider = new SmtpEmailProvider({ host: 'h' })
    await provider.send(baseOptions)

    await provider.close()

    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it('should do nothing, and load nothing, when no transport was ever built', async () => {
    await new SmtpEmailProvider({ host: 'h' }).close()

    expect(mockCreateTransport).not.toHaveBeenCalled()
    expect(mockClose).not.toHaveBeenCalled()
  })

  it('should be idempotent', async () => {
    const provider = new SmtpEmailProvider({ host: 'h' })
    await provider.send(baseOptions)

    await provider.close()
    await provider.close()

    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it('should build a new transport for a send after it, which the host closes again', async () => {
    const provider = new SmtpEmailProvider({ host: 'h' })
    await provider.send(baseOptions)
    await provider.close()

    await provider.send(baseOptions)
    await provider.close()

    expect(mockCreateTransport).toHaveBeenCalledTimes(2)
    expect(mockClose).toHaveBeenCalledTimes(2)
  })

  it('should close a transport whose build was still in flight', async () => {
    const provider = new SmtpEmailProvider({ host: 'h' })
    const sending = provider.send(baseOptions)

    await provider.close()
    await sending

    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  it('should cope with a transport that has no close method', async () => {
    mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail }))
    const provider = new SmtpEmailProvider({ host: 'h' })
    await provider.send(baseOptions)

    await expect(provider.close()).resolves.toBeUndefined()
  })

  it('should not break after a build that failed', async () => {
    mockCreateTransport.mockImplementationOnce(() => {
      throw new Error('bad config')
    })
    const provider = new SmtpEmailProvider({ host: 'h' })
    await expect(provider.send(baseOptions)).rejects.toThrow('bad config')

    await expect(provider.close()).resolves.toBeUndefined()
    expect(mockClose).not.toHaveBeenCalled()
  })

  it('should leave a failed build to its own caller when it is closed meanwhile', async () => {
    mockCreateTransport.mockImplementationOnce(() => {
      throw new Error('bad config')
    })
    const provider = new SmtpEmailProvider({ host: 'h' })
    const sending = provider.send(baseOptions)
    const closing = provider.close()

    await expect(sending).rejects.toThrow('bad config')
    await expect(closing).resolves.toBeUndefined()
    expect(mockClose).not.toHaveBeenCalled()
  })

  // A build that fails after close() has taken it, while a later send has started a build of its own,
  // must not clear the later one from the cache: nothing could close its transport afterwards.
  it('should keep a newer build when an older one that close() took fails late', async () => {
    mockCreateTransport.mockImplementationOnce(() => {
      throw new Error('bad config')
    })
    const provider = new SmtpEmailProvider({ host: 'h', pool: {} })
    const first = provider.send(baseOptions)
    const closing = provider.close()
    const second = provider.send(baseOptions)

    const [firstResult, , secondResult] = await Promise.allSettled([first, closing, second])
    await provider.close()

    expect(firstResult.status).toBe('rejected')
    expect(secondResult.status).toBe('fulfilled')
    expect(mockClose).toHaveBeenCalledTimes(1)
  })

  // A close that throws must not stop the host's other shutdown hooks, and what it threw can hold the
  // relay's own words or a credential, so the log line is fixed text and carries none of it.
  it('should log a fixed line, and never what the failed close threw', async () => {
    mockClose.mockImplementation(() => {
      throw new Error('relay said: login failed for hunter2')
    })
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const provider = new SmtpEmailProvider({
      host: 'h',
      credentials: { user: 'u', pass: 'hunter2' }
    })
    await provider.send(baseOptions)

    await expect(provider.close()).resolves.toBeUndefined()

    expect(warn.mock.calls).toEqual([
      [
        {
          event: 'NOTIFICATION_SMTP_CLOSE_FAILED',
          message: '[SMTP_CLOSE_FAILED] The transport could not be closed.'
        }
      ]
    ])
    warn.mockRestore()
  })

  it('should close through the Nest shutdown hook', async () => {
    const provider = new SmtpEmailProvider({ host: 'h' })
    const close = jest.spyOn(provider, 'close')

    await provider.onModuleDestroy()

    expect(close).toHaveBeenCalledTimes(1)
  })
})

// What nodemailer 10 does with a close, measured against a local relay: a send already in flight on
// the pooled transport finishes and resolves, one still waiting for a connection rejects with
// 'Connection pool was closed', and a send on the same transport after the close rejects too. The
// stand-in below answers the way it did, so these cases hold what THIS adapter does with each answer.
describe('SmtpEmailProvider close with a send in flight', () => {
  it('should neither wait for nor disturb a send that is already in flight', async () => {
    let finish: (info: { messageId: string }) => void = () => undefined
    mockSendMail.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve as typeof finish
        })
    )
    const provider = new SmtpEmailProvider({ host: 'h', pool: { maxConnections: 1 } })
    const sending = provider.send(baseOptions)
    await new Promise((resolve) => setImmediate(resolve))

    await provider.close()
    finish({ messageId: '<late@relay>' })

    await expect(sending).resolves.toEqual({ messageId: '<late@relay>' })
  })

  // The stand-in holds a send that is waiting for a connection and rejects it when the pool closes,
  // as Nodemailer does, so what is checked is the adapter's answer to that rejection and that closing
  // is what brings it about.
  it('should fail a send that was still waiting for a connection when the pool closes', async () => {
    const waiting: Array<(error: Error) => void> = []
    mockSendMail.mockImplementation(
      () =>
        new Promise((_resolve, reject: (error: Error) => void) => {
          waiting.push(reject)
        })
    )
    mockClose.mockImplementation(() => {
      for (const reject of waiting) {
        reject(new Error('Connection pool was closed'))
      }
    })
    const provider = new SmtpEmailProvider({ host: 'h', pool: { maxConnections: 1 } })
    const sending = provider.send(baseOptions)
    await new Promise((resolve) => setImmediate(resolve))

    await provider.close()

    await expect(sending).rejects.toThrow('SMTP send failed: Connection pool was closed')
  })
})

describe('SmtpEmailProvider and the Nest application', () => {
  it('should be closed when the application closes', async () => {
    const provider = new SmtpEmailProvider({ host: 'h' })
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRoot({
          email: { provider, defaultFrom: 'noreply@acme.com' }
        })
      ]
    }).compile()
    await moduleRef.init()
    await provider.send(baseOptions)

    await moduleRef.close()

    expect(mockClose).toHaveBeenCalledTimes(1)
  })
})
