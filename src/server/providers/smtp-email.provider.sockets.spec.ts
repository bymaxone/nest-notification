/**
 * @fileoverview Holds the SMTP adapter's own connection and its refusal to let Nodemailer open a
 * file or a URL to what the REAL Nodemailer does over REAL sockets: a key planted on the realm root
 * after `sendMail` was called (`path`, `href`, `localAddress`) neither attaches a file nor moves the
 * connection, and a normal send, an implicit-TLS send and a STARTTLS send still work.
 * @layer infrastructure
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Logger } from '@nestjs/common'
import * as nodemailer from 'nodemailer'

import { makeCertificate, startRelay } from './__tests__/smtp-relay.fixture'
import type { Relay, TestCertificate } from './__tests__/smtp-relay.fixture'
import { SmtpEmailProvider } from './smtp-email.provider'

// `mock`-prefixed names are allowed inside the hoisted jest.mock factory.
const mockGuard = { enabled: true }
jest.mock('../utils/realm-root', () => {
  const actual = jest.requireActual<typeof import('../utils/realm-root')>('../utils/realm-root')
  return {
    ...actual,
    assertStandardRealmRoot: (owner: string) => {
      if (mockGuard.enabled) {
        actual.assertStandardRealmRoot(owner)
      }
    }
  }
})

const MESSAGE = {
  to: 'real@acme.com',
  from: 'noreply@acme.com',
  subject: 'Your code',
  html: '<p>123456</p>',
  attachments: [{ filename: 'a.txt', content: 'aGVsbG8=' }]
} as const

const SECRET = 'TOP-SECRET-FILE-CONTENT'
let directory: string
let secretFile: string
let certificate: TestCertificate
let relay: Relay | undefined
let planted: string[] = []
const timers: NodeJS.Timeout[] = []
const LATER_TICK_MS = 3

function plant(name: string, value: unknown): void {
  // As plain assignment does it: enumerable, so a merge that walks `for (key in source)` sees it.
  Object.defineProperty(Object.prototype, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: true
  })
  planted.push(name)
}

/**
 * Makes the real transport plant `entries` as a later request would: `when` is `before` the real
 * `sendMail` runs (after the adapter's own checks) or right `after` it was called.
 */
function plantAround(entries: Record<string, unknown>, when: 'before' | 'after'): void {
  const real = nodemailer.createTransport.bind(nodemailer)
  jest.spyOn(nodemailer, 'createTransport').mockImplementation(((config: object) => {
    const transport = real(config)
    const sendMail = transport.sendMail.bind(transport)
    transport.sendMail = ((...args: Parameters<typeof sendMail>) => {
      const plantAll = (): void => {
        for (const [name, value] of Object.entries(entries)) {
          plant(name, value)
        }
      }
      if (when === 'before') {
        plantAll()
      }
      const sending = sendMail(...args)
      if (when === 'after') {
        // A later tick, as a concurrent request would be: Nodemailer reads `path` and `href` while it streams.
        timers.push(setTimeout(plantAll, LATER_TICK_MS))
      }
      return sending
    }) as typeof transport.sendMail
    return transport
  }) as never)
}

beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'sockets-spec-'))
  secretFile = join(directory, 'secret.txt')
  writeFileSync(secretFile, SECRET)
  certificate = makeCertificate()
})

afterAll(() => rmSync(directory, { recursive: true, force: true }))

beforeEach(() => {
  mockGuard.enabled = true
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
})

afterEach(async () => {
  timers.splice(0).forEach(clearTimeout)
  for (const name of planted) {
    Reflect.deleteProperty(Object.prototype, name)
  }
  planted = []
  jest.restoreAllMocks()
  await relay?.close()
  relay = undefined
})

describe('a path or a URL that shows up on the realm root after sendMail was called', () => {
  it.each(['path', 'href'])(
    'should not read a file or a URL for a planted %s, with the guard off',
    async (name) => {
      mockGuard.enabled = false
      relay = await startRelay()
      plantAround({ [name]: secretFile }, 'after')

      await new SmtpEmailProvider({ host: '127.0.0.1', port: relay.port })
        .send(MESSAGE)
        .catch(() => undefined)

      // The send may be refused (`disableFileAccess`, `disableUrlAccess`) or finish before the key
      // lands; either way what the relay received holds nothing of the file.
      expect(relay.messages.join('')).not.toContain(SECRET)
    }
  )

  it('should refuse the connection, not open it, when a key is planted before the socket is opened', async () => {
    relay = await startRelay()
    plantAround({ localAddress: '203.0.113.9' }, 'before')

    await expect(
      new SmtpEmailProvider({ host: '127.0.0.1', port: relay.port }).send(MESSAGE)
    ).rejects.toMatchObject({ code: 'notification.invalid_scope_identifier' })

    expect(relay.commands).toStrictEqual([])
  })

  it('should connect to the host and port asked, whatever localAddress, localPort, onread and timeout are planted', async () => {
    mockGuard.enabled = false
    relay = await startRelay()
    plantAround({ localAddress: '203.0.113.9', localPort: 9, onread: 1, timeout: 1 }, 'before')

    await new SmtpEmailProvider({ host: '127.0.0.1', port: relay.port }).send(MESSAGE)

    expect(relay.messages).toHaveLength(1)
    expect(relay.messages.join('')).not.toContain(SECRET)
  })
})

describe('the connection the adapter opens itself', () => {
  it('should deliver a message over a plain connection', async () => {
    relay = await startRelay()

    await new SmtpEmailProvider({ host: '127.0.0.1', port: relay.port }).send(MESSAGE)

    expect(relay.commands).toEqual(expect.arrayContaining(['EHLO', 'MAIL', 'RCPT', 'DATA']))
    expect(relay.messages.join('')).toContain('Your code')
  })

  it('should deliver a message over implicit TLS, checking the certificate it is given', async () => {
    relay = await startRelay({ certificate, implicitTls: true })

    await new SmtpEmailProvider({
      host: '127.0.0.1',
      port: relay.port,
      secure: true,
      tls: { ca: certificate.cert }
    }).send(MESSAGE)

    expect(relay.messages).toHaveLength(1)
  })

  it('should send the hostname as the SNI name over implicit TLS when the caller sets none', async () => {
    relay = await startRelay({ certificate, implicitTls: true })

    await new SmtpEmailProvider({
      host: 'localhost',
      port: relay.port,
      secure: true,
      tls: { ca: certificate.cert }
    }).send(MESSAGE)

    expect(relay.servernames).toStrictEqual(['localhost'])
  })

  it('should send the name the caller set, not the host, as the SNI name, though the host is an address', async () => {
    relay = await startRelay({ certificate, implicitTls: true })

    await new SmtpEmailProvider({
      host: '127.0.0.1',
      port: relay.port,
      secure: true,
      tls: { ca: certificate.cert, servername: 'localhost' }
    }).send(MESSAGE)

    expect(relay.servernames).toStrictEqual(['localhost'])
  })

  it('should send no SNI name when the host is an address', async () => {
    relay = await startRelay({ certificate, implicitTls: true })

    await new SmtpEmailProvider({
      host: '127.0.0.1',
      port: relay.port,
      secure: true,
      tls: { ca: certificate.cert }
    }).send(MESSAGE)

    expect(relay.servernames).toStrictEqual([])
  })

  it('should refuse a certificate it does not trust over implicit TLS', async () => {
    relay = await startRelay({ certificate, implicitTls: true })

    const failure = await new SmtpEmailProvider({
      host: '127.0.0.1',
      port: relay.port,
      secure: true
    })
      .send(MESSAGE)
      .catch((error: Error) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(relay.messages).toHaveLength(0)
  })

  it('should deliver a message after STARTTLS', async () => {
    relay = await startRelay({ certificate })

    await new SmtpEmailProvider({
      host: '127.0.0.1',
      port: relay.port,
      requireTls: true,
      tls: { ca: certificate.cert }
    }).send(MESSAGE)

    expect(relay.commands).toContain('STARTTLS')
    expect(relay.messages).toHaveLength(1)
  })

  it('should send the hostname as the SNI name after STARTTLS when the caller sets none', async () => {
    relay = await startRelay({ certificate })

    await new SmtpEmailProvider({
      host: 'localhost',
      port: relay.port,
      requireTls: true,
      tls: { ca: certificate.cert }
    }).send(MESSAGE)

    expect(relay.servernames).toStrictEqual(['localhost'])
  })

  it('should leave keepalive and no-delay set on the connection when Nodemailer upgrades it', async () => {
    relay = await startRelay({ certificate })
    const keepAlive = jest.spyOn(net.Socket.prototype, 'setKeepAlive')
    const noDelay = jest.spyOn(net.Socket.prototype, 'setNoDelay')

    await new SmtpEmailProvider({
      host: '127.0.0.1',
      port: relay.port,
      requireTls: true,
      tls: { ca: certificate.cert }
    }).send(MESSAGE)

    expect(keepAlive).toHaveBeenCalledWith(true, expect.any(Number))
    expect(noDelay).toHaveBeenCalledWith(true)
  })

  it('should refuse a certificate it does not trust after STARTTLS, and send nothing', async () => {
    relay = await startRelay({ certificate })

    const failure = await new SmtpEmailProvider({
      host: '127.0.0.1',
      port: relay.port,
      requireTls: true
    })
      .send(MESSAGE)
      .catch((error: Error) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(relay.commands).not.toContain('MAIL')
    expect(relay.messages).toHaveLength(0)
  })

  it('should refuse a relay that does not offer STARTTLS when it is required, and send nothing', async () => {
    relay = await startRelay()

    const failure = await new SmtpEmailProvider({
      host: '127.0.0.1',
      port: relay.port,
      requireTls: true
    })
      .send(MESSAGE)
      .catch((error: Error) => error)

    expect(failure).toBeInstanceOf(Error)
    expect(relay.commands).not.toContain('MAIL')
    expect(relay.messages).toHaveLength(0)
  })

  it('should put on the wire after STARTTLS what Nodemailer puts there when it opens the connection itself', async () => {
    const strip = (seen: Relay): string =>
      JSON.stringify([
        seen.commands,
        seen.envelope,
        seen.messages.map((message) =>
          message
            .replace(/Message-ID: <[^>]*>/gu, '')
            .replace(/Date: .*\r\n/gu, '')
            .replace(/_NmP-[\w-]+/gu, 'B')
            .replace(/--[\w-]+/gu, '--B')
        )
      ])
    const full = { ...MESSAGE, cc: 'copy@acme.com', bcc: ['hidden@acme.com'], text: 'plain text' }
    const ours = await startRelay({ certificate })
    await new SmtpEmailProvider({
      host: '127.0.0.1',
      port: ours.port,
      requireTls: true,
      tls: { ca: certificate.cert }
    }).send(full)
    const direct = await startRelay({ certificate })
    await nodemailer
      .createTransport({
        host: '127.0.0.1',
        port: direct.port,
        requireTLS: true,
        tls: { ca: certificate.cert }
      })
      .sendMail({
        from: { name: '', address: full.from },
        to: full.to,
        cc: full.cc,
        bcc: full.bcc,
        subject: full.subject,
        html: full.html,
        text: full.text,
        attachments: [{ filename: 'a.txt', content: 'aGVsbG8=', encoding: 'base64' }],
        disableFileAccess: true,
        disableUrlAccess: true
      })

    expect(strip(ours)).toBe(strip(direct))
    await ours.close()
    await direct.close()
  })

  it('should report a connection that nothing answers as the connection failing', async () => {
    const closed = await startRelay()
    const port = closed.port
    await closed.close()

    const failure = await new SmtpEmailProvider({ host: '127.0.0.1', port })
      .send(MESSAGE)
      .catch((error: Error) => error)

    expect(failure).toBeInstanceOf(Error)
  })

  it('should give up on an implicit-TLS connection that never completes its handshake', async () => {
    const silent = net.createServer((socket) => {
      // Reads and never answers, so the client's close is seen and the server can shut down.
      socket.resume()
    })
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve))
    const { port } = silent.address() as net.AddressInfo

    const failure = await new SmtpEmailProvider({
      host: '127.0.0.1',
      port,
      secure: true,
      connectionTimeout: 50
    })
      .send(MESSAGE)
      .catch((error: Error) => error)
    await new Promise((resolve) => silent.close(resolve))

    expect(failure).toBeInstanceOf(Error)
    expect(String((failure as { code?: string }).code ?? failure)).toMatch(
      /ETIMEDOUT|timed out|timeout/iu
    )
  })
})

/**
 * The `Object.prototype` of the realm Node's own modules run in. A test runs in a sandbox of its own,
 * where `Object.prototype` is another object, so a key planted there never reaches Node's emitter;
 * the prototype of `EventEmitter` belongs to Node, and its parent is the root Node's code sees.
 */
const NODE_ROOT = Object.getPrototypeOf(
  (
    jest.requireActual<typeof import('node:events')>('node:events').EventEmitter as {
      prototype: object
    }
  ).prototype
) as object
const plantedOnNodeRoot: string[] = []

function plantOnNodeRoot(name: string, value: unknown): void {
  Object.defineProperty(NODE_ROOT, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: true
  })
  plantedOnNodeRoot.push(name)
}

afterEach(() => {
  for (const name of plantedOnNodeRoot.splice(0)) {
    Reflect.deleteProperty(NODE_ROOT, name)
  }
})

describe('an event Node emits on the socket, with a string planted under its name on a later tick', () => {
  // Not `pause` or `resume`: Nodemailer's own streams emit those, and they are not the adapter's to seal.
  const EVENTS = [
    'lookup',
    'connectionAttempt',
    'connectionAttemptFailed',
    'connectionAttemptTimeout',
    'ready',
    'drain',
    'timeout',
    'keylog',
    'session',
    'OCSPResponse',
    'anArbitraryName'
  ]

  /** Plants `name` the moment the real connection has been started, as a later request would. */
  function plantOnceConnecting(
    name: string,
    target: { connect: (...args: never[]) => unknown },
    method: 'connect'
  ): void {
    const original = target[method]
    jest.spyOn(target, method).mockImplementation(function (this: unknown, ...args: never[]) {
      const started = original.apply(this, args)
      plantOnNodeRoot(name, 'x')
      return started
    } as never)
  }

  it.each(EVENTS)(
    'should deliver over a plain connection to a hostname, whatever %s is planted',
    async (name) => {
      relay = await startRelay()
      plantOnceConnecting(name, net.Socket.prototype as never, 'connect')

      await new SmtpEmailProvider({ host: 'localhost', port: relay.port }).send(MESSAGE)

      expect(relay.messages).toHaveLength(1)
    }
  )

  it.each(EVENTS)(
    'should deliver over implicit TLS to a hostname, whatever %s is planted',
    async (name) => {
      relay = await startRelay({ certificate, implicitTls: true })
      plantOnceConnecting(
        name,
        jest.requireActual<typeof import('node:tls')>('node:tls') as never,
        'connect'
      )

      await new SmtpEmailProvider({
        host: 'localhost',
        port: relay.port,
        secure: true,
        tls: { ca: certificate.cert }
      }).send(MESSAGE)

      expect(relay.messages).toHaveLength(1)
    }
  )
})

describe('a key planted after the checks of a send began and before its first byte', () => {
  it.each([
    ['address', 'evil@attacker.test'],
    ['raw', 'From: evil@attacker.test\r\n\r\nplanted'],
    ['boundary', 'planted-boundary'],
    ['filename', 'planted.txt'],
    ['content', 'planted content']
  ])(
    'should destroy the plain connection and refuse the send when %s is planted',
    async (name, value) => {
      relay = await startRelay({ onConnect: () => plant(name, value) })

      await expect(
        new SmtpEmailProvider({ host: '127.0.0.1', port: relay.port }).send(MESSAGE)
      ).rejects.toMatchObject({ code: 'notification.invalid_scope_identifier' })

      expect(relay.commands).toStrictEqual([])
      expect(relay.messages).toHaveLength(0)
    }
  )

  it('should destroy an implicit-TLS connection and refuse the send when a key is planted', async () => {
    const certificate = makeCertificate()
    relay = await startRelay({
      certificate,
      implicitTls: true,
      onConnect: () => plant('address', 'evil@attacker.test')
    })

    await expect(
      new SmtpEmailProvider({
        host: '127.0.0.1',
        port: relay.port,
        secure: true,
        tls: { ca: certificate.cert }
      }).send(MESSAGE)
    ).rejects.toMatchObject({ code: 'notification.invalid_scope_identifier' })

    expect(relay.messages).toHaveLength(0)
  })

  it('should send as before when nothing is planted', async () => {
    relay = await startRelay({ onConnect: () => undefined })

    await new SmtpEmailProvider({ host: '127.0.0.1', port: relay.port }).send(MESSAGE)

    expect(relay.messages).toHaveLength(1)
  })
})

describe('a name planted once the STARTTLS session is up', () => {
  // With the check off, so what is measured is Nodemailer: no object the adapter hands it answers
  // for a name from the realm root. `address`, `content` and `filename` are not here, because
  // Nodemailer reads them off objects it builds itself and the message does change; they are held by
  // the check, in the next block. `encoding` fails the send before any byte.
  const NAMES = [
    'name',
    'group',
    'raw',
    'headers',
    'cid',
    'contentType',
    'contentDisposition',
    'contentTransferEncoding',
    'charset',
    'textEncoding'
  ]
  const WITH_ATTACHMENT = {
    ...MESSAGE,
    cc: 'copy@acme.com',
    bcc: ['hidden@acme.com'],
    replyTo: 'reply@acme.com',
    text: 'plain text'
  }

  /** What the relay saw, with what changes from one send to the next taken out. */
  const wire = (seen: Relay): string =>
    JSON.stringify([
      seen.commands,
      seen.envelope,
      seen.messages.map((message) =>
        message
          .replace(/Message-ID: <[^>]*>/gu, '')
          .replace(/Date: .*\r\n/gu, '')
          .replace(/_NmP-[\w-]+/gu, 'B')
          .replace(/--[\w-]+/gu, '--B')
      )
    ])

  async function send(name: string | undefined): Promise<string> {
    mockGuard.enabled = false
    const certificate = makeCertificate()
    const seen = await startRelay({
      certificate,
      onStarttls: () => {
        if (name !== undefined) {
          plant(name, 'PLANTED')
        }
      }
    })
    try {
      await new SmtpEmailProvider({
        host: '127.0.0.1',
        port: seen.port,
        requireTls: true,
        tls: { ca: certificate.cert }
      })
        .send(WITH_ATTACHMENT)
        .catch(() => undefined)
    } finally {
      await seen.close()
    }
    return wire(seen)
  }

  it.each(NAMES)('should send the same envelope and body when %s is planted', async (name) => {
    const clean = await send(undefined)

    const sent = await send(name)

    expect(sent).toBe(clean)
  })
})

describe('a name planted once the STARTTLS relay has agreed to upgrade, with the check live', () => {
  const NAMES = ['address', 'name', 'content', 'filename', 'group', 'raw', 'headers']

  async function sendPlanting(name: string): Promise<{ seen: Relay; failure: unknown }> {
    mockGuard.enabled = true
    const cert = makeCertificate()
    const seen = await startRelay({
      certificate: cert,
      onStarttls: () => plant(name, 'PLANTED')
    })
    let failure: unknown
    try {
      await new SmtpEmailProvider({
        host: '127.0.0.1',
        port: seen.port,
        requireTls: true,
        tls: { ca: cert.cert }
      }).send({ ...MESSAGE, cc: 'copy@acme.com', bcc: ['hidden@acme.com'], text: 'plain text' })
    } catch (error) {
      failure = error
    } finally {
      await seen.close()
    }
    return { seen, failure }
  }

  it.each(NAMES)(
    'should refuse the send before MAIL FROM, RCPT TO or the body when %s is planted',
    async (name) => {
      const { seen, failure } = await sendPlanting(name)

      expect(seen.commands).not.toContain('MAIL')
      expect(seen.commands).not.toContain('RCPT')
      expect(seen.commands).not.toContain('DATA')
      expect(seen.messages).toHaveLength(0)
      expect(failure).toBeDefined()
    }
  )
})
