/**
 * @fileoverview Holds the observer helpers to never changing the operation they describe: a span
 * that fails before, during or after the operation neither stops it from running nor replaces its
 * result or its own error, and an event callback that throws is ignored.
 * @layer utils
 */

import type { INotificationObserver } from '../interfaces/notification-observer.interface'

import { reportOtp, reportSend, runInSpan } from './observe'

const SPAN = ['notification.send', { channel: 'email' }] as const

describe('runInSpan', () => {
  it('should run the operation plainly when the observer has no span', async () => {
    const run = jest.fn(async () => 'done')

    await expect(runInSpan(undefined, SPAN[0], SPAN[1], run)).resolves.toBe('done')
    await expect(runInSpan({}, SPAN[0], SPAN[1], run)).resolves.toBe('done')

    expect(run).toHaveBeenCalledTimes(2)
  })

  it('should return what the operation returns through the span, once', async () => {
    const run = jest.fn(async () => 'done')
    const observer: INotificationObserver = { span: async (_name, _attributes, inner) => inner() }

    await expect(runInSpan(observer, SPAN[0], SPAN[1], run)).resolves.toBe('done')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('should run the operation itself when the span fails before running it', async () => {
    const run = jest.fn(async () => 'done')
    const observer: INotificationObserver = {
      span: () => {
        throw new Error('span broke')
      }
    }

    await expect(runInSpan(observer, SPAN[0], SPAN[1], run)).resolves.toBe('done')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('should run the operation itself when the span rejects without running it', async () => {
    const run = jest.fn(async () => 'done')
    const observer: INotificationObserver = { span: async () => Promise.reject(new Error('no')) }

    await expect(runInSpan(observer, SPAN[0], SPAN[1], run)).resolves.toBe('done')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('should return the operation result when the span fails after it succeeded', async () => {
    const run = jest.fn(async () => 'done')
    const observer: INotificationObserver = {
      span: async (_name, _attributes, inner) => {
        await inner()
        throw new Error('span broke at the end')
      }
    }

    await expect(runInSpan(observer, SPAN[0], SPAN[1], run)).resolves.toBe('done')

    expect(run).toHaveBeenCalledTimes(1)
  })

  it('should rethrow the operation own error, not the one a span made of it', async () => {
    const failure = new Error('the operation failed')
    const observer: INotificationObserver = {
      span: async (_name, _attributes, inner) => {
        try {
          return await inner()
        } catch {
          throw new Error('span wrapped it')
        }
      }
    }

    await expect(
      runInSpan(observer, SPAN[0], SPAN[1], async () => {
        throw failure
      })
    ).rejects.toBe(failure)
  })

  // Every ordering of what the span does with the operation, one case each; the outcome is always
  // the operation's own, and the operation runs exactly once.
  const ORDERINGS: ReadonlyArray<{
    readonly label: string
    readonly span: NonNullable<INotificationObserver['span']>
  }> = [
    { label: 'resolves without running it', span: async () => undefined as never },
    { label: 'resolves another value without running it', span: async () => 'other' as never },
    { label: 'rejects without running it', span: async () => Promise.reject(new Error('no')) },
    {
      label: 'runs it and returns another value',
      span: async (_name, _attributes, inner) => {
        await inner().catch(() => undefined)
        return 'other' as never
      }
    },
    {
      label: 'runs it twice',
      span: async (_name, _attributes, inner) => {
        await inner().catch(() => undefined)
        return inner()
      }
    },
    {
      label: 'resolves while the operation is still running',
      span: (_name, _attributes, inner) => {
        void inner().catch(() => undefined)
        return Promise.resolve('other' as never)
      }
    }
  ]

  describe.each(ORDERINGS)('when the span $label', ({ span }) => {
    it('should return the operation result and run it once', async () => {
      const run = jest.fn(async () => {
        await Promise.resolve()
        return 'done'
      })

      await expect(runInSpan({ span }, SPAN[0], SPAN[1], run)).resolves.toBe('done')

      expect(run).toHaveBeenCalledTimes(1)
    })

    it('should rethrow the operation own error and run it once', async () => {
      const failure = new Error('the operation failed')
      const run = jest.fn(async () => {
        await Promise.resolve()
        throw failure
      })

      await expect(runInSpan({ span }, SPAN[0], SPAN[1], run)).rejects.toBe(failure)

      expect(run).toHaveBeenCalledTimes(1)
    })
  })

  it('should rethrow the operation own error when the span lets it through', async () => {
    const failure = new Error('the operation failed')
    const observer: INotificationObserver = { span: async (_n, _a, inner) => inner() }

    await expect(
      runInSpan(observer, SPAN[0], SPAN[1], async () => {
        throw failure
      })
    ).rejects.toBe(failure)
  })
})

describe('reportSend and reportOtp', () => {
  it('should tell the observer and ignore one that throws', () => {
    const onSend = jest.fn()
    const onOtp = jest.fn()
    const throwing: INotificationObserver = {
      onSend: () => {
        throw new Error('broke')
      },
      onOtp: () => {
        throw new Error('broke')
      }
    }

    reportSend({ onSend }, { channel: 'email', outcome: 'sent', seconds: 1 })
    reportOtp({ onOtp }, { event: 'issued' })

    expect(onSend).toHaveBeenCalledWith({ channel: 'email', outcome: 'sent', seconds: 1 })
    expect(onOtp).toHaveBeenCalledWith({ event: 'issued' })
    expect(() => {
      reportSend(throwing, { channel: 'email', outcome: 'sent', seconds: 1 })
      reportOtp(throwing, { event: 'issued' })
      reportSend(undefined, { channel: 'email', outcome: 'sent', seconds: 1 })
      reportOtp({}, { event: 'issued' })
    }).not.toThrow()
  })
})
