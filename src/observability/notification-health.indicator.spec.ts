/**
 * @fileoverview Holds the readiness check to the README's "Health" section: it reports up or down
 * with no detail, never sends a message, verifies a transport at most once per window and shares one
 * verification between callers that arrive together, bounds the verification with a timeout, and
 * trusts a failure for a shorter window than a success.
 * @layer observability
 */

import { BYMAX_HEALTH_INDICATOR_METADATA } from '@bymax-one/nest-core/health'

import type {
  EmailSendOptions,
  IEmailProvider
} from '../server/interfaces/email-provider.interface'

import { NOTIFICATION_HEALTH_NAME } from './constants'
import { NotificationHealthIndicator } from './notification-health.indicator'

interface FakeProvider extends IEmailProvider {
  verify: jest.Mock<Promise<void>, []>
  send: jest.Mock<Promise<{ messageId: string }>, [EmailSendOptions]>
}

const provider = (configured = true): FakeProvider => ({
  name: 'relay',
  isConfigured: () => configured,
  send: jest.fn(async (_options: EmailSendOptions) => ({ messageId: 'm' })),
  verify: jest.fn(async () => undefined)
})

const OPTIONS = { successTtlMs: 1000, failureTtlMs: 100, timeoutMs: 50 }

describe('NotificationHealthIndicator', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('should be marked as a health indicator and named', () => {
    expect(Reflect.getMetadata(BYMAX_HEALTH_INDICATOR_METADATA, NotificationHealthIndicator)).toBe(
      true
    )
    expect(new NotificationHealthIndicator().name).toBe(NOTIFICATION_HEALTH_NAME)
  })

  it('should be up with nothing to check when the email channel is not configured', async () => {
    await expect(new NotificationHealthIndicator(undefined, OPTIONS).check()).resolves.toEqual({
      status: 'up'
    })
  })

  it('should be down, without verifying, when the provider is not configured', async () => {
    const relay = provider(false)

    await expect(new NotificationHealthIndicator(relay, OPTIONS).check()).resolves.toEqual({
      status: 'down'
    })

    expect(relay.verify).not.toHaveBeenCalled()
  })

  it('should be up once the transport has been verified, and say nothing else', async () => {
    const result = await new NotificationHealthIndicator(provider(), OPTIONS).check()

    expect(result).toEqual({ status: 'up' })
    expect(Object.keys(result)).toEqual(['status'])
  })

  it('should be up for a provider that cannot verify, since configured is all it can know', async () => {
    const { verify: _verify, ...resend } = provider()

    await expect(
      new NotificationHealthIndicator(resend as IEmailProvider, OPTIONS).check()
    ).resolves.toEqual({ status: 'up' })
  })

  it('should never send a message', async () => {
    const relay = provider()
    const indicator = new NotificationHealthIndicator(relay, OPTIONS)

    await indicator.check()
    jest.advanceTimersByTime(5000)
    await indicator.check()

    expect(relay.send).not.toHaveBeenCalled()
  })

  it('should verify once while the answer is fresh, and again when it is not', async () => {
    const relay = provider()
    const indicator = new NotificationHealthIndicator(relay, OPTIONS)

    await indicator.check()
    await indicator.check()
    jest.advanceTimersByTime(999)
    await indicator.check()
    expect(relay.verify).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(2)
    await indicator.check()
    expect(relay.verify).toHaveBeenCalledTimes(2)
  })

  it('should verify again exactly when the success window ends', async () => {
    const relay = provider()
    const indicator = new NotificationHealthIndicator(relay, OPTIONS)

    await indicator.check()
    jest.advanceTimersByTime(OPTIONS.successTtlMs)
    await indicator.check()

    expect(relay.verify).toHaveBeenCalledTimes(2)
  })

  it('should leave no timer running once the verification has answered', async () => {
    const indicator = new NotificationHealthIndicator(provider(), OPTIONS)

    await indicator.check()

    expect(jest.getTimerCount()).toBe(0)
  })

  it('should share one verification between callers that arrive together', async () => {
    const relay = provider()
    const indicator = new NotificationHealthIndicator(relay, OPTIONS)

    await Promise.all([indicator.check(), indicator.check(), indicator.check()])

    expect(relay.verify).toHaveBeenCalledTimes(1)
  })

  it('should be down when the relay does not answer, and try again after the short window', async () => {
    const relay = provider()
    relay.verify.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    const indicator = new NotificationHealthIndicator(relay, OPTIONS)

    await expect(indicator.check()).resolves.toEqual({ status: 'down' })
    await expect(indicator.check()).resolves.toEqual({ status: 'down' })
    expect(relay.verify).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(101)
    await expect(indicator.check()).resolves.toEqual({ status: 'up' })
    expect(relay.verify).toHaveBeenCalledTimes(2)
  })

  it('should be down when the verification takes longer than the timeout', async () => {
    const relay = provider()
    relay.verify.mockImplementation(() => new Promise<void>(() => undefined))
    const indicator = new NotificationHealthIndicator(relay, OPTIONS)

    const pending = indicator.check()
    jest.advanceTimersByTime(51)

    await expect(pending).resolves.toEqual({ status: 'down' })
  })

  it('should use the documented windows when none are given', async () => {
    const relay = provider()
    const indicator = new NotificationHealthIndicator(relay)

    await indicator.check()
    jest.advanceTimersByTime(299_999)
    await indicator.check()
    expect(relay.verify).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(2)
    await indicator.check()
    expect(relay.verify).toHaveBeenCalledTimes(2)
  })

  it('should bound the verification by the documented timeout when none is given', async () => {
    const relay = provider()
    relay.verify.mockImplementation(() => new Promise<void>(() => undefined))

    const pending = new NotificationHealthIndicator(relay).check()
    jest.advanceTimersByTime(4001)

    await expect(pending).resolves.toEqual({ status: 'down' })
  })

  it('should trust a failure for the documented short window when none is given', async () => {
    const relay = provider()
    relay.verify.mockRejectedValue(new Error('down'))
    const indicator = new NotificationHealthIndicator(relay)

    await indicator.check()
    jest.advanceTimersByTime(29_999)
    await indicator.check()
    expect(relay.verify).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(2)
    await indicator.check()
    expect(relay.verify).toHaveBeenCalledTimes(2)
  })
})
