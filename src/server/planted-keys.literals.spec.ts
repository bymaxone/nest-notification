/**
 * @fileoverview Holds the objects the library builds for something that reads keys it never sets (a
 * mail transport, an SDK, a template renderer, a store wrapper) to having no prototype, so a key
 * planted on the realm root does not answer for them: a planted `envelope` must not change who gets
 * a message, nor a planted `path` which file an attachment reads. Each row plants the key and asserts
 * through what the other side receives.
 * @layer integration
 */

import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxNotificationModule } from './bymax-notification.module'
import { NotificationService } from './services/notification.service'
import { OtpService } from './services/otp.service'

import { DefaultTemplateRenderer } from './providers/default-template-renderer'
import { InMemoryOtpStorage } from './providers/in-memory-otp.storage'
import { ResendEmailProvider } from './providers/resend-email.provider'
import { SmtpEmailProvider } from './providers/smtp-email.provider'
import { isUnavailableError } from './utils/availability'
import { withStorageFailures } from './utils/storage-failures'

// The own-key shadows are the second layer; they are tested with the realm-root check off. The check
// has its own spec (`realm-root.spec.ts`).
jest.mock('./utils/realm-root', () => ({
  ...jest.requireActual<object>('./utils/realm-root'),
  assertStandardRealmRoot: jest.fn(),
  checkedAwait: (pending: unknown) => pending,
  // The check is off for these rows, so the hand-over does not look at the realm either.
  ownChecked: (promise: unknown) => promise
}))

// `mock`-prefixed names are allowed inside the hoisted jest.mock factories.
const mockCreateTransport = jest.fn()
const mockSendMail = jest.fn()
const mockResendSend = jest.fn()
jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})
jest.mock(
  'resend',
  () => ({
    __esModule: true,
    Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockResendSend } }))
  }),
  { virtual: true }
)

const MESSAGE = { to: 'a@x.com', from: 'f@x.com', subject: 's', html: '<p>x</p>' } as const

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
})

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  mockCreateTransport.mockReset()
  mockSendMail.mockReset()
  mockResendSend.mockReset()
  mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail }))
  mockSendMail.mockResolvedValue({ messageId: 'x' })
  mockResendSend.mockResolvedValue({ data: { id: 'r1' }, error: null })
})

const NODEMAILER_KEYS = {
  envelope: { from: 'evil@evil.test', to: ['evil@evil.test'] },
  sender: 'evil@evil.test',
  dsn: { notify: 'never' },
  list: { unsubscribe: 'evil' },
  alternatives: [{ content: 'planted' }],
  service: 'planted-service',
  proxy: 'http://evil.test',
  dkim: { privateKey: 'planted' }
}

describe('the SMTP message and transport', () => {
  it('should hand the transport a configuration with no key of the planted ones', async () => {
    plantKeys(NODEMAILER_KEYS)

    await new SmtpEmailProvider({ host: 'h', credentials: { user: 'u', pass: 'p' } }).send(MESSAGE)

    const config = mockCreateTransport.mock.calls[0]?.[0] as object
    const auth = (config as { auth: object }).auth
    for (const key of Object.keys(NODEMAILER_KEYS)) {
      expect(Reflect.get(config, key)).toBeUndefined()
      expect(Reflect.get(auth, key)).toBeUndefined()
    }
  })

  it('should send a message whose recipients, envelope and attachments no planted key can change', async () => {
    plantKeys(NODEMAILER_KEYS)

    await new SmtpEmailProvider({ host: 'h' }).send({
      ...MESSAGE,
      attachments: [{ filename: 'a.txt', content: 'eA==' }]
    })

    const message = mockSendMail.mock.calls[0]?.[0] as { to: unknown; attachments: object[] }
    for (const key of Object.keys(NODEMAILER_KEYS)) {
      expect(Reflect.get(message, key)).toBeUndefined()
    }
    // The recipient is the one asked for, and the attachment is the one given, whatever is planted.
    expect(Reflect.get(message.to as object, 'address')).toBe('a@x.com')
    expect(message.attachments).toHaveLength(1)
    expect(Reflect.get(message.attachments[0] ?? {}, 'filename')).toBe('a.txt')
    expect(Reflect.get(message.attachments[0] ?? {}, 'content')).toBe('eA==')
    expect(Reflect.get(message.attachments[0] ?? {}, 'encoding')).toBe('base64')
  })

  it('should not scrub a planted user or password out of a relay error', async () => {
    plantKeys({ user: 'zzzuser', pass: 'zzzpass' })
    mockSendMail.mockRejectedValue(new Error('550 bad zzzuser zzzpass'))

    const caught = (await new SmtpEmailProvider({ host: 'h' })
      .send(MESSAGE)
      .catch((error: unknown) => error)) as Error

    expect(caught.message).toContain('zzzuser zzzpass')
  })
})

describe('the Resend payload', () => {
  it('should hand the SDK a payload and attachments with no planted key', async () => {
    plantKeys({
      scheduledAt: 'in the past',
      react: {},
      template: { id: 'planted' },
      topicId: 'planted',
      path: '/etc/passwd',
      headers: { 'X-Planted': '1' }
    })

    await new ResendEmailProvider({ apiKey: 'k' }).send({
      ...MESSAGE,
      attachments: [{ filename: 'a.txt', content: 'eA==' }]
    })

    const payload = mockResendSend.mock.calls[0]?.[0] as { attachments: object[] }
    expect(Reflect.get(payload, 'scheduledAt')).toBeUndefined()
    expect(Reflect.get(payload, 'headers')).toBeUndefined()
    // The SDK spreads the payload into an ordinary object before it reads `react`, `scheduledAt`,
    // `template` and `topicId`, so the payload has an own key for each: the spread keeps it.
    const spread: Record<string, unknown> = { ...payload }
    for (const key of ['react', 'scheduledAt', 'template', 'topicId']) {
      expect(Reflect.get(spread, key)).toBeUndefined()
    }
    expect(Reflect.get(payload.attachments[0] ?? {}, 'path')).toBeUndefined()
  })
})

describe('the attachments and tags of a direct call to an adapter', () => {
  it('should not give a plain attachment a planted cid or disposition when a provider is called directly', async () => {
    plantKeys({ cid: 'planted-cid', contentDisposition: 'inline', contentType: 'text/evil' })

    await new ResendEmailProvider({ apiKey: 'k' }).send({
      ...MESSAGE,
      attachments: [{ filename: 'a.txt', content: 'eA==' }]
    })

    const sent = (mockResendSend.mock.calls[0]?.[0] as { attachments: object[] }).attachments[0]
    expect(Object.keys(sent ?? {})).toStrictEqual(['filename', 'content'])
  })

  it('should send a Resend tag without the value a planted key would add', async () => {
    plantKeys({ value: 'planted', name: 'planted' })

    await new ResendEmailProvider({ apiKey: 'k' }).send({
      ...MESSAGE,
      tags: [{ name: 'n' } as never]
    })

    const tag = (mockResendSend.mock.calls[0]?.[0] as { tags: object[] }).tags[0]
    expect(Object.keys(tag ?? {})).toStrictEqual(['name'])
  })

  it.each([
    ['Resend', () => new ResendEmailProvider({ apiKey: 'k' })],
    ['SMTP', () => new SmtpEmailProvider({ host: 'h' })]
  ])(
    'should treat a null list of attachments or tags as none on the %s adapter',
    async (name, make) => {
      await expect(
        make().send({ ...MESSAGE, attachments: null, tags: null } as never)
      ).resolves.toBeDefined()

      // What went out holds neither list: the transport or the SDK was given none, and not a `null`.
      const sent = (name === 'Resend' ? mockResendSend : mockSendMail).mock.calls[0]?.[0] as object
      expect(Reflect.get(sent, 'attachments')).toBeUndefined()
      expect(Reflect.get(sent, 'tags')).toBeUndefined()
    }
  )
})

describe('the default template renderer', () => {
  const template = { subject: 'Hi {{name}}', html: '<p>{{name}} {{a.b}}</p>' }

  it('should register no template that a planted templates key supplies', async () => {
    plantKeys({ templates: { planted: template } })

    expect(await new DefaultTemplateRenderer({}).hasTemplate('planted', 'en')).toBe(false)
  })

  it('should not add a planted text to a template that has none', async () => {
    plantKeys({ text: 'attacker text' })
    const renderer = new DefaultTemplateRenderer({ templates: { 'welcome::en': template } })

    const rendered = await renderer.render('welcome', { name: 'Ann' }, 'en')

    expect(rendered.text).toBeUndefined()
  })

  it('should keep the missing-variable and nested-path policy the host left unset', async () => {
    plantKeys({ onMissingVar: 'throw', enableNestedPaths: true, fallbackLocales: ['xx'] })
    const renderer = new DefaultTemplateRenderer({ templates: { 'welcome::en': template } })

    const rendered = await renderer.render('welcome', { a: { b: 'nested' } }, 'en')

    expect(rendered.html).toBe('<p> </p>')
  })
})

describe('the other readers of a host object', () => {
  it('should not take a planted code or reply code for an outage', () => {
    plantKeys({ code: 'ECONNREFUSED', responseCode: 421 })

    expect(isUnavailableError(new Error('plain failure'))).toBe(false)
  })

  it('should not give a store an operation it does not have, from a planted function', () => {
    plantKeys({ recordFailure: async () => 1 })
    const storage = new InMemoryOtpStorage()
    Reflect.deleteProperty(storage, 'recordFailure')
    Object.setPrototypeOf(storage, null)

    const wrapped = withStorageFailures(storage)

    expect(Reflect.get(wrapped, 'recordFailure')).toBeUndefined()
  })
})

describe('the dispatch request', () => {
  it('should hand the OTP service only the fields the payload has, whatever is planted', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BymaxNotificationModule.forRoot({ otp: { storage: new InMemoryOtpStorage() } })]
    }).compile()
    const generate = jest
      .spyOn(moduleRef.get(OtpService), 'generate')
      .mockResolvedValue({ expiresAt: 1, cooldownSeconds: 1 })
    plantKeys({ deliverVia: 'email', userId: 'planted', emailTemplate: 'x', locale: 'xx' })

    await moduleRef.get(NotificationService).dispatch({
      channel: 'otp',
      tenantId: 't',
      payload: { recipient: 'a@x.com', purpose: 'login' }
    })

    expect(Object.keys(generate.mock.calls[0]?.[0] as object)).toStrictEqual([
      'tenantId',
      'recipient',
      'purpose'
    ])
  })
})
