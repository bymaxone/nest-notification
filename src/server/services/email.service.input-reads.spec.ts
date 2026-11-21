/**
 * @fileoverview Holds a send to reading what the caller gave once and before anything uses it:
 * the template path included, the byte budget measured on what the transport will send, and the
 * address a relay quotes in a failure never reaching the audit row unmasked.
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

const template = { tenantId: 'acme', to: 'a@b.com', template: 'welcome', data: {} }

function service(options = makeOptions(), provider = makeProvider(), renderer = makeRenderer()) {
  const audit = makeAudit()
  return {
    provider,
    renderer,
    audit,
    service: new EmailService(options, provider, renderer, audit)
  }
}

describe('the failed audit row of a send', () => {
  it.each([
    ['to', { to: 'bob@x.com' }],
    ['cc', { cc: ['bob@x.com'] }],
    ['bcc', { bcc: 'carol@y.org; bob@x.com' }]
  ])(
    'should mask an address of %s quoted by the relay, in any letter case',
    async (_field, extra) => {
      const {
        provider,
        audit,
        service: email
      } = service(makeOptions({}, { maskRecipient: (r: string) => `masked(${r.length})` }))
      provider.send.mockRejectedValue(new Error('550 <Bob@X.com> unknown user'))

      await email.send({ ...baseInput, to: 'someone@z.net', ...extra }).catch(() => undefined)

      const failed = audit.create.mock.calls.map((call) => call[0]).find((e) => e.verb === 'failed')
      expect(failed?.errorMessage).toBe('550 <masked(9)> unknown user')
    }
  )
})

describe('the byte budget of an attachment', () => {
  it.each([
    ['an own length of zero', 'length'],
    ['an own byteLength of zero', 'byteLength']
  ])('should measure the bytes of a Buffer with %s', async (_label, property) => {
    const content = Buffer.alloc(2_000)
    Object.defineProperty(content, property, { value: 0 })
    const { provider, service: email } = service(makeOptions({ maxAttachmentBytes: 100 }))

    const caught: unknown = await email
      .send({ ...baseInput, attachments: [{ filename: 'f', content }] })
      .catch((error: unknown) => error)

    expect((caught as NotificationException).code).toBe('notification.email_attachments_too_large')
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('should measure a string by its bytes', async () => {
    const { service: email } = service(makeOptions({ maxAttachmentBytes: 5 }))

    const caught: unknown = await email
      .send({ ...baseInput, attachments: [{ filename: 'f', content: 'ééé' }] })
      .catch((error: unknown) => error)

    expect((caught as NotificationException).code).toBe('notification.email_attachments_too_large')
  })
})

describe('a template send reads its input first', () => {
  it('should refuse a list over the bound before the renderer is asked', async () => {
    const { renderer, service: email } = service()

    const caught: unknown = await email
      .sendTemplate({ ...template, auditRedactValues: new Array<string>(1001).fill('a') })
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(NotificationException)
    expect(renderer.render).not.toHaveBeenCalled()
  })

  it('should read the tags once, so the provider gets the tags that were checked', async () => {
    let reads = 0
    const tags = [{ name: 'n', value: 'v' }]
    const { provider, service: email } = service()

    await email.sendTemplate({
      ...template,
      get tags() {
        reads += 1
        return reads === 1 ? tags : [{ name: 'other', value: 'x' }]
      }
    })

    expect(reads).toBe(1)
    expect(provider.send.mock.calls[0]?.[0].tags).toEqual([
      { name: 'n', value: 'v' },
      { name: 'template', value: 'welcome' }
    ])
  })

  it('should keep the controls of a template input that comes from a class', async () => {
    class FromClass {
      tenantId = 'acme'
      to = 'a@b.com'
      template = 'welcome'
      data = {}
      get publishProviderText(): boolean {
        return false
      }
    }
    const { provider, service: email } = service()
    provider.send.mockRejectedValue(new Error('provider text'))

    const caught: unknown = await email.sendTemplate(new FromClass()).catch((e: unknown) => e)

    expect(JSON.stringify((caught as NotificationException).getResponse())).not.toContain(
      'provider text'
    )
  })

  describe('an input that cannot be read', () => {
    it('should fail the send with the provider name in its details and the reader error as its cause', async () => {
      const { provider, service: email } = service()
      const input = {
        ...baseInput,
        get html(): string {
          throw new TypeError('getter of the caller')
        }
      }

      const caught = (await email
        .send(input)
        .catch((error: unknown) => error)) as NotificationException

      expect(caught.code).toBe('notification.email_send_failed')
      expect(caught.getResponse()).toMatchObject({ error: { details: { providerName: 'resend' } } })
      expect((caught.cause as Error).message).toBe('getter of the caller')
      expect(provider.send).not.toHaveBeenCalled()
    })
  })
})

describe('a template send with the most tags the caller may pass', () => {
  it('should send 1000 tags of the caller and the tag of the template, 1001 in all', async () => {
    const { provider, service: email } = service()
    const tags = Array.from({ length: 1000 }, (_, i) => ({ name: `t${String(i)}`, value: 'v' }))

    await email.sendTemplate({ ...template, tags })

    expect(provider.send.mock.calls[0]?.[0].tags).toHaveLength(1001)
  })

  it('should still refuse 1001 tags of the caller', async () => {
    const { renderer, service: email } = service()
    const tags = Array.from({ length: 1001 }, (_, i) => ({ name: `t${String(i)}`, value: 'v' }))

    const caught: unknown = await email.sendTemplate({ ...template, tags }).catch((e: unknown) => e)

    expect(caught).toBeInstanceOf(NotificationException)
    expect(renderer.render).not.toHaveBeenCalled()
  })
})
