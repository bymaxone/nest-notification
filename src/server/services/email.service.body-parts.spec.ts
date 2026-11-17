/**
 * @fileoverview Holds `EmailService.send` to refusing an html or text part that is not a string
 * before anything is audited or handed to a provider: the echo scrub compares strings, and a
 * transport reads other values (a Buffer, a content descriptor with a path) as content.
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

describe('EmailService.send body parts', () => {
  it.each([
    ['html', { html: Buffer.from('<p>x</p>') }],
    ['html', { html: { path: '/etc/hostname' } }],
    ['text', { text: Buffer.from('x') }],
    ['text', { text: new Uint8Array(2) }],
    ['text', { text: 42 }]
  ])('should refuse a %s part that is not a string', async (part, override) => {
    const provider = makeProvider()
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    const caught: unknown = await service
      .send({ ...baseInput, ...override } as never)
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(NotificationException)
    expect(caught).toMatchObject({ code: 'notification.email_missing_body' })
    expect((caught as NotificationException).getResponse()).toMatchObject({
      error: { details: { part } }
    })
    expect(provider.send).not.toHaveBeenCalled()
    expect(audit.create).not.toHaveBeenCalled()
  })

  // A renderer is host code too: what it returns goes through the same guard.
  it('should refuse a rendered part that is not a string', async () => {
    const provider = makeProvider()
    const renderer = makeRenderer()
    renderer.render.mockResolvedValue({ subject: 'S', html: Buffer.from('<p>x</p>') } as never)
    const service = new EmailService(makeOptions(), provider, renderer, makeAudit())

    const caught: unknown = await service
      .sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'welcome', data: {} })
      .catch((error: unknown) => error)

    expect(caught).toMatchObject({ code: 'notification.email_missing_body' })
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('should still send a text-only message', async () => {
    const provider = makeProvider()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    await service.send({ ...baseInput, html: undefined, text: 'plain' } as never)

    expect(provider.send).toHaveBeenCalledTimes(1)
  })
})
