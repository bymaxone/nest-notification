/**
 * @fileoverview Holds both mail adapters to naming themselves in every refusal the realm checks and
 * the promise pin raise: a host sees the owner in the message, so a label that went missing is a
 * different answer, not a cosmetic one. Each row reaches one call site by handing the adapter a
 * promise that cannot be pinned, or by leaving a key on `Object.prototype` where the check follows.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'

import { ResendEmailProvider } from './resend-email.provider'
import { SmtpEmailProvider } from './smtp-email.provider'

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
    Resend: function Resend() {
      return { emails: { send: mockResendSend } }
    }
  }),
  { virtual: true }
)

const MESSAGE = { to: 'a@x.com', from: 'f@x.com', subject: 's', html: '<p>x</p>' } as const
const SMTP = 'SmtpEmailProvider'
const RESEND = 'ResendEmailProvider'
const PLANT = 'ownerLabelPlant'

/** The refusal of a promise the library could not pin, as the host reads it. */
function unpinnable(owner: string): string {
  return `[${owner}] promise cannot be pinned, so the operation is refused`
}

/** The refusal of a realm root that holds one key it should not, as the host reads it. */
function polluted(owner: string): string {
  return `[${owner}] Object.prototype holds 1 key(s) or built-in(s) that are not the standard ones, so the operation is refused`
}

/** A promise a host's call returned that nobody can attach a `constructor` to. */
function frozen<T>(value: T): Promise<T> {
  return Object.freeze(Promise.resolve(value))
}

/** Leaves a key on the root prototype, for the check that runs next. */
function plant(): void {
  Object.defineProperty(Object.prototype, PLANT, { value: 1, configurable: true })
}

/** Replaces a method of one adapter, whatever its visibility. */
function replace(provider: object, name: string, value: unknown): void {
  const step = typeof value === 'function' ? value : () => value
  Object.defineProperty(provider, name, { value: step, configurable: true })
}

/** An adapter of each kind, whose private step named `step` answers with `answer`. */
function smtp(step?: string, answer?: unknown): SmtpEmailProvider {
  const provider = new SmtpEmailProvider({ host: 'h' })
  if (step !== undefined) {
    replace(provider, step, answer)
  }
  return provider
}

function resend(step?: string, answer?: unknown): ResendEmailProvider {
  const provider = new ResendEmailProvider({ apiKey: 're_x' })
  if (step !== undefined) {
    replace(provider, step, answer)
  }
  return provider
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  mockSendMail.mockReset().mockResolvedValue({ messageId: '<m@x>' })
  mockCreateTransport.mockReset().mockImplementation(() => ({ sendMail: mockSendMail }))
  mockResendSend.mockReset().mockResolvedValue({ data: { id: 'r1' }, error: null })
})

afterEach(() => {
  Reflect.deleteProperty(Object.prototype, PLANT)
})

/** A send whose step is handed a promise that cannot be pinned, or that leaves the realm changed. */
const SMTP_ROWS: ReadonlyArray<readonly [string, () => Promise<unknown>, string]> = [
  [
    'send awaiting its own read',
    () => smtp('sendRead', frozen({})).send(MESSAGE),
    unpinnable(SMTP)
  ],
  [
    'read awaiting the transport',
    () => smtp('getTransport', frozen({})).send(MESSAGE),
    unpinnable(SMTP)
  ],
  [
    'read awaiting the dispatch',
    () => smtp('dispatch', frozen({})).send(MESSAGE),
    unpinnable(SMTP)
  ],
  [
    'dispatch after the relay was called',
    () => {
      mockSendMail.mockImplementation(() => {
        plant()
        return Promise.resolve({ messageId: '<m@x>' })
      })
      return smtp().send(MESSAGE)
    },
    polluted(SMTP)
  ],
  [
    'transport build awaiting the import',
    () => smtp('loadNodemailer', frozen({})).send(MESSAGE),
    unpinnable(SMTP)
  ],
  [
    'shutdown awaiting the close',
    () => smtp('close', frozen(undefined)).onModuleDestroy(),
    unpinnable(SMTP)
  ]
]

const RESEND_ROWS: ReadonlyArray<readonly [string, () => Promise<unknown>, string]> = [
  [
    'send awaiting its own read',
    () => resend('sendRead', frozen({})).send(MESSAGE),
    unpinnable(RESEND)
  ],
  [
    'read awaiting the client',
    () => resend('getClient', frozen({})).send(MESSAGE),
    unpinnable(RESEND)
  ],
  [
    'client build awaiting the import',
    () => resend('loadResendConstructor', frozen({})).send(MESSAGE),
    unpinnable(RESEND)
  ]
]

/** Steps that leave the realm changed once the provider has accepted the message. */
const ACCEPTED_ROWS: ReadonlyArray<readonly [string, () => Promise<unknown>, string]> = [
  [
    'SMTP send after its read',
    () =>
      smtp('sendRead', async () => {
        plant()
        return { messageId: '<m@x>' }
      }).send(MESSAGE),
    '<m@x>'
  ],
  [
    'SMTP read after the dispatch',
    () =>
      smtp('dispatch', async () => {
        plant()
        return { value: { messageId: '<m@x>' } }
      }).send(MESSAGE),
    '<m@x>'
  ],
  [
    'Resend send after its read',
    () =>
      resend('sendRead', async () => {
        plant()
        return { messageId: 'r1' }
      }).send(MESSAGE),
    'r1'
  ],
  [
    'Resend read after the SDK answered',
    () => {
      mockResendSend.mockResolvedValue({
        data: {
          get id() {
            plant()
            return 'r1'
          }
        },
        error: null
      })
      return resend().send(MESSAGE)
    },
    'r1'
  ]
]

// A refusal here would tell the caller to send an accepted message again.
describe('an adapter whose provider has accepted the message', () => {
  it.each(ACCEPTED_ROWS)('should answer as sent: %s', async (_name, run, messageId) => {
    await expect(run()).resolves.toEqual({ messageId })
  })
})

const REFUSED_AS_GIVEN = '[EmailService] message the provider refused the message as given'

describe('a library refusal raised inside the send of an adapter', () => {
  it('should reach the caller as the message refusal when the relay call cannot be pinned', async () => {
    mockSendMail.mockReturnValue(frozen({}))

    await expect(smtp().send(MESSAGE)).rejects.toMatchObject({
      response: { error: { message: REFUSED_AS_GIVEN } }
    })
  })

  it('should reach the caller as the message refusal when the SDK call cannot be pinned', async () => {
    mockResendSend.mockReturnValue(frozen({}))

    await expect(resend().send(MESSAGE)).rejects.toMatchObject({
      response: { error: { message: REFUSED_AS_GIVEN } }
    })
  })
})

describe('SmtpEmailProvider naming itself in a refusal', () => {
  it.each(SMTP_ROWS)('should name the adapter when %s', async (_name, run, message) => {
    await expect(run()).rejects.toMatchObject({ response: { error: { message } } })
  })
})

describe('ResendEmailProvider naming itself in a refusal', () => {
  it.each(RESEND_ROWS)('should name the adapter when %s', async (_name, run, message) => {
    await expect(run()).rejects.toMatchObject({ response: { error: { message } } })
  })
})
