/**
 * @fileoverview Holds the template send, the dispatch of a template send and the OTP email path to
 * what the caller gave: a key planted on the realm root under the name of a field of a send (`bcc`,
 * `cc`, `attachments`, `text`, `from`, `fromName`, `replyTo`, `auditRedactValues`,
 * `publishProviderText`) changes nothing a custom provider receives, and a failure that echoes the
 * code is still redacted and its text still withheld.
 * @layer integration
 */

import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import type { TestingModule } from '@nestjs/testing'

import { BymaxNotificationModule } from '../bymax-notification.module'
import type { EmailSendOptions, IEmailProvider } from '../interfaces/email-provider.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { EmailService } from './email.service'
import { NotificationService } from './notification.service'
import { OtpService } from './otp.service'

jest.mock('../utils/realm-root', () => ({ assertStandardRealmRoot: jest.fn() }))

const NAMES: ReadonlyArray<readonly [string, unknown]> = [
  ['bcc', 'planted-bcc@evil.test'],
  ['cc', 'planted-cc@evil.test'],
  ['attachments', [{ filename: 'planted.txt', content: 'x' }]],
  ['text', 'planted text'],
  ['from', 'planted-from@evil.test'],
  ['fromName', 'Planted'],
  ['replyTo', 'planted-reply@evil.test'],
  ['auditRedactValues', []],
  ['publishProviderText', true],
  ['tags', [{ name: 'planted', value: 'x' }]],
  ['headers', { 'X-Planted': '1' }]
]

const renderer = {
  name: 'test-renderer',
  render: async (): Promise<{ subject: string; html: string }> => ({
    subject: 'Your code',
    html: '<p>code</p>'
  }),
  hasTemplate: async (): Promise<boolean> => true
}

/** Builds the module with a provider that records what it receives, or fails echoing the code. */
async function build(
  seen: EmailSendOptions[],
  echoFailure: boolean,
  rows: Array<Record<string, unknown>>
): Promise<TestingModule> {
  const provider: IEmailProvider = {
    name: 'recording',
    isConfigured: () => true,
    send: async (options) => {
      // The code is random, so it is written as a label: what is compared is the shape.
      seen.push(JSON.parse(JSON.stringify(options).replace(/\d{6}/gu, 'CODE')) as EmailSendOptions)
      const echoed = options.redactValues?.[0]
      if (echoFailure) {
        throw new Error(`relay said: ${options.redactValues?.[0] ?? 'no value'}`)
      }
      return { messageId: 'm1' }
    }
  }
  return Test.createTestingModule({
    imports: [
      BymaxNotificationModule.forRoot({
        email: { provider, defaultFrom: 'no-reply@acme.com', templateRenderer: renderer },
        otp: { storage: new InMemoryOtpStorage() },
        audit: {
          repository: {
            name: 'r',
            create: async (entry) => {
              rows.push({ verb: entry.verb, text: entry.errorMessage })
            }
          }
        }
      })
    ]
  }).compile()
}

/** The three paths, each one send of a template, as the options the provider received. */
async function viaPaths(
  moduleRef: TestingModule,
  seen: EmailSendOptions[]
): Promise<Record<string, unknown>> {
  const email = moduleRef.get(EmailService)
  const notification = moduleRef.get(NotificationService)
  const otp = moduleRef.get(OtpService)
  const out: Record<string, unknown> = {}
  const run = async (label: string, call: () => Promise<unknown>): Promise<void> => {
    seen.length = 0
    await call().catch(() => undefined)
    out[label] = seen.at(0) ?? null
  }
  await run('sendTemplate', () =>
    email.sendTemplate({ tenantId: 't', to: 'bob@x.com', template: 'welcome', data: {} })
  )
  await run('dispatch', () =>
    notification.dispatch({
      channel: 'otp',
      tenantId: 't',
      payload: {
        recipient: 'cy@x.com',
        purpose: 'login',
        deliverVia: 'email',
        emailTemplate: 'otp'
      }
    })
  )
  await run('generate', () =>
    otp.generate({
      tenantId: 't',
      recipient: 'di@x.com',
      purpose: 'login',
      deliverVia: 'email',
      emailTemplate: 'otp'
    })
  )
  return out
}

function plant(name: string, value: unknown): void {
  Object.defineProperty(Object.prototype, name, {
    value,
    configurable: true,
    writable: true,
    enumerable: true
  })
}

describe('a key planted under the name of a field of a send', () => {
  let baseline: Record<string, unknown>
  const planted: string[] = []

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined)
    const seen: EmailSendOptions[] = []
    baseline = await viaPaths(await build(seen, false, []), seen)
  })

  afterEach(() => {
    for (const name of planted.splice(0)) {
      Reflect.deleteProperty(Object.prototype, name)
    }
  })

  afterAll(() => jest.restoreAllMocks())

  it.each(NAMES)(
    'should change nothing a custom provider receives when %s is planted, by any of the three paths',
    async (name, value) => {
      plant(name, value)
      planted.push(name)
      const seen: EmailSendOptions[] = []

      const received = await viaPaths(await build(seen, false, []), seen)

      expect(received).toStrictEqual(baseline)
    }
  )

  it.each(NAMES)(
    'should keep a failure that echoes the body redacted and withheld when %s is planted',
    async (name, value) => {
      plant(name, value)
      planted.push(name)
      const rows: Array<Record<string, unknown>> = []
      const seen: EmailSendOptions[] = []
      const moduleRef = await build(seen, true, rows)

      await viaPaths(moduleRef, seen)

      // The relay echoes the code it was given. The plain template send has none, so its text is the
      // relay's own; the two OTP paths publish no provider text at all, whatever the planted keys say.
      const published = rows.filter((row) => row.text !== undefined).map((row) => row.text)
      expect(published).toStrictEqual([
        'relay said: no value',
        '[provider text withheld]',
        '[provider text withheld]'
      ])
      expect(JSON.stringify(rows)).not.toMatch(/\d{6}/u)
    }
  )
})
