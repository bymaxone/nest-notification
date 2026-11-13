/**
 * @fileoverview Holds `EmailService` to a bounded number of recipients per message: to, cc and
 * bcc together, counted after splitting the way the transport splits them, refused before the
 * provider is called.
 * @layer application
 */

import { NotificationException } from '../errors/notification-exception'

import {
  baseInput,
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'

const addresses = (count: number, prefix = 'u'): string[] =>
  Array.from({ length: count }, (_, index) => `${prefix}${index}@x.com`)

function setup(maxRecipients?: number) {
  const provider = makeProvider()
  const audit = makeAudit()
  const service = new EmailService(
    makeOptions(maxRecipients === undefined ? {} : { maxRecipients }),
    provider,
    makeRenderer(),
    audit
  )
  return { provider, audit, service }
}

describe('EmailService recipient bound', () => {
  it('should refuse 20000 recipients before the provider is called', async () => {
    const { provider, audit, service } = setup(50)

    await expect(service.send({ ...baseInput, to: addresses(20_000) })).rejects.toMatchObject({
      code: 'notification.email_invalid_recipient'
    })

    expect(provider.send).not.toHaveBeenCalled()
    expect(audit.create).not.toHaveBeenCalled()
  })

  it('should accept exactly the limit and refuse one more', async () => {
    const { provider, service } = setup(50)

    await expect(service.send({ ...baseInput, to: addresses(50) })).resolves.toEqual({
      messageId: 'msg_1'
    })
    await expect(service.send({ ...baseInput, to: addresses(51) })).rejects.toMatchObject({
      code: 'notification.email_invalid_recipient'
    })
    expect(provider.send).toHaveBeenCalledTimes(1)
  })

  // The three fields are one budget: an attacker who spreads a list across them gets no more.
  it('should count to, cc and bcc together, splitting delimited strings', async () => {
    const { provider, service } = setup(50)
    const to = addresses(20)
    const cc = addresses(20, 'c').join(';')
    const bcc = addresses(11, 'b').join(', ')

    await expect(service.send({ ...baseInput, to, cc, bcc })).rejects.toMatchObject({
      code: 'notification.email_invalid_recipient'
    })
    expect(provider.send).not.toHaveBeenCalled()

    await expect(
      service.send({ ...baseInput, to, cc, bcc: addresses(10, 'b').join(', ') })
    ).resolves.toEqual({ messageId: 'msg_1' })
  })

  it('should refuse a single string carrying a list over the limit', async () => {
    const { provider, service } = setup(3)

    await expect(service.send({ ...baseInput, to: addresses(4).join(',') })).rejects.toMatchObject({
      code: 'notification.email_invalid_recipient'
    })
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('should name the limit and the reason, and never an address', async () => {
    const { service } = setup(2)
    let caught: unknown
    try {
      await service.send({
        ...baseInput,
        to: ['secret-1@x.com', 'secret-2@x.com', 'secret-3@x.com']
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ code: 'notification.email_invalid_recipient' })
    expect((caught as NotificationException).getResponse()).toMatchObject({
      error: { details: { reason: 'too_many_recipients', limit: 2 } }
    })
    expect(JSON.stringify(caught)).not.toContain('secret-')
  })

  it('should apply the same bound to a template send', async () => {
    const { provider, service } = setup(2)

    await expect(
      service.sendTemplate({ tenantId: 'acme', to: addresses(3), template: 'welcome', data: {} })
    ).rejects.toMatchObject({ code: 'notification.email_invalid_recipient' })
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('should default the limit to 50 when the option is not set', async () => {
    const { service } = setup()

    await expect(service.send({ ...baseInput, to: addresses(51) })).rejects.toMatchObject({
      code: 'notification.email_invalid_recipient'
    })
  })
})
