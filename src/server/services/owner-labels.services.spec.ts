/**
 * @fileoverview Holds every realm-root helper call of the email, OTP and dispatch services, and of the
 * storage wrapper and the span runner they use, to the boundary it names: a refusal reads the owner
 * out of its `boundary` and its message, so a call that names the wrong one, or none, misreports
 * which service refused. Each row runs one flow and checks every helper call it made.
 * @layer application
 */

import type { INotificationObserver } from '../interfaces/notification-observer.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import {
  baseInput,
  makeAudit as makeEmailAudit,
  makeOptions as makeEmailOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'
import { EmailService } from './email.service'
import { NotificationService } from './notification.service'
import { OtpService } from './otp.service'

interface HelperCall {
  readonly helper: string
  readonly owner: unknown
}

const mockCalls: HelperCall[] = []

jest.mock('../utils/realm-root', () => {
  const actual =
    jest.requireActual<Record<string, (...args: unknown[]) => unknown>>('../utils/realm-root')
  const recording =
    (helper: string, ownerAt: number) =>
    (...args: unknown[]): unknown => {
      mockCalls.push({ helper, owner: args[ownerAt] })
      return (actual[helper] as (...a: unknown[]) => unknown)(...args)
    }
  return {
    ...actual,
    own: recording('own', 1),
    ownChecked: recording('ownChecked', 1),
    checkedAwait: recording('checkedAwait', 1),
    pinOnce: recording('pinOnce', 1),
    assertStandardRealmRoot: recording('assertStandardRealmRoot', 0)
  }
})

const SECRET = 'a-secret-of-at-least-thirty-two-bytes!'

const failing = (): Promise<never> => Promise.reject(new Error('relay refused'))

/** An observer whose span runs the operation, as the contract asks. */
const spanning: INotificationObserver = {
  span: (_name, _attributes, run) => run()
}

function email(observer?: INotificationObserver): {
  service: EmailService
  provider: ReturnType<typeof makeProvider>
  renderer: ReturnType<typeof makeRenderer>
  audit: ReturnType<typeof makeEmailAudit>
} {
  const provider = makeProvider()
  const renderer = makeRenderer()
  const audit = makeEmailAudit()
  const service = new EmailService(makeEmailOptions(), provider, renderer, audit, observer)
  return { service, provider, renderer, audit }
}

function otp(withEmail = false, observer?: INotificationObserver): OtpService {
  const emailService = {
    sendTemplate: jest.fn(async () => ({ messageId: 'm' }))
  } as Pick<EmailService, 'sendTemplate'>
  return new OtpService(
    makeOptions({ codeSecret: SECRET }),
    new InMemoryOtpStorage(),
    makeAudit(),
    withEmail ? (emailService as EmailService) : undefined,
    observer
  )
}

const TEMPLATE = { tenantId: 't', to: 'a@x.com', template: 'welcome', data: {} }

/** A raw send whose provider refuses, with the text published or withheld. */
async function refusedSend(publishProviderText: boolean): Promise<void> {
  const { service, provider } = email()
  provider.send.mockImplementation(failing)
  await service.send({ ...baseInput, publishProviderText }).catch(() => undefined)
}

const EMAIL_ROWS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['send', () => email().service.send(baseInput)],
  ['send observed', () => email(spanning).service.send(baseInput)],
  ['send refused by the provider', () => refusedSend(true)],
  ['send refused by the provider, text withheld', () => refusedSend(false)],
  [
    'send with a failing audit sink',
    async () => {
      const { service, audit } = email()
      audit.create.mockImplementation(failing)
      await service.send(baseInput)
    }
  ],
  ['sendTemplate', () => email().service.sendTemplate(TEMPLATE)],
  ['sendTemplate observed', () => email(spanning).service.sendTemplate(TEMPLATE)],
  [
    'sendTemplate with a fallback locale',
    async () => {
      const { service, renderer } = email()
      renderer.hasTemplate.mockResolvedValueOnce(false)
      await service.sendTemplate({ ...TEMPLATE, locale: 'pt' })
    }
  ],
  ['resolvesTemplate', () => email().service.resolvesTemplate('welcome', 'en')]
]

const OTP_ROWS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['generate', () => otp().generate({ ...ref, deliverVia: 'manual' })],
  ['generate by email', () => otp(true).generate({ ...ref, deliverVia: 'email' })],
  [
    'generate then verify',
    async () => {
      const service = otp()
      await service.generate({ ...ref, deliverVia: 'manual' })
      await service.verify({ ...ref, code: '000000' })
    }
  ],
  ['verify observed', () => otp(false, spanning).verify({ ...ref, code: '000000' })],
  ['getStatus', () => otp().getStatus(ref)],
  ['consume', () => otp().consume(ref)]
]

function notified(channel: 'email' | 'otp', payload: Record<string, unknown>): Promise<unknown> {
  const { service } = email()
  const dispatching = new NotificationService(service, otp())
  return dispatching.dispatch({ channel, tenantId: 't', payload } as never)
}

const DISPATCH_ROWS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['dispatch email template', () => notified('email', { to: 'a@x.com', template: 'welcome' })],
  [
    'dispatch email raw',
    () => notified('email', { to: 'a@x.com', subject: 'S', html: '<p>B</p>' })
  ],
  ['dispatch otp generate', () => notified('otp', { ...ref, deliverVia: 'manual' })],
  ['dispatch otp verify', () => notified('otp', { ...ref, action: 'verify', code: '000000' })],
  [
    'dispatch push',
    () =>
      new NotificationService(undefined, undefined, {
        isConfigured: () => true,
        send: async () => ({ results: [] })
      } as never).dispatch({
        channel: 'push',
        tenantId: 't',
        payload: { tokens: ['x'], title: 'T', body: 'B' }
      } as never)
  ]
]

/** The owners the flow named, one per helper call, in call order. */
async function ownersOf(run: () => Promise<unknown>): Promise<HelperCall[]> {
  mockCalls.length = 0
  await run().catch(() => undefined)
  return [...mockCalls]
}

describe('realm-root helper owners', () => {
  describe.each([
    ['EmailService', ['EmailService'], EMAIL_ROWS],
    ['NotificationService', ['NotificationService', 'EmailService', 'OtpService'], DISPATCH_ROWS],
    ['OtpService', ['OtpService'], OTP_ROWS]
  ] as const)('%s', (owner, allowed, rows) => {
    it.each(rows)('should name only its own boundary when it runs %s', async (_label, run) => {
      const calls = await ownersOf(run)

      expect(calls.some((call) => call.owner === owner)).toBe(true)
      // A call that names nothing takes the default; one that names '' names no boundary at all.
      expect(
        calls.filter(
          (call) =>
            call.owner !== undefined && !(allowed as readonly unknown[]).includes(call.owner)
        )
      ).toEqual([])
    })
  })
})
