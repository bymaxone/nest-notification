/**
 * @fileoverview Holds every realm-root helper call of both mail adapters to the boundary it names. A
 * refusal raised inside a swallowed `try`, or overwritten by the message refusal, never shows its
 * owner to a caller, so each flow records the owner of every helper call it makes and checks it.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'

import { ResendEmailProvider } from './resend-email.provider'
import { SmtpEmailProvider } from './smtp-email.provider'

interface HelperCall {
  readonly helper: string
  readonly owner: unknown
}

const mockCalls: HelperCall[] = []
const mockCreateTransport = jest.fn()
const mockSendMail = jest.fn()
const mockVerify = jest.fn()
const mockClose = jest.fn()
const mockResendSend = jest.fn()

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
jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})
jest.mock(
  'resend',
  () => ({
    __esModule: true,
    Resend: function Resend() {
      return { emails: { send: mockResendSend } }
    }
  }),
  { virtual: true }
)

const MESSAGE = { to: 'a@x.com', from: 'f@x.com', subject: 's', html: '<p>x</p>' } as const

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  mockVerify.mockReset().mockResolvedValue(true)
  mockClose.mockReset()
  mockSendMail.mockReset().mockResolvedValue({ messageId: '<m@x>' })
  mockCreateTransport
    .mockReset()
    .mockImplementation(() => ({ sendMail: mockSendMail, verify: mockVerify, close: mockClose }))
  mockResendSend.mockReset().mockResolvedValue({ data: { id: 'r1' }, error: null })
})

const SMTP_ROWS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['send', () => new SmtpEmailProvider({ host: 'h' }).send(MESSAGE)],
  [
    'send refused by the relay',
    () => {
      mockSendMail.mockRejectedValue(new Error('relay refused'))
      return new SmtpEmailProvider({ host: 'h' }).send(MESSAGE)
    }
  ],
  ['verify', () => new SmtpEmailProvider({ host: 'h' }).verify()],
  [
    'verify refused by the relay',
    () => {
      mockVerify.mockRejectedValue(new Error('relay refused'))
      return new SmtpEmailProvider({ host: 'h' }).verify()
    }
  ],
  [
    'close after a send',
    async () => {
      const provider = new SmtpEmailProvider({ host: 'h' })
      await provider.send(MESSAGE)
      await provider.close()
    }
  ],
  [
    'shutdown after a send',
    async () => {
      const provider = new SmtpEmailProvider({ host: 'h' })
      await provider.send(MESSAGE)
      await provider.onModuleDestroy()
    }
  ],
  [
    'send whose transport cannot be built',
    () => {
      mockCreateTransport.mockImplementation(() => {
        throw new Error('no transport')
      })
      return new SmtpEmailProvider({ host: 'h' }).send(MESSAGE)
    }
  ]
]

const RESEND_ROWS: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
  ['send', () => new ResendEmailProvider({ apiKey: 're_x' }).send(MESSAGE)],
  [
    'send refused by the API',
    () => {
      mockResendSend.mockResolvedValue({ data: null, error: { name: 'x', message: 'refused' } })
      return new ResendEmailProvider({ apiKey: 're_x' }).send(MESSAGE)
    }
  ],
  [
    'send rejected by the SDK',
    () => {
      mockResendSend.mockRejectedValue(new Error('network'))
      return new ResendEmailProvider({ apiKey: 're_x' }).send(MESSAGE)
    }
  ]
]

/** The owners the flow named, one per helper call, in call order. */
async function ownersOf(run: () => Promise<unknown>): Promise<HelperCall[]> {
  mockCalls.length = 0
  await run().catch(() => undefined)
  return [...mockCalls]
}

describe.each([
  ['SmtpEmailProvider', SMTP_ROWS],
  ['ResendEmailProvider', RESEND_ROWS]
] as const)('realm-root helper owners of %s', (owner, rows) => {
  it.each(rows)('should name only its own boundary when it runs %s', async (_label, run) => {
    const calls = await ownersOf(run)

    expect(calls.some((call) => call.owner === owner)).toBe(true)
    expect(calls.filter((call) => call.owner !== owner)).toEqual([])
  })
})
