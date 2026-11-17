/**
 * @fileoverview Specs for the options of SmtpEmailProvider that are objects: `credentials` and
 * `tls` are read once, key by key, into the copy the provider keeps; an unset key takes its default;
 * an option whose default is the weaker transport or login posture refuses a `null`; and options
 * that are not an object are refused with a message that says so.
 * @layer infrastructure
 */

import { baseOptions } from './__tests__/smtp-email-provider.fixtures'
import { SmtpEmailProvider } from './smtp-email.provider'
import type {
  SmtpCredentials,
  SmtpEmailProviderOptions,
  SmtpPoolOptions,
  SmtpTlsOptions
} from './smtp-email.types'

const mockSendMail = jest.fn()
const mockCreateTransport = jest.fn()

jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})

/** The transport config handed to `createTransport` on the most recent init. */
function lastTransportConfig(): Record<string, unknown> {
  return mockCreateTransport.mock.calls.at(-1)?.[0] as Record<string, unknown>
}

/** Sends once so the transport is built from the options the provider kept. */
async function transportOf(options: SmtpEmailProviderOptions): Promise<Record<string, unknown>> {
  await new SmtpEmailProvider(options).send(baseOptions)
  return lastTransportConfig()
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail, close: jest.fn() }))
  mockSendMail.mockResolvedValue({ messageId: '<abc@relay>' })
})

describe('SmtpEmailProvider options that are objects', () => {
  // The literals must list every key (the compiler refuses a missing one), so adding an option to
  // the type forces this case to change, and it fails until the provider keeps the new key.
  it('should keep every key of credentials, tls and pool', async () => {
    const credentials = { user: 'u', pass: 'p' } satisfies Required<SmtpCredentials>
    const checkServerIdentity = (): undefined => undefined
    const cert = Buffer.from('cert')
    const key = [Buffer.from('key')]
    const tls = {
      rejectUnauthorized: false,
      servername: 'relay.example',
      ca: ['ca'],
      minVersion: 'TLSv1.3',
      maxVersion: 'TLSv1.3',
      ciphers: 'TLS_AES_256_GCM_SHA384',
      checkServerIdentity,
      cert,
      key,
      passphrase: 'phrase',
      pfx: Buffer.from('pfx')
    } satisfies Required<SmtpTlsOptions>
    const pool = { maxConnections: 2, maxMessages: 5 } satisfies Required<SmtpPoolOptions>

    const transport = await transportOf({ host: 'relay.example', credentials, tls, pool })

    expect(transport).toMatchObject({
      auth: { user: 'u', pass: 'p' },
      tls: {
        rejectUnauthorized: false,
        servername: 'relay.example',
        ca: ['ca'],
        minVersion: 'TLSv1.3',
        maxVersion: 'TLSv1.3',
        ciphers: 'TLS_AES_256_GCM_SHA384',
        passphrase: 'phrase'
      },
      maxConnections: 2,
      maxMessages: 5
    })
  })

  // A setting the host asked for must reach the connection or fail the build: hardening that is
  // dropped without a word downgrades the session. The host's own objects stay by reference.
  it('should hand a version bound, ciphers, a verifier and a client pair to the transport as given', async () => {
    const checkServerIdentity = (): undefined => undefined
    const cert = Buffer.from('cert')
    const key = Buffer.from('key')

    const transport = await transportOf({
      host: 'h',
      tls: { minVersion: 'TLSv1.3', ciphers: 'X', checkServerIdentity, cert, key }
    })

    const tls = transport.tls as Record<string, unknown>
    expect(tls.minVersion).toBe('TLSv1.3')
    expect(tls.ciphers).toBe('X')
    expect(tls.checkServerIdentity).toBe(checkServerIdentity)
    expect(tls.cert).toBe(cert)
    expect(tls.key).toBe(key)
  })

  it('should hand a passphrase and a pfx to the transport as given', async () => {
    const pfx = Buffer.from('pfx')

    const tls = (await transportOf({ host: 'h', tls: { passphrase: 'phrase', pfx } })).tls

    expect(tls).toMatchObject({ passphrase: 'phrase' })
    expect((tls as { pfx: unknown }).pfx).toBe(pfx)
  })

  // The refusal names the key and never a value: a passphrase is a secret.
  it('should not print a value of tls when it refuses a key', () => {
    const attempt = (): unknown =>
      new SmtpEmailProvider({
        host: 'h',
        tls: { passphrase: 'SECRET-PHRASE', zzExtra: 'SECRET-VALUE' } as never
      })

    expect(attempt).toThrow('SmtpEmailProvider: tls.zzExtra is not a supported option')
    expect(attempt).not.toThrow(/SECRET/)
  })

  it('should refuse an unsupported key that is not enumerable', () => {
    const tls = { minVersion: 'TLSv1.3' }
    Object.defineProperty(tls, 'secureProtocol', { value: 'TLSv1_2_method', enumerable: false })

    expect(() => new SmtpEmailProvider({ host: 'h', tls: tls as never })).toThrow(
      'SmtpEmailProvider: tls.secureProtocol is not a supported option'
    )
  })

  it('should refuse a symbol key without printing its description', () => {
    const tls = { [Symbol('SECRET-DESCRIPTION')]: 1 }

    const attempt = (): unknown => new SmtpEmailProvider({ host: 'h', tls: tls as never })

    expect(attempt).toThrow(
      'SmtpEmailProvider: tls has a symbol key, which is not a supported option'
    )
    expect(attempt).not.toThrow(/SECRET/)
  })

  it.each([
    ['an own key', { zzExtra: 1 }, 'zzExtra'],
    ['a key with an undefined value', { crl: undefined }, 'crl'],
    ['a key with a null value', { secureProtocol: null }, 'secureProtocol'],
    ['a misspelled known key', { minversion: 'TLSv1.3' }, 'minversion']
  ])('should refuse %s of tls naming it', (_label, tls, name) => {
    expect(() => new SmtpEmailProvider({ host: 'h', tls: tls as never })).toThrow(
      `SmtpEmailProvider: tls.${name} is not a supported option`
    )
  })

  // A tls that is not an object has no keys to refuse; it goes to the transport as it always did.
  it.each(['x', 5, true, []])('should leave a tls of %p to the transport', async (value) => {
    const transport = await transportOf({ host: 'h', tls: value as never })

    expect(transport.tls).toEqual(value)
  })

  it('should refuse a key a class supplies from its prototype and the provider does not forward', () => {
    class Tls {
      get minVersion(): string {
        return 'TLSv1.3'
      }
      get secureOptions(): number {
        return 1
      }
    }

    expect(() => new SmtpEmailProvider({ host: 'h', tls: new Tls() as never })).toThrow(
      'SmtpEmailProvider: tls.secureOptions is not a supported option'
    )
  })

  it('should read each credential and each tls key once, when it is built', async () => {
    const reads = { user: 0, pass: 0, servername: 0 }
    const credentials = {
      get user(): string {
        reads.user += 1
        return reads.user === 1 ? 'first' : 'second'
      },
      get pass(): string {
        reads.pass += 1
        return 'secret'
      }
    }
    const tls = {
      get servername(): string {
        reads.servername += 1
        return reads.servername === 1 ? 'one.example' : 'two.example'
      }
    }
    const provider = new SmtpEmailProvider({ host: 'h', credentials, tls })

    await provider.send(baseOptions)
    await provider.send(baseOptions)

    expect(lastTransportConfig()).toMatchObject({
      auth: { user: 'first', pass: 'secret' },
      tls: { servername: 'one.example' }
    })
    expect(reads).toEqual({ user: 1, pass: 1, servername: 1 })
  })

  it('should read the credentials and tls of a class from its prototype', async () => {
    class Credentials {
      get user(): string {
        return 'u'
      }
      get pass(): string {
        return 'p'
      }
    }
    class Tls {
      get servername(): string {
        return 'relay.example'
      }
    }

    const transport = await transportOf({
      host: 'h',
      credentials: new Credentials(),
      tls: new Tls()
    })

    expect(transport).toMatchObject({
      auth: { user: 'u', pass: 'p' },
      tls: { servername: 'relay.example' }
    })
  })

  it('should leave out an unset key of tls and of the pool, and keep the other keys', async () => {
    const transport = await transportOf({
      host: 'h',
      tls: { rejectUnauthorized: null, servername: 'x' } as never,
      pool: { maxConnections: undefined, maxMessages: 4 } as never
    })

    expect(transport.tls).toEqual({ servername: 'x' })
    expect(transport).toMatchObject({ pool: true, maxMessages: 4 })
    expect(transport).not.toHaveProperty('maxConnections')
  })

  it.each(['secure', 'requireTls', 'credentials'])('should refuse a null %s', (key) => {
    expect(() => new SmtpEmailProvider({ host: 'h', [key]: null } as never)).toThrow(
      `SmtpEmailProvider: ${key} must not be null`
    )
  })

  it.each(['secure', 'requireTls', 'credentials'])(
    'should treat an undefined %s as omitted',
    (key) => {
      expect(() => new SmtpEmailProvider({ host: 'h', [key]: undefined } as never)).not.toThrow()
    }
  )

  it.each([null, 'x', 5, true, []])('should refuse %p as the options', (value) => {
    expect(() => new SmtpEmailProvider(value as never)).toThrow(
      'SmtpEmailProvider: options must be an object'
    )
  })

  it('should accept a class instance as the options', () => {
    class Options {
      get host(): string {
        return 'relay.example'
      }
    }

    expect(new SmtpEmailProvider(new Options()).isConfigured()).toBe(true)
  })
})
