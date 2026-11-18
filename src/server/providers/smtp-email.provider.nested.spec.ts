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

/** A copy of `items` with a hole, an index that has no value, inserted at `index`. */
function withHole(items: unknown[], index: number): unknown[] {
  const holey = new Array<unknown>(items.length + 1)
  items.forEach((item, position) => {
    holey[position < index ? position : position + 1] = item
  })
  return holey
}

// Node takes the object form of a key or a bundle only inside an array, so a bare object is refused
// here and not at the first send.
const KEY_WORDS =
  'a string, a Buffer or an array of strings, Buffers and { pem, passphrase } objects'
const PFX_WORDS =
  'a string, a Buffer or an array of strings, Buffers and { buf, passphrase } objects'

describe('SmtpEmailProvider options that are objects', () => {
  // The literals must list every key (the compiler refuses a missing one), so adding an option to
  // the type forces this case to change, and it fails until the provider keeps the new key.
  it('should keep every key of credentials, tls and pool', async () => {
    const credentials = { user: 'u', pass: 'p' } satisfies Required<SmtpCredentials>
    const checkServerIdentity = (): undefined => undefined
    const cert = Buffer.from('cert')
    const key = [Buffer.from('key')]
    const pfx = Buffer.from('pfx')
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
      pfx
    } satisfies Required<SmtpTlsOptions>
    const pool = { maxConnections: 2, maxMessages: 5 } satisfies Required<SmtpPoolOptions>

    const transport = await transportOf({ host: 'relay.example', credentials, tls, pool })

    // The whole tls object: every key is there, and the Buffers, the function and the entries of an array are the
    // host's own, not copies of them.
    const forwarded = transport.tls as Record<string, unknown>
    expect(forwarded).toEqual(tls)
    expect(Object.keys(forwarded).sort()).toEqual(Object.keys(tls).sort())
    expect(forwarded.checkServerIdentity).toBe(checkServerIdentity)
    expect(forwarded.cert).toBe(cert)
    expect(forwarded.key).toEqual(key)
    expect((forwarded.key as Buffer[])[0]).toBe(key[0])
    expect(forwarded.pfx).toBe(pfx)
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

  // Node takes a key or a pfx that carries its own passphrase as an object inside an array. The
  // entries are read once and the transport gets the copy, so what was checked is what is used.
  it('should hand a key and a pfx that carry their own passphrase to the transport', async () => {
    const material = Buffer.from('pfx')
    const key = [{ pem: 'pem', passphrase: 'key-phrase' }, 'plain']
    const pfx = [{ buf: material, passphrase: 'pfx-phrase' }]

    const tls = (await transportOf({ host: 'h', tls: { key, pfx } })).tls as Record<string, unknown>

    expect(tls.key).toEqual(key)
    expect(tls.pfx).toEqual(pfx)
    expect((tls.pfx as Array<{ buf: unknown }>)[0]?.buf).toBe(material)
  })

  // The forms of a key and of a bundle, one case each: an array is read through every index, so a
  // hole counts as a missing entry, an entry keeps only what Node reads from it, and an array that
  // holds something that is not material, a nested array least of all, is refused.
  it.each([
    ['a sparse key array', withHole(['pem'], 0)],
    ['a sparse pfx array', withHole([Buffer.from('a'), 'b'], 1)],
    ['a nested array in key', [['pem']]],
    ['a null entry in key', [null]],
    ['a function entry in pfx', [() => 'x']]
  ])('should refuse %s', (label, value) => {
    const name = label.includes('pfx') ? 'pfx' : 'key'

    expect(() => new SmtpEmailProvider({ host: 'h', tls: { [name]: value } as never })).toThrow(
      `SmtpEmailProvider: tls.${name} must be`
    )
  })

  it.each([
    ['an empty string', 'ca', ''],
    ['an empty array', 'cert', []],
    ['a DataView', 'key', new DataView(new ArrayBuffer(1))],
    ['a Float32Array', 'pfx', new Float32Array(1)],
    ['an array of typed arrays', 'ca', [new Uint8Array(1), Buffer.from('x')]]
  ])('should accept %s for tls.%s', (_label, name, value) => {
    expect(
      () => new SmtpEmailProvider({ host: 'h', tls: { [name]: value } as never })
    ).not.toThrow()
  })

  it.each(['ca', 'cert'])(
    'should refuse an object entry in tls.%s, which Node does not take',
    (name) => {
      expect(
        () => new SmtpEmailProvider({ host: 'h', tls: { [name]: [{ pem: 'x' }] } as never })
      ).toThrow(`SmtpEmailProvider: tls.${name} must be a string, a Buffer or an array of them`)
    }
  )

  it('should keep only what Node reads from a key entry and from a pfx entry', async () => {
    const tls = (
      await transportOf({
        host: 'h',
        tls: {
          key: [{ pem: 'k', passphrase: 'p', extra: 1 }],
          pfx: [{ buf: 'b', extra: 2 }]
        } as never
      })
    ).tls as Record<string, unknown>

    expect(tls.key).toEqual([{ pem: 'k', passphrase: 'p' }])
    expect(tls.pfx).toEqual([{ buf: 'b' }])
  })

  it('should read each entry once and hand the transport a copy of it', async () => {
    const reads = { pem: 0, passphrase: 0 }
    const entry = {
      get pem(): string {
        reads.pem += 1
        return reads.pem === 1 ? 'first' : 'second'
      },
      get passphrase(): string {
        reads.passphrase += 1
        return reads.passphrase === 1 ? 'first-phrase' : 'second-phrase'
      }
    }

    const tls = (await transportOf({ host: 'h', tls: { key: [entry] } as never })).tls as {
      key: Array<{ pem: string; passphrase: string }>
    }

    expect(tls.key).toEqual([{ pem: 'first', passphrase: 'first-phrase' }])
    expect(tls.key[0]).not.toBe(entry)
    expect(reads).toEqual({ pem: 1, passphrase: 1 })
  })

  it('should not print the passphrase of an entry it refuses', () => {
    const attempt = (): unknown =>
      new SmtpEmailProvider({
        host: 'h',
        tls: { key: [{ pem: 5, passphrase: 'SECRET-ENTRY' }] } as never
      })

    expect(attempt).toThrow(`SmtpEmailProvider: tls.key must be ${KEY_WORDS}`)
    expect(attempt).not.toThrow(/SECRET/)
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

  // The value of a forwarded key is checked when the provider is built, so the transport's own
  // error, which can carry a value, never has to be the one that reports a wrong type. The message
  // names the key and the type it needs, and never prints what was given.
  it.each([
    ['rejectUnauthorized', 'yes', 'a boolean'],
    ['rejectUnauthorized', 1, 'a boolean'],
    ['servername', 5, 'a string'],
    ['ciphers', ['A'], 'a string'],
    ['passphrase', 12345, 'a string'],
    ['passphrase', { toString: () => 'SECRET-PHRASE' }, 'a string'],
    ['minVersion', 'TLSv1.4', 'one of TLSv1, TLSv1.1, TLSv1.2 or TLSv1.3'],
    ['maxVersion', 12, 'one of TLSv1, TLSv1.1, TLSv1.2 or TLSv1.3'],
    ['ca', 5, 'a string, a Buffer or an array of them'],
    ['cert', { pem: 'x' }, 'a string, a Buffer or an array of them'],
    ['key', [5], KEY_WORDS],
    ['key', { pem: 'k' }, KEY_WORDS],
    ['key', { pem: 'k', passphrase: 'bare' }, KEY_WORDS],
    ['key', [{ pem: 5 }], KEY_WORDS],
    ['key', [{ pem: 'k', passphrase: 5 }], KEY_WORDS],
    ['key', [{ passphrase: 'only' }], KEY_WORDS],
    ['pfx', true, PFX_WORDS],
    ['pfx', { buf: 'b' }, PFX_WORDS],
    ['pfx', [{ pem: 'k' }], PFX_WORDS],
    ['pfx', [{ buf: 'b', passphrase: [] }], PFX_WORDS],
    ['checkServerIdentity', 'always', 'a function']
  ])('should refuse tls.%s of %p naming the key and the type', (key, value, type) => {
    expect(() => new SmtpEmailProvider({ host: 'h', tls: { [key]: value } as never })).toThrow(
      `SmtpEmailProvider: tls.${key} must be ${type}`
    )
  })

  it('should never print the value it refuses', () => {
    const attempt = (): unknown =>
      new SmtpEmailProvider({ host: 'h', tls: { passphrase: ['SECRET-PHRASE'] } as never })

    expect(attempt).toThrow('SmtpEmailProvider: tls.passphrase must be a string')
    expect(attempt).not.toThrow(/SECRET/)
  })

  it.each([
    ['rejectUnauthorized', false],
    ['servername', 'relay.example'],
    ['ciphers', 'TLS_AES_256_GCM_SHA384'],
    ['passphrase', 'phrase'],
    ['minVersion', 'TLSv1'],
    ['maxVersion', 'TLSv1.3'],
    ['ca', 'pem'],
    ['ca', Buffer.from('pem')],
    ['ca', ['pem', Buffer.from('pem')]],
    ['cert', new Uint8Array([1])],
    ['key', ['pem']],
    ['key', [{ pem: Buffer.from('pem'), passphrase: 'phrase' }]],
    ['key', ['pem', { pem: 'pem', passphrase: 'phrase' }]],
    ['pfx', Buffer.from('pfx')],
    ['pfx', [{ buf: Buffer.from('pfx'), passphrase: 'phrase' }]],
    ['pfx', [Buffer.from('a'), { buf: 'b' }]],
    ['checkServerIdentity', () => undefined]
  ])('should accept tls.%s of %p', (key, value) => {
    expect(() => new SmtpEmailProvider({ host: 'h', tls: { [key]: value } as never })).not.toThrow()
  })

  it('should read a value once, so the one that was checked is the one that is kept', async () => {
    let reads = 0
    const tls = {
      get minVersion(): string {
        reads += 1
        return reads === 1 ? 'TLSv1.3' : 'not-a-version'
      }
    }

    const transport = await transportOf({ host: 'h', tls: tls as never })

    expect((transport.tls as { minVersion: string }).minVersion).toBe('TLSv1.3')
    expect(reads).toBe(1)
  })

  // A tls that is not an object has no keys to refuse; it is passed through to the transport.
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

describe('SmtpEmailProvider: the TLS version bounds and the passphrases it redacts', () => {
  it.each(['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3'])(
    'should accept %s as a minVersion and as a maxVersion',
    async (version) => {
      const config = await transportOf({
        host: 'relay.example',
        tls: { minVersion: version, maxVersion: version } as SmtpTlsOptions
      } as SmtpEmailProviderOptions)

      expect(config.tls).toMatchObject({ minVersion: version, maxVersion: version })
    }
  )

  // A null `tls` is an unset one: the transport gets none, and nothing reads entries from null.
  it('should build the provider with a null tls and give the transport none', async () => {
    const config = await transportOf({
      host: 'relay.example',
      tls: null
    } as unknown as SmtpEmailProviderOptions)

    expect(config.tls).toBeUndefined()
  })

  // The passphrases are read through the private method that feeds the redaction, so the exact list
  // is asserted: a value that is not a string must never reach the text search, which would look
  // for the word "undefined" in a message.
  describe('the passphrases collected for redaction', () => {
    const passphrasesOf = (tls: unknown): string[] =>
      (
        new SmtpEmailProvider({
          ...baseOptions,
          tls
        } as unknown as SmtpEmailProviderOptions) as unknown as {
          tlsPassphrases(): string[]
        }
      ).tlsPassphrases()

    it('should be empty when no tls is configured', () => {
      expect(
        (
          new SmtpEmailProvider({ host: 'relay.example' }) as unknown as {
            tlsPassphrases(): string[]
          }
        ).tlsPassphrases()
      ).toEqual([])
    })

    it('should list the tls passphrase and those of the key and pfx entries, as given', () => {
      expect(
        passphrasesOf({
          passphrase: 'p0',
          key: [{ pem: 'k1', passphrase: 'p1' }, { pem: 'k2' }, 'plain'],
          pfx: [{ buf: 'b1', passphrase: 'p2' }, { buf: 'b2' }]
        })
      ).toEqual(['p0', 'p1', 'p2'])
    })

    it('should list nothing for entries and a tls that carry no passphrase', () => {
      expect(passphrasesOf({ key: [{ pem: 'k' }], pfx: [{ buf: 'b' }] })).toEqual([])
    })
  })
})
