/**
 * @fileoverview Holds `SmtpEmailProvider` to a bound on every send: a relay that accepts the
 * connection and then trickles or stalls fails the call at `sendTimeoutMs`, whatever the
 * per-phase and idle timeouts of the client would allow. The send, failure and redaction specs
 * live in `smtp-email.provider.spec.ts` and `smtp-email.provider.failures.spec.ts`.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'

import { isUnavailableError } from '../utils/availability'

import { baseOptions } from './__tests__/smtp-email-provider.fixtures'
import { SmtpEmailProvider } from './smtp-email.provider'

// `mock`-prefixed names are allowed inside the hoisted jest.mock factory.
const mockSendMail = jest.fn()
const mockCreateTransport = jest.fn()

jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})

/** A send whose outcome the test decides, later. */
function deferred(): {
  promise: Promise<{ messageId: string }>
  resolve: (value: { messageId: string }) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: { messageId: string }) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<{ messageId: string }>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Starts a send and records how it settled, so a test can advance time in between. */
function startSend(provider: SmtpEmailProvider, options = baseOptions): { outcome: unknown[] } {
  const outcome: unknown[] = []
  provider.send(options).then(
    (value) => outcome.push(['resolved', value]),
    (error: unknown) => outcome.push(['rejected', error])
  )
  return { outcome }
}

describe('SmtpEmailProvider send timeout', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] })
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    mockCreateTransport.mockImplementation(() => ({ sendMail: mockSendMail }))
    mockSendMail.mockReset()
    mockSendMail.mockResolvedValue({ messageId: '<abc@mailpit>' })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should fail a send that never answers once the default bound has passed', async () => {
    mockSendMail.mockImplementation(() => new Promise(() => undefined))
    const { outcome } = startSend(new SmtpEmailProvider({ host: 'h' }))

    await jest.advanceTimersByTimeAsync(59_999)
    expect(outcome).toHaveLength(0)

    await jest.advanceTimersByTimeAsync(1)
    expect(outcome).toHaveLength(1)
    const [kind, error] = outcome[0] as ['rejected', Error & { code?: string }]
    expect(kind).toBe('rejected')
    expect(error.message).toBe('SMTP send failed: SMTP send timed out after 60000 ms')
    expect(error.code).toBe('ETIMEDOUT')
  })

  it('should apply the configured bound', async () => {
    mockSendMail.mockImplementation(() => new Promise(() => undefined))
    const { outcome } = startSend(new SmtpEmailProvider({ host: 'h', sendTimeoutMs: 2_500 }))

    await jest.advanceTimersByTimeAsync(2_499)
    expect(outcome).toHaveLength(0)

    await jest.advanceTimersByTimeAsync(1)
    expect((outcome[0] as [string, Error])[1].message).toBe(
      'SMTP send failed: SMTP send timed out after 2500 ms'
    )
  })

  it('should apply the bound to every send, each from its own start', async () => {
    mockSendMail.mockImplementation(() => new Promise(() => undefined))
    const provider = new SmtpEmailProvider({ host: 'h', sendTimeoutMs: 1_000 })

    const first = startSend(provider)
    await jest.advanceTimersByTimeAsync(1_000)
    const second = startSend(provider)
    await jest.advanceTimersByTimeAsync(999)

    expect(first.outcome).toHaveLength(1)
    expect(second.outcome).toHaveLength(0)

    await jest.advanceTimersByTimeAsync(1)
    expect(second.outcome).toHaveLength(1)
  })

  // The status the service answers with is read off this code: a timed-out relay is unavailable.
  it('should report the failure as an unavailability', async () => {
    mockSendMail.mockImplementation(() => new Promise(() => undefined))
    const { outcome } = startSend(new SmtpEmailProvider({ host: 'h', sendTimeoutMs: 10 }))

    await jest.advanceTimersByTimeAsync(10)

    expect(isUnavailableError((outcome[0] as [string, unknown])[1])).toBe(true)
  })

  it('should keep the code when the relay text is withheld', async () => {
    mockSendMail.mockImplementation(() => new Promise(() => undefined))
    const { outcome } = startSend(new SmtpEmailProvider({ host: 'h', sendTimeoutMs: 10 }), {
      ...baseOptions,
      publishProviderText: false
    })

    await jest.advanceTimersByTimeAsync(10)

    const error = (outcome[0] as [string, Error & { code?: string }])[1]
    expect(error.message).toBe('SMTP send failed')
    expect(error.code).toBe('ETIMEDOUT')
  })

  it('should not delay or alter a send that answers in time', async () => {
    const { outcome } = startSend(new SmtpEmailProvider({ host: 'h', sendTimeoutMs: 5_000 }))

    await jest.advanceTimersByTimeAsync(0)

    expect(outcome).toEqual([['resolved', { messageId: '<abc@mailpit>' }]])
  })

  it('should surface the transport error of a send that fails in time, unchanged in kind', async () => {
    mockSendMail.mockRejectedValue(new Error('550 mailbox unavailable'))
    const { outcome } = startSend(new SmtpEmailProvider({ host: 'h' }))

    await jest.advanceTimersByTimeAsync(0)

    const error = (outcome[0] as [string, Error & { code?: string }])[1]
    expect(error.message).toBe('SMTP send failed: 550 mailbox unavailable')
    expect(error.code).toBeUndefined()
  })

  describe('the timer', () => {
    it('should be cleared after a send that answers', async () => {
      startSend(new SmtpEmailProvider({ host: 'h' }))

      await jest.advanceTimersByTimeAsync(0)

      expect(jest.getTimerCount()).toBe(0)
    })

    it('should be cleared after a send the transport rejects', async () => {
      mockSendMail.mockRejectedValue(new Error('550 mailbox unavailable'))
      startSend(new SmtpEmailProvider({ host: 'h' }))

      await jest.advanceTimersByTimeAsync(0)

      expect(jest.getTimerCount()).toBe(0)
    })

    it('should be gone after a send that timed out', async () => {
      mockSendMail.mockImplementation(() => new Promise(() => undefined))
      startSend(new SmtpEmailProvider({ host: 'h', sendTimeoutMs: 10 }))

      await jest.advanceTimersByTimeAsync(10)

      expect(jest.getTimerCount()).toBe(0)
    })

    it('should be armed while the send is in flight', async () => {
      mockSendMail.mockImplementation(() => new Promise(() => undefined))
      startSend(new SmtpEmailProvider({ host: 'h', sendTimeoutMs: 10 }))

      await jest.advanceTimersByTimeAsync(5)

      expect(jest.getTimerCount()).toBe(1)
    })
  })

  // The transport promise outlives the call that gave up on it: its late outcome must not surface.
  describe('a transport that settles after the bound', () => {
    it('should not raise an unhandled rejection when it rejects late', async () => {
      const unhandled = jest.fn()
      process.on('unhandledRejection', unhandled)
      const late = deferred()
      mockSendMail.mockReturnValue(late.promise)
      const { outcome } = startSend(new SmtpEmailProvider({ host: 'h', sendTimeoutMs: 10 }))

      await jest.advanceTimersByTimeAsync(10)
      late.reject(new Error('late'))
      await jest.advanceTimersByTimeAsync(0)
      await new Promise((resolve) => setImmediate(resolve))
      process.off('unhandledRejection', unhandled)

      expect(outcome).toHaveLength(1)
      expect(unhandled).not.toHaveBeenCalled()
    })

    it('should leave the reported failure as it was when it resolves late', async () => {
      const late = deferred()
      mockSendMail.mockReturnValue(late.promise)
      const { outcome } = startSend(new SmtpEmailProvider({ host: 'h', sendTimeoutMs: 10 }))

      await jest.advanceTimersByTimeAsync(10)
      late.resolve({ messageId: '<late@mailpit>' })
      await jest.advanceTimersByTimeAsync(0)

      expect(outcome).toHaveLength(1)
      expect((outcome[0] as [string, unknown])[0]).toBe('rejected')
    })

    it('should log one failure for the call, not one more when the transport settles', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn')
      const late = deferred()
      mockSendMail.mockReturnValue(late.promise)
      startSend(new SmtpEmailProvider({ host: 'h', sendTimeoutMs: 10 }))

      await jest.advanceTimersByTimeAsync(10)
      late.reject(new Error('late'))
      await jest.advanceTimersByTimeAsync(0)

      expect(warn).toHaveBeenCalledTimes(1)
    })
  })

  it('should keep the credentials and the body out of the timeout failure and its log line', async () => {
    mockSendMail.mockImplementation(() => new Promise(() => undefined))
    const warn = jest.spyOn(Logger.prototype, 'warn')
    const { outcome } = startSend(
      new SmtpEmailProvider({
        host: 'h',
        credentials: { user: 'smtp-user-x', pass: 'smtp-pass-x' },
        sendTimeoutMs: 10
      })
    )

    await jest.advanceTimersByTimeAsync(10)

    const text = `${(outcome[0] as [string, Error])[1].message} ${String(warn.mock.calls[0]?.[0])}`
    expect(text).not.toMatch(/smtp-user-x|smtp-pass-x|123456/)
  })

  describe('validation', () => {
    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, '5000'])(
      'should refuse a sendTimeoutMs of %p',
      (sendTimeoutMs) => {
        expect(
          () =>
            new SmtpEmailProvider({ host: 'h', sendTimeoutMs: sendTimeoutMs as unknown as number })
        ).toThrow(
          'SmtpEmailProvider: sendTimeoutMs must be a positive integer of at most 2147483647'
        )
      }
    )

    it.each([1, 60_000, 2_147_483_647])('should accept a sendTimeoutMs of %p', (sendTimeoutMs) => {
      expect(() => new SmtpEmailProvider({ host: 'h', sendTimeoutMs })).not.toThrow()
    })

    it('should accept no bound at all', () => {
      expect(() => new SmtpEmailProvider({ host: 'h' })).not.toThrow()
    })
  })
})
