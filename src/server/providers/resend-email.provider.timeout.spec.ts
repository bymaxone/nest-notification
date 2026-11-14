/**
 * @fileoverview Holds `ResendEmailProvider` to a bound on every send: a relay that never answers,
 * or answers and stalls, fails the call at `timeoutMs` instead of holding the request for as long
 * as the platform's own socket defaults allow. The send, failure and redaction specs live in
 * `resend-email.provider.spec.ts`.
 * @layer infrastructure
 */

import { getEventListeners } from 'node:events'

import { Logger } from '@nestjs/common'

import type { EmailSendOptions } from '../interfaces/email-provider.interface'

import { ResendEmailProvider } from './resend-email.provider'

const mockSend = jest.fn()
const mockResendCtor = jest.fn()

jest.mock('resend', () => ({ __esModule: true, Resend: mockResendCtor }), { virtual: true })

const baseOptions: EmailSendOptions = {
  to: 'jane@acme.com',
  from: 'noreply@acme.com',
  subject: 'Your code',
  html: '<p>Secret 123456</p>'
}

/** A send that settles only when it is aborted, the way the SDK's fetch does. */
function abortable(): (payload: unknown, options?: { signal?: AbortSignal }) => Promise<never> {
  return (_payload, options) =>
    new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => {
        reject(new Error('The operation was aborted due to timeout'))
      })
    })
}

describe('ResendEmailProvider timeout', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    mockResendCtor.mockImplementation(() => ({ emails: { send: mockSend } }))
    mockSend.mockReset()
    mockSend.mockResolvedValue({ data: { id: 'msg_123' }, error: null })
  })

  it('should fail a send that never answers at the bound', async () => {
    mockSend.mockImplementation(() => new Promise(() => undefined))
    const provider = new ResendEmailProvider({ apiKey: 'k', timeoutMs: 50 })

    const started = performance.now()
    await expect(provider.send(baseOptions)).rejects.toThrow(
      'Resend send failed: Resend request timed out after 50 ms'
    )

    expect(performance.now() - started).toBeLessThan(1_000)
  })

  it('should pass the SDK a signal that aborts at the bound', async () => {
    mockSend.mockImplementation(abortable())
    const provider = new ResendEmailProvider({ apiKey: 'k', timeoutMs: 40 })

    await expect(provider.send(baseOptions)).rejects.toThrow(/timed out after 40 ms/)

    const signal = (mockSend.mock.calls[0]?.[1] as { signal: AbortSignal }).signal
    expect(signal.aborted).toBe(true)
  })

  // A client that aborts on the signal rejects with its own error; the provider names the cause.
  it('should report the bound, not the SDK abort error, when the SDK aborts first', async () => {
    mockSend.mockImplementation(abortable())

    const caught: unknown = await new ResendEmailProvider({ apiKey: 'k', timeoutMs: 30 })
      .send(baseOptions)
      .catch((error: unknown) => error)

    expect(String((caught as Error).message)).toBe(
      'Resend send failed: Resend request timed out after 30 ms'
    )
  })

  it('should not delay or alter a send that answers in time', async () => {
    const provider = new ResendEmailProvider({ apiKey: 'k', timeoutMs: 5_000 })

    await expect(provider.send(baseOptions)).resolves.toEqual({ messageId: 'msg_123' })
  })

  it('should default the bound to 15 seconds', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout')

    await new ResendEmailProvider({ apiKey: 'k' }).send(baseOptions)

    expect(timeout).toHaveBeenCalledWith(15_000)
  })

  it('should apply the configured bound to every send', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout')
    const provider = new ResendEmailProvider({ apiKey: 'k', timeoutMs: 2_500 })

    await provider.send(baseOptions)
    await provider.send(baseOptions)

    expect(timeout.mock.calls).toEqual([[2_500], [2_500]])
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31, '5000'])(
    'should refuse a timeoutMs of %p',
    (timeoutMs) => {
      expect(
        () => new ResendEmailProvider({ apiKey: 'k', timeoutMs: timeoutMs as unknown as number })
      ).toThrow('ResendEmailProvider: timeoutMs must be a positive integer of at most 2147483647')
    }
  )

  // The SDK promise outlives the call that gave up on it: its late outcome must not surface.
  it('should not raise an unhandled rejection when the SDK settles after the bound', async () => {
    const unhandled = jest.fn()
    process.on('unhandledRejection', unhandled)
    mockSend.mockImplementation(
      () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error('late')), 80))
    )

    await expect(
      new ResendEmailProvider({ apiKey: 'k', timeoutMs: 20 }).send(baseOptions)
    ).rejects.toThrow(/timed out/)
    await new Promise((resolve) => setTimeout(resolve, 150))
    process.off('unhandledRejection', unhandled)

    expect(unhandled).not.toHaveBeenCalled()
  })

  it('should keep the key and the body out of the timeout failure and its log line', async () => {
    mockSend.mockImplementation(() => new Promise(() => undefined))
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)

    const caught: unknown = await new ResendEmailProvider({ apiKey: 're_SECRETKEY', timeoutMs: 20 })
      .send(baseOptions)
      .catch((error: unknown) => error)

    expect(String((caught as Error).message)).not.toMatch(/re_SECRETKEY|123456/)
    expect(String(warn.mock.calls[0]?.[0])).toBe(
      '[RESEND_SEND_FAILED] Resend request timed out after 20 ms'
    )
  })

  // Node clamps a longer timer to 1 ms (TimeoutOverflowWarning), so 2^31 would abort at once.
  it('should accept the largest bound a timer holds and pass it through unchanged', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout')

    await new ResendEmailProvider({ apiKey: 'k', timeoutMs: 2_147_483_647 }).send(baseOptions)

    expect(timeout).toHaveBeenCalledWith(2_147_483_647)
  })

  it('should leave no abort listener behind after a send that answers in time', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout')

    await new ResendEmailProvider({ apiKey: 'k' }).send(baseOptions)

    const signal = timeout.mock.results[0]?.value as AbortSignal
    expect(getEventListeners(signal, 'abort')).toHaveLength(0)
  })

  it('should leave no abort listener behind after a send the SDK rejects', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout')
    mockSend.mockRejectedValue(new Error('rate limited'))

    await new ResendEmailProvider({ apiKey: 'k' }).send(baseOptions).catch(() => undefined)

    const signal = timeout.mock.results[0]?.value as AbortSignal
    expect(getEventListeners(signal, 'abort')).toHaveLength(0)
  })

  // The listener that raced the SDK goes when it fires, for a call that never settles as well.
  it('should leave no abort listener behind after a send that timed out', async () => {
    const timeout = jest.spyOn(AbortSignal, 'timeout')
    mockSend.mockImplementation(() => new Promise(() => undefined))

    await new ResendEmailProvider({ apiKey: 'k', timeoutMs: 20 })
      .send(baseOptions)
      .catch(() => undefined)

    const signal = timeout.mock.results[0]?.value as AbortSignal
    expect(getEventListeners(signal, 'abort')).toHaveLength(0)
  })

  it('should accept a bound of one millisecond', () => {
    expect(() => new ResendEmailProvider({ apiKey: 'k', timeoutMs: 1 })).not.toThrow()
  })
})

describe('ResendEmailProvider failure codes', () => {
  beforeEach(() => {
    jest.restoreAllMocks()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    mockResendCtor.mockImplementation(() => ({ emails: { send: mockSend } }))
    mockSend.mockReset()
  })

  // The status the service answers with is read off this code, so the provider has to set it.
  it('should carry ETIMEDOUT on a send that timed out', async () => {
    mockSend.mockImplementation(() => new Promise(() => undefined))

    const caught: unknown = await new ResendEmailProvider({ apiKey: 'k', timeoutMs: 20 })
      .send(baseOptions)
      .catch((error: unknown) => error)

    expect((caught as { code?: string }).code).toBe('ETIMEDOUT')
  })

  // What the real SDK 6.38.1 returned for a closed port and for an HTTP 503.
  it.each([
    [
      'a request that could not be made',
      {
        name: 'application_error',
        statusCode: null,
        message: 'Unable to fetch data. The request could not be resolved.'
      }
    ],
    ['an HTTP 503', { name: 'service_unavailable', message: 'down', statusCode: 503 }],
    ['an HTTP 500', { name: 'internal_server_error', message: 'oops', statusCode: 500 }]
  ])('should carry EUNAVAILABLE for %s', async (_name, error) => {
    mockSend.mockResolvedValue({ data: null, error })

    const caught: unknown = await new ResendEmailProvider({ apiKey: 'k' })
      .send(baseOptions)
      .catch((thrown: unknown) => thrown)

    expect((caught as { code?: string }).code).toBe('EUNAVAILABLE')
  })

  it.each([
    ['a validation error', { name: 'validation_error', message: 'bad from', statusCode: 422 }],
    ['an authentication failure', { name: 'missing_api_key', message: 'no key', statusCode: 401 }],
    ['a rate limit', { name: 'rate_limit_exceeded', message: 'slow down', statusCode: 429 }]
  ])('should carry no availability code for %s', async (_name, error) => {
    mockSend.mockResolvedValue({ data: null, error })

    const caught: unknown = await new ResendEmailProvider({ apiKey: 'k' })
      .send(baseOptions)
      .catch((thrown: unknown) => thrown)

    expect((caught as { code?: string }).code).toBeUndefined()
  })

  it('should carry the code of a network error the SDK rejects with', async () => {
    mockSend.mockRejectedValue(Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }))

    const caught: unknown = await new ResendEmailProvider({ apiKey: 'k' })
      .send(baseOptions)
      .catch((thrown: unknown) => thrown)

    expect((caught as { code?: string }).code).toBe('ECONNREFUSED')
  })

  it('should not carry an arbitrary code, only a short token', async () => {
    mockSend.mockRejectedValue(Object.assign(new Error('x'), { code: 'user jane@acme.com 998877' }))

    const caught: unknown = await new ResendEmailProvider({ apiKey: 'k' })
      .send(baseOptions)
      .catch((thrown: unknown) => thrown)

    expect((caught as { code?: string }).code).toBeUndefined()
  })

  it('should carry no code when reading the SDK error object throws', async () => {
    const hostile = {
      message: 'x',
      get statusCode(): number {
        throw new Error('nope')
      }
    }
    mockSend.mockResolvedValue({ data: null, error: hostile })

    const caught: unknown = await new ResendEmailProvider({ apiKey: 'k' })
      .send(baseOptions)
      .catch((thrown: unknown) => thrown)

    expect((caught as { code?: string }).code).toBeUndefined()
  })
})
