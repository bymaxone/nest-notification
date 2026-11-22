/**
 * @fileoverview Holds what the SMTP adapter hands to the REAL Nodemailer to being immune to a key
 * planted on the realm root. Nodemailer copies the own keys of a message and of the transport options
 * into ordinary objects and then reads names this library never sets, so the adapter gives each of
 * them an own key. The rows run Nodemailer itself (a stream transport for the message, the real
 * transport options, a `tls.connect` that records its options) and assert on what it produced.
 * @layer infrastructure
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import * as net from 'node:net'
import { join } from 'node:path'
import * as realTls from 'node:tls'

import { Logger } from '@nestjs/common'
import * as nodemailer from 'nodemailer'

import {
  AUTH_KEYS,
  INTERNAL_KEYS,
  MESSAGE_KEYS,
  ownTlsKeys,
  TLS_KEYS,
  TRANSPORT_KEYS
} from './nodemailer-keys'
import { SmtpEmailProvider } from './smtp-email.provider'

// The own-key shadows are the second layer; they are tested with the realm-root check off. The check
// has its own spec (`realm-root.spec.ts`).
jest.mock('../utils/realm-root', () => ({ assertStandardRealmRoot: jest.fn() }))

const MESSAGE = {
  to: 'real@acme.com',
  from: 'noreply@acme.com',
  subject: 'Your code',
  html: '<p>123456</p>'
} as const

function plant(entries: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(entries)) {
    Object.defineProperty(Object.prototype, key, {
      value,
      configurable: true,
      writable: true,
      enumerable: true
    })
  }
}

let planted: string[] = []

function plantKeys(entries: Record<string, unknown>): void {
  planted = Object.keys(entries)
  plant(entries)
}

afterEach(() => {
  for (const key of planted) {
    Reflect.deleteProperty(Object.prototype, key)
  }
  planted = []
  jest.restoreAllMocks()
})

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
})

/** What a stream transport answers: the envelope it was given and the message it built. */
interface Sent {
  envelope: { from: string; to: string[] }
  message: Buffer
}

/** Narrows what a stream transport answered, and fails the row when it is not a message. */
async function sentOf(pending: Promise<unknown>): Promise<Sent> {
  const info = await pending
  if (typeof info === 'object' && info !== null && Buffer.isBuffer(Reflect.get(info, 'message'))) {
    return info as Sent
  }
  throw new Error('the stream transport did not answer with a message')
}

/** The options a real transport keeps, as a copy; fails the row when it keeps none. */
function optionsOf(transport: unknown): Record<string, unknown> {
  const transporter: unknown =
    typeof transport === 'object' ? Reflect.get(transport ?? {}, 'transporter') : undefined
  const options: unknown =
    typeof transporter === 'object' ? Reflect.get(transporter ?? {}, 'options') : undefined
  if (typeof options !== 'object' || options === null) {
    throw new Error('the transport keeps no options')
  }
  return { ...options }
}

/** Makes the adapter's `createTransport` hand back a stream transport, and records the message. */
function streamTransport(): { info: () => Promise<Sent> } {
  const created = nodemailer.createTransport({ streamTransport: true, buffer: true })
  let last: unknown
  jest.spyOn(nodemailer, 'createTransport').mockImplementation(() => created as never)
  const send = created.sendMail.bind(created)
  jest.spyOn(created, 'sendMail').mockImplementation(((message: object) => {
    last = send(message)
    return last
  }) as never)
  return {
    info: () => sentOf(last as Promise<unknown>)
  }
}

describe('the message the SMTP adapter gives Nodemailer', () => {
  it('should send a message whose recipients and headers no planted key can change', async () => {
    const stream = streamTransport()
    plantKeys({
      envelope: { from: 'evil@evil.test', to: ['attacker@evil.test'] },
      sender: 'evil@evil.test',
      dsn: { notify: 'never' },
      alternatives: [{ content: 'planted alternative' }],
      list: { unsubscribe: 'http://evil.test' },
      icalEvent: { content: 'planted' },
      watchHtml: 'planted watch',
      amp: 'planted amp',
      bcc: 'attacker@evil.test',
      cc: 'attacker@evil.test',
      replyTo: 'attacker@evil.test',
      inReplyTo: '<planted@evil.test>',
      references: '<planted@evil.test>',
      priority: 'high',
      xMailer: 'planted-mailer'
    })

    await new SmtpEmailProvider({ host: '127.0.0.1' }).send(MESSAGE)

    const sent = await stream.info()
    const text = sent.message.toString('utf8')
    expect(sent.envelope.to).toStrictEqual(['real@acme.com'])
    expect(text).toContain('real@acme.com')
    expect(text).not.toMatch(/evil|planted|attacker/u)
  })

  it('should produce the message Nodemailer produces for the same plain input, attachments included', async () => {
    const attachments = [
      { filename: 'a.txt', content: 'eA==' },
      { filename: 'm.eml', content: 'Subject: x\r\n\r\nbody', contentType: 'message/rfc822' }
    ]
    const normalise = (message: Buffer): string =>
      message
        .toString('utf8')
        .replace(/^(Date|Message-ID):.*$/gmu, '')
        .replace(/_NmP-[0-9a-f]+/gu, '_NmP-X')
    const direct = await nodemailer
      .createTransport({ streamTransport: true, buffer: true })
      .sendMail({
        from: MESSAGE.from,
        to: MESSAGE.to,
        subject: MESSAGE.subject,
        html: MESSAGE.html,
        attachments: attachments.map((a) => ({
          ...a,
          encoding: typeof a.content === 'string' ? 'base64' : undefined
        }))
      })
    const stream = streamTransport()

    await new SmtpEmailProvider({ host: '127.0.0.1' }).send({ ...MESSAGE, attachments })

    const sent = await stream.info()
    expect(normalise(sent.message)).toBe(normalise((await sentOf(Promise.resolve(direct))).message))
  })
})

describe('the TLS options the SMTP adapter gives Nodemailer, with the real tls module', () => {
  /** A port nothing listens on. */
  async function closedPort(): Promise<number> {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as net.AddressInfo
    await new Promise((resolve) => server.close(resolve))
    return port
  }

  it('should give a real tls.connect options it accepts, over the ones Nodemailer sets itself', async () => {
    const own = ownTlsKeys(undefined as Record<string, unknown> | undefined) ?? {}
    const options = Object.assign(
      { host: '127.0.0.1', port: await closedPort(), timeout: 5000 },
      own
    )

    const socket = realTls.connect(options)
    const outcome = await new Promise<string>((resolve) => {
      socket.once('error', (error: NodeJS.ErrnoException) => resolve(String(error.code)))
    })

    expect(outcome).toBe('ECONNREFUSED')
    expect(options.host).toBe('127.0.0.1')
    expect(options.timeout).toBe(5000)
  })

  it('should reach the connection with implicit TLS and not stop on an argument Node refuses', async () => {
    const port = await closedPort()

    const failure = (await new SmtpEmailProvider({ host: '127.0.0.1', port, secure: true })
      .send(MESSAGE)
      .catch((error: unknown) => error)) as Error

    expect(failure.message).toContain('ECONNREFUSED')
    expect(failure.message).not.toMatch(/ERR_INVALID_ARG|must be of type/u)
  })

  it('should upgrade to TLS after STARTTLS without stopping on an argument Node refuses', async () => {
    const commands: string[] = []
    const server = net.createServer((socket) => {
      socket.write('220 relay ready\r\n')
      socket.on('data', (chunk) => {
        const line = chunk.toString('utf8').trim()
        commands.push(line.split(' ')[0] ?? '')
        if (/^EHLO/iu.test(line)) {
          socket.write('250-relay\r\n250 STARTTLS\r\n')
        } else if (/^STARTTLS/iu.test(line)) {
          socket.write('220 go ahead\r\n')
          setTimeout(() => socket.destroy(), 200)
        }
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as net.AddressInfo

    const failure = (await new SmtpEmailProvider({ host: '127.0.0.1', port, requireTls: true })
      .send(MESSAGE)
      .catch((error: unknown) => error)) as Error
    await new Promise((resolve) => server.close(resolve))

    expect(commands).toContain('STARTTLS')
    expect(failure.message).not.toMatch(/ERR_INVALID_ARG|must be of type|ERR_MISSING_ARGS/u)
  })
})

describe('names the real Nodemailer and Node read from their own instances and options', () => {
  const closed = async (): Promise<number> => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as net.AddressInfo
    await new Promise((resolve) => server.close(resolve))
    return port
  }
  const sendDirect = async (): Promise<string> => {
    const transport = nodemailer.createTransport({ host: '127.0.0.1', port: await closed() })
    return transport.sendMail({ from: MESSAGE.from, to: MESSAGE.to, subject: 's', html: 'x' }).then(
      () => 'sent',
      (error: Error) => error.message
    )
  }

  it('should run a planted getSocket, which can hand Nodemailer another connection', async () => {
    const called = jest.fn()
    plantKeys({
      getSocket: (_options: unknown, callback: (error: Error) => void) => {
        called()
        callback(new Error('planted socket'))
      }
    })

    const outcome = await sendDirect()

    expect(called).toHaveBeenCalled()
    expect(outcome).toContain('planted socket')
  })

  it.each([
    ['localAddress', 'PLANTED', /Invalid IP address/u],
    ['localPort', 'PLANTED', /localPort/u],
    ['autoSelectFamily', 'PLANTED', /autoSelectFamily/u]
  ])('should bind or configure the connection from a planted %s', async (key, value, expected) => {
    plantKeys({ [key]: value })

    expect(await sendDirect()).toMatch(expected)
  })
})

describe('the transport options the SMTP adapter gives Nodemailer', () => {
  it('should keep the host and port of the host, whatever service, proxy and socket are planted', async () => {
    let transporter: { transporter: { options: Record<string, unknown> } } | undefined
    const real = nodemailer.createTransport.bind(nodemailer)
    jest.spyOn(nodemailer, 'createTransport').mockImplementation(((config: object) => {
      transporter = real(config) as never
      return transporter
    }) as never)
    plantKeys({ service: 'gmail', proxy: 'http://evil.test:3128' })

    await new SmtpEmailProvider({ host: '127.0.0.1', port: 1 }).send(MESSAGE).catch(() => undefined)

    const options = transporter?.transporter.options
    expect(options?.host).toBe('127.0.0.1')
    expect(options?.port).toBe(1)
    expect(options?.service).toBeUndefined()
    expect(options?.proxy).toBeUndefined()
  })

  it('should build the transport Nodemailer builds for the same plain configuration', async () => {
    const options: Record<string, unknown>[] = []
    const real = nodemailer.createTransport.bind(nodemailer)
    jest.spyOn(nodemailer, 'createTransport').mockImplementation(((config: object) => {
      const transport = real(config)
      options.push(optionsOf(transport))
      return transport
    }) as never)
    const plain = nodemailer.createTransport({
      host: '127.0.0.1',
      port: 1,
      secure: false,
      requireTLS: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      // What the adapter adds on purpose: Nodemailer opens no file and no URL.
      disableFileAccess: true,
      disableUrlAccess: true
    })

    await new SmtpEmailProvider({ host: '127.0.0.1', port: 1 }).send(MESSAGE).catch(() => undefined)

    const mine = options.at(-1) ?? {}
    const direct = optionsOf(plain)
    const defined = (value: Record<string, unknown>): string =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(value)
            .filter(
              ([key, v]) => v !== undefined && key !== 'checkServerIdentity' && key !== 'minDHSize'
            )
            .sort(([a], [b]) => a.localeCompare(b))
        )
      )
    expect(defined(mine)).toBe(defined({ ...direct, tls: { minDHSize: 1024 } }))
  })

  it('should connect with the certificate check on and to the host asked, whatever tls keys are planted', async () => {
    const seen: Record<string, unknown>[] = []
    jest
      .spyOn(jest.requireActual<typeof import('node:tls')>('node:tls'), 'connect')
      .mockImplementation(((options: Record<string, unknown>) => {
        seen.push(options)
        throw new Error('stop before connecting')
      }) as never)
    plantKeys({ rejectUnauthorized: false, servername: 'planted.test', minVersion: 'TLSv1' })

    await new SmtpEmailProvider({ host: '127.0.0.1', port: 465 })
      .send(MESSAGE)
      .catch(() => undefined)

    await new Promise((resolve) => setImmediate(resolve))
    const options = seen[0] ?? {}
    expect(seen.length).toBeGreaterThan(0)
    expect(Reflect.get(options, 'rejectUnauthorized')).toBeUndefined()
    expect(Reflect.get(options, 'servername')).toBeUndefined()
    // The destination is the host's, whatever the options were padded with.
    expect(Reflect.get(options, 'host')).toBe('127.0.0.1')
    expect(Reflect.get(options, 'port')).toBe(465)
    expect(Reflect.get(options, 'minVersion')).toBeUndefined()
  })
})

/** Every `.js` file under a directory. */
function sourcesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? sourcesUnder(path) : path.endsWith('.js') ? [path] : []
  })
}

/** The names of `pattern`'s first group in the sources of the installed Nodemailer under `parts`. */
function namesRead(pattern: RegExp, parts: readonly string[]): Set<string> {
  const root = join(__dirname, '../../../node_modules/nodemailer/dist/cjs')
  const names = new Set<string>()
  for (const part of parts) {
    const target = join(root, part)
    const files = target.endsWith('.js') ? [target] : sourcesUnder(target)
    for (const file of files) {
      for (const match of readFileSync(file, 'utf8').matchAll(pattern)) {
        names.add(match[1] ?? '')
      }
    }
  }
  return names
}

/** The places Nodemailer reads a message and the options of a transport. */
const MESSAGE_SOURCES = [
  'mailer',
  'mail-composer',
  'smtp-transport',
  'smtp-pool',
  'sendmail-transport',
  'stream-transport',
  'json-transport',
  'ses-transport'
]
const TRANSPORT_SOURCES = [
  'smtp-transport',
  'smtp-pool',
  'smtp-connection',
  'mailer',
  'shared/index.js',
  'nodemailer.js'
]

/** Names the patterns catch that are not data read from what the adapter hands over. */
const NOT_DATA = new Set([
  'MessageId',
  '_dkim',
  'component',
  'connectStartedAt',
  'connection',
  'data',
  'force',
  'join',
  'length',
  'message',
  'normalizedHeaders',
  'on',
  'once',
  'releaseStreams',
  'resolveContent',
  'send',
  'setContent',
  'setHeader',
  'setListHeaders',
  'setMailerHeader',
  'setPriorityHeaders',
  'setRaw',
  'slice',
  'split',
  'version',
  'addHeader',
  'mailer',
  'close',
  'connect',
  'login',
  'quit',
  'id',
  'messages',
  'available',
  'allowsAuth',
  'queueEntry',
  'remoteAddress',
  'remotePort',
  'renewalQueue',
  'renewing',
  'configError',
  'emit',
  'generateToken',
  'jwtSignRS256',
  'postRequest',
  'toBase64URL',
  'updateToken',
  '_connectStartedAt',
  '__createBinding',
  '__importDefault',
  '__importStar',
  '__setModuleDefault',
  'from',
  'to'
])

describe('the lists of names Nodemailer reads', () => {
  const missing = (found: Set<string>, listed: readonly string[], extra: readonly string[] = []) =>
    [...found].filter(
      (name) => !NOT_DATA.has(name) && !listed.includes(name) && !extra.includes(name)
    )

  it('should name every key Nodemailer reads from a message', () => {
    const found = namesRead(
      /\b(?:mail\.data|this\.mail\.data|this\.mail|this\.data|mailOptions)\.([A-Za-z_]\w*)/gu,
      MESSAGE_SOURCES
    )

    expect(missing(found, MESSAGE_KEYS)).toStrictEqual([])
  })

  it('should name every field Nodemailer reads from an attachment among the names the realm root may not hold', () => {
    const found = namesRead(/\b(?:attachment|alternative|element|icalEvent)\.([A-Za-z_]\w*)/gu, [
      'mail-composer'
    ])

    expect(missing(found, INTERNAL_KEYS)).toStrictEqual([])
  })

  it('should name every key Nodemailer reads from the options of a transport', () => {
    const found = namesRead(
      /\b(?:this\.options|options|opts|transporter\.options|this\.mailer\.options|mailer\.options|this\.transporter\.options)\.([A-Za-z_]\w*)/gu,
      TRANSPORT_SOURCES
    )

    expect(missing(found, TRANSPORT_KEYS, [...TLS_KEYS, ...AUTH_KEYS])).toStrictEqual([])
  })

  it('should name every key Nodemailer reads from the credentials', () => {
    const found = namesRead(/\b(?:auth|this\.auth|options\.auth|authData)\.([A-Za-z_]\w*)/gu, [
      'smtp-connection',
      'smtp-transport',
      'smtp-pool',
      'xoauth2'
    ])

    expect(missing(found, AUTH_KEYS)).toStrictEqual([])
  })

  it('should name every key it reads from the top-level configuration of createTransport', () => {
    const found = namesRead(/\b(?:options|config)\.([A-Za-z_]\w*)/gu, ['nodemailer.js'])

    expect(
      missing(found, TRANSPORT_KEYS, [...TLS_KEYS, ...AUTH_KEYS, ...MESSAGE_KEYS])
    ).toStrictEqual([])
  })
})
