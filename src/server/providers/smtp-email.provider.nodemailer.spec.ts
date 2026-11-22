/**
 * @fileoverview Holds what the SMTP adapter hands to the REAL Nodemailer to being immune to a key
 * planted on the realm root. Nodemailer copies the own keys of a message and of the transport options
 * into ordinary objects and then reads names this library never sets, so the adapter gives each of
 * them an own key. The rows run Nodemailer itself (a stream transport for the message, the real
 * transport options, a `tls.connect` that records its options) and assert on what it produced.
 * @layer infrastructure
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { Logger } from '@nestjs/common'
import * as nodemailer from 'nodemailer'

import { AUTH_KEYS, MESSAGE_KEYS, TLS_KEYS, TRANSPORT_KEYS } from './nodemailer-keys'
import { SmtpEmailProvider } from './smtp-email.provider'

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

/** Makes the adapter's `createTransport` hand back a stream transport, and records the message. */
function streamTransport(): {
  info: () => { envelope: { from: string; to: string[] }; message: Buffer }
} {
  const created = nodemailer.createTransport({ streamTransport: true, buffer: true })
  let last: unknown
  jest.spyOn(nodemailer, 'createTransport').mockImplementation(() => created as never)
  const send = created.sendMail.bind(created)
  jest.spyOn(created, 'sendMail').mockImplementation(((message: object) => {
    last = send(message)
    return last
  }) as never)
  return {
    info: () => last as never
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

    const sent = (await stream.info()) as unknown as { envelope: { to: string[] }; message: Buffer }
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

    const sent = (await stream.info()) as unknown as { message: Buffer }
    expect(normalise(sent.message)).toBe(
      normalise((direct as unknown as { message: Buffer }).message)
    )
  })

  it('should say plainly that Nodemailer reads these names from objects it builds itself', async () => {
    // A limit of the Nodemailer this adapter hands the message to, not of the adapter: `raw`,
    // `headers`, `encoding` and `newline`, and the fields of an attachment, are read from ordinary
    // objects Nodemailer creates after it has copied the message, so no key the adapter sets can
    // shadow them. The README tells a host to run with a frozen `Object.prototype`.
    const stream = streamTransport()
    plantKeys({ raw: 'From: evil@evil.test\r\n\r\nplanted' })

    await new SmtpEmailProvider({ host: '127.0.0.1' }).send(MESSAGE)

    const sent = (await stream.info()) as unknown as { message: Buffer }
    expect(sent.message.toString('utf8')).toContain('planted')
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
    plantKeys({ service: 'gmail', proxy: 'http://evil.test:3128', localAddress: '10.9.9.9' })

    await new SmtpEmailProvider({ host: '127.0.0.1', port: 1 }).send(MESSAGE).catch(() => undefined)

    const options = transporter?.transporter.options
    expect(options?.host).toBe('127.0.0.1')
    expect(options?.port).toBe(1)
    expect(options?.service).toBeUndefined()
    expect(options?.proxy).toBeUndefined()
    expect(options?.localAddress).toBeUndefined()
  })

  it('should build the transport Nodemailer builds for the same plain configuration', async () => {
    const options: Record<string, unknown>[] = []
    const real = nodemailer.createTransport.bind(nodemailer)
    jest.spyOn(nodemailer, 'createTransport').mockImplementation(((config: object) => {
      const transport = real(config) as unknown as { transporter: { options: object } }
      options.push({ ...transport.transporter.options })
      return transport
    }) as never)
    const plain = nodemailer.createTransport({
      host: '127.0.0.1',
      port: 1,
      secure: false,
      requireTLS: false,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000
    })

    await new SmtpEmailProvider({ host: '127.0.0.1', port: 1 }).send(MESSAGE).catch(() => undefined)

    const mine = options.at(-1) ?? {}
    const direct = (plain as unknown as { transporter: { options: Record<string, unknown> } })
      .transporter.options
    const defined = (value: Record<string, unknown>): string =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(value)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => a.localeCompare(b))
        )
      )
    expect(defined(mine)).toBe(defined({ ...direct, tls: {} }))
  })

  it('should connect with the certificate check on and to the host asked, whatever tls keys are planted', async () => {
    const seen: Record<string, unknown>[] = []
    jest
      .spyOn(jest.requireActual<typeof import('node:tls')>('node:tls'), 'connect')
      .mockImplementation(((options: Record<string, unknown>) => {
        seen.push(options)
        throw new Error('stop before connecting')
      }) as never)
    plantKeys({ rejectUnauthorized: false, path: '/tmp/planted.sock', minVersion: 'TLSv1' })

    await new SmtpEmailProvider({ host: '127.0.0.1', port: 465 })
      .send(MESSAGE)
      .catch(() => undefined)

    await new Promise((resolve) => setImmediate(resolve))
    const options = seen[0] ?? {}
    expect(seen.length).toBeGreaterThan(0)
    expect(Reflect.get(options, 'rejectUnauthorized')).toBeUndefined()
    expect(Reflect.get(options, 'path')).toBeUndefined()
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
