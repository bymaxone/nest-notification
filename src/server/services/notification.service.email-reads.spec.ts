/**
 * @fileoverview Holds an email dispatch to reading each field of its payload once, so the field
 * that is checked is the field that is sent.
 * @layer application
 */

import {
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'
import { NotificationService } from './notification.service'

describe('an email dispatch', () => {
  it('should read every field of a raw payload once and send the values it read', async () => {
    const provider = makeProvider()
    const email = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())
    const service = new NotificationService(email, undefined)
    const reads: Record<string, number> = {}
    const payload = {}
    const values: Record<string, unknown> = {
      to: 'a@b.com',
      subject: 'S',
      html: '<p>B</p>',
      text: 'T',
      from: 'x@y.com',
      fromName: 'X',
      replyTo: 'r@y.com',
      tags: [{ name: 'n', value: 'v' }],
      userId: 'u1'
    }
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(payload, key, {
        enumerable: true,
        get() {
          reads[key] = (reads[key] ?? 0) + 1
          return reads[key] === 1 ? value : 'changed'
        }
      })
    }

    await service.dispatch({ channel: 'email', tenantId: 'acme', payload: payload as never })

    expect(Object.values(reads).every((count) => count === 1)).toBe(true)
    expect(provider.send.mock.calls[0]?.[0]).toMatchObject({ subject: 'S', html: '<p>B</p>' })
  })

  it('should read the template of a template payload once', async () => {
    const provider = makeProvider()
    const email = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())
    const service = new NotificationService(email, undefined)
    let reads = 0

    await service.dispatch({
      channel: 'email',
      tenantId: 'acme',
      payload: {
        to: 'a@b.com',
        get template(): string {
          reads += 1
          return reads === 1 ? 'welcome' : 'other'
        }
      }
    })

    expect(reads).toBe(1)
  })
})
