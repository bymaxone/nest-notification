/**
 * @fileoverview Holds EmailService to reporting every send to the observer: once, with the closed
 * outcome and the channel, inside the span, and without an observer that throws ever changing what
 * the send returns or throws.
 * @layer application
 */

import { NotificationException } from '../errors/notification-exception'
import type { INotificationObserver } from '../interfaces/notification-observer.interface'

import {
  baseInput,
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'

/** An observer that records what it is told, running the operation inside its "span". */
function recorder(): jest.Mocked<Required<INotificationObserver>> & { order: string[] } {
  const order: string[] = []
  const observer = {
    order,
    onSend: jest.fn(() => {
      order.push('onSend')
    }),
    onOtp: jest.fn(),
    span: jest.fn(async (_name, _attributes, run) => {
      order.push('span:start')
      try {
        return await run()
      } finally {
        order.push('span:end')
      }
    })
  }
  return observer as never
}

const build = (observer?: INotificationObserver, audit = makeAudit()): EmailService =>
  new EmailService(makeOptions(), makeProvider(), makeRenderer(), audit, observer)

describe('EmailService observer', () => {
  it('should report the time a send took, in seconds', async () => {
    const observer = recorder()
    const clock = jest
      .spyOn(process.hrtime, 'bigint')
      .mockReturnValueOnce(1_000_000_000n)
      .mockReturnValueOnce(3_500_000_000n)

    await build(observer).send(baseInput)
    clock.mockRestore()

    expect(observer.onSend).toHaveBeenCalledWith(expect.objectContaining({ seconds: 2.5 }))
  })

  it('should report one sent send, with the channel and a duration, inside a span', async () => {
    const observer = recorder()

    await build(observer).send(baseInput)

    expect(observer.span).toHaveBeenCalledWith(
      'notification.send',
      { channel: 'email' },
      expect.any(Function)
    )
    expect(observer.onSend).toHaveBeenCalledTimes(1)
    expect(observer.onSend).toHaveBeenCalledWith({
      channel: 'email',
      outcome: 'sent',
      seconds: expect.any(Number)
    })
    const seconds = observer.onSend.mock.calls[0]?.[0].seconds ?? -1
    expect(seconds).toBeGreaterThanOrEqual(0)
    // The outcome is known only when the span has ended.
    expect(observer.order).toEqual(['span:start', 'span:end', 'onSend'])
  })

  it('should report a provider failure as failed and still throw it', async () => {
    const observer = recorder()
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('relay down'))
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit(), observer)

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.email_send_failed'
    })

    expect(observer.onSend).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
    expect(observer.onSend).toHaveBeenCalledTimes(1)
  })

  it('should report a send the library refused as rejected, without calling the provider', async () => {
    const observer = recorder()
    const provider = makeProvider()
    const service = new EmailService(
      makeOptions({ maxAttachmentBytes: 1 }),
      provider,
      makeRenderer(),
      makeAudit(),
      observer
    )

    await expect(
      service.send({ ...baseInput, attachments: [{ filename: 'big', content: 'toolong' }] })
    ).rejects.toBeInstanceOf(NotificationException)

    expect(observer.onSend).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'rejected' }))
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('should report a delivered message as sent when only the audit write then fails', async () => {
    const observer = recorder()
    const audit = makeAudit()
    audit.create.mockRejectedValue(new Error('audit down'))
    const service = new EmailService(
      makeOptions({}, { swallowErrors: false }),
      makeProvider(),
      makeRenderer(),
      audit,
      observer
    )

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.audit_log_failed'
    })

    expect(observer.onSend).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'sent' }))
  })

  // The provider did not accept the message, and then the audit write of that failure failed too: the
  // error the caller gets is the audit one, but the message was not delivered.
  it('should report a provider failure as failed even when its audit write then fails', async () => {
    const observer = recorder()
    const provider = makeProvider()
    provider.send.mockRejectedValue(new Error('relay down'))
    const audit = makeAudit()
    audit.create.mockRejectedValue(new Error('audit down'))
    const service = new EmailService(
      makeOptions({}, { swallowErrors: false }),
      provider,
      makeRenderer(),
      audit,
      observer
    )

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.audit_log_failed'
    })

    expect(observer.onSend).toHaveBeenCalledTimes(1)
    expect(observer.onSend).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
  })

  it('should report a failure that is not a NotificationException as failed', async () => {
    const observer = recorder()
    const provider = makeProvider()
    // The renderer's failure is converted; a provider that throws something odd is too. Reach the
    // non-library path with a property getter on the input that throws a plain error.
    const input = {
      ...baseInput,
      get to(): never {
        throw new TypeError('hostile input')
      }
    }
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit(), observer)

    await expect(service.send(input as never)).rejects.toBeInstanceOf(TypeError)

    expect(observer.onSend).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed' }))
  })

  it('should report one send for a template send, not two', async () => {
    const observer = recorder()
    const renderer = makeRenderer()

    await new EmailService(makeOptions(), makeProvider(), renderer, makeAudit(), observer)
      .sendTemplate({ tenantId: 't', to: 'jane@acme.com', template: 'welcome', data: {} })
      .catch(() => undefined)

    expect(observer.onSend).toHaveBeenCalledTimes(1)
    expect(observer.span).toHaveBeenCalledTimes(1)
  })

  it('should report a template that does not resolve as rejected', async () => {
    const observer = recorder()
    const renderer = makeRenderer()
    renderer.hasTemplate.mockResolvedValue(false)

    await expect(
      new EmailService(makeOptions(), makeProvider(), renderer, makeAudit(), observer).sendTemplate(
        {
          tenantId: 't',
          to: 'jane@acme.com',
          template: 'missing',
          data: {}
        }
      )
    ).rejects.toMatchObject({ code: 'notification.template_not_found' })

    expect(observer.onSend).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'rejected' }))
  })

  it('should not let an observer that throws change what the send returns', async () => {
    const throwing: INotificationObserver = {
      onSend: () => {
        throw new Error('observer broke')
      }
    }

    await expect(build(throwing).send(baseInput)).resolves.toEqual({ messageId: 'msg_1' })
  })

  it('should still send, once, when the observer span throws before running it', async () => {
    const provider = makeProvider()
    const observer: INotificationObserver = {
      span: () => {
        throw new Error('span broke')
      },
      onSend: jest.fn()
    }
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit(), observer)

    await expect(service.send(baseInput)).resolves.toEqual({ messageId: 'msg_1' })

    expect(provider.send).toHaveBeenCalledTimes(1)
    expect(observer.onSend).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'sent' }))
  })

  it('should send without an observer and with one that has no span', async () => {
    await expect(build(undefined).send(baseInput)).resolves.toEqual({ messageId: 'msg_1' })
    const onSend = jest.fn()
    await build({ onSend }).send(baseInput)

    expect(onSend).toHaveBeenCalledTimes(1)
  })
})
