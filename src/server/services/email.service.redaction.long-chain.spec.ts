/**
 * @fileoverview Specs for EmailService redaction when the provider's error is very large or its
 * cause chain is very long: an echo past the detector's scan limit is scrubbed whole, field by
 * field, and the failure path stays bounded in time, stack and memory. The ordinary redaction specs
 * live in `email.service.redaction.spec.ts`; shared fixtures in `__tests__/email-service.fixtures.ts`.
 * @layer application
 */

import type { NotificationException } from '../errors/notification-exception'
import * as redact from '../utils/redact'

import {
  baseInput,
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'

describe('EmailService.send redaction of a very large error', () => {
  // An error text longer than the detector's scan limit is scrubbed whole. The chain text the
  // service inspects joins message and stack, so it must be scrubbed field by field: a joined text
  // is a substring of no single field, and nothing would be removed.
  it('should scrub an echo longer than the scan limit from the audit entry and the cause', async () => {
    const provider = makeProvider()
    const body = `<p>${'reset code 998877 '.repeat(5_000)}</p>`
    provider.send.mockImplementation(async (options) => {
      throw new Error(`550 5.7.1 rejected by policy: ${options.html}`)
    })
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    const caught: unknown = await service
      .send({ ...baseInput, html: body })
      .catch((error: unknown) => error)

    const cause = (caught as NotificationException).cause as Error
    expect(cause.message.includes('998877')).toBe(false)
    expect(cause.stack?.includes('998877')).toBe(false)
    expect(JSON.stringify(audit.create.mock.calls)).not.toContain('998877')
  })

  it('should scrub an over-limit echo that lives only in a nested cause', async () => {
    const provider = makeProvider()
    const body = `<p>${'reset code 998877 '.repeat(5_000)}</p>`
    provider.send.mockImplementation(async (options) => {
      throw new Error('relay failed', { cause: new Error(`550 body: ${options.html}`) })
    })
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, html: body })
      .catch((error: unknown) => error)

    const nested = ((caught as NotificationException).cause as Error).cause as Error
    expect(nested.message.includes('998877')).toBe(false)
    expect(nested.stack?.includes('998877')).toBe(false)
  })

  // The echo can sit in the stack, which is a separate field of the same link, and in more than one
  // link of the chain: each field is scrubbed on its own.
  it('should scrub an over-limit echo from a stack and from every link of the chain', async () => {
    const provider = makeProvider()
    const body = `<p>${'reset code 998877 '.repeat(5_000)}</p>`
    provider.send.mockImplementation(async (options) => {
      const inner = new Error('inner failure')
      inner.stack = `Error: inner failure\n    at relay (${options.html})`
      throw new Error(`550 rejected: ${options.html}`, { cause: inner })
    })
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, html: body })
      .catch((error: unknown) => error)

    const outer = (caught as NotificationException).cause as Error
    const inner = outer.cause as Error
    expect(outer.message.includes('998877')).toBe(false)
    expect(outer.stack?.includes('998877')).toBe(false)
    expect(inner.message.includes('998877')).toBe(false)
    expect(inner.stack?.includes('998877')).toBe(false)
  })

  it('should scrub an over-limit echo of the plain-text body as well', async () => {
    const provider = makeProvider()
    const text = 'reset code 998877 '.repeat(5_000)
    provider.send.mockImplementation(async (options) => {
      throw new Error(`550 rejected: ${options.text ?? ''}`)
    })
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, text })
      .catch((error: unknown) => error)

    expect(((caught as NotificationException).cause as Error).message.includes('998877')).toBe(
      false
    )
  })

  // A provider chooses how deep its cause chain is. Scanning each field against the whole body
  // would cost the body's length once per link.
  it('should read a deep cause chain against a large body in time that does not grow per link', async () => {
    const provider = makeProvider()
    const body = `<p>${'lorem ipsum dolor '.repeat(4_500)}</p>`
    provider.send.mockImplementation(async () => {
      let error = new Error('relay link 0 failed with a sizeable message')
      for (let link = 1; link < 400; link += 1) {
        error = new Error(`relay link ${String(link)} failed with a sizeable message`, {
          cause: error
        })
      }
      throw error
    })
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const started = performance.now()
    await service.send({ ...baseInput, html: body }).catch(() => undefined)
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(2_000)
  })

  // The fields past the scan budget come back whole, one value each, and the chain has no length cap
  // of its own: the list of values must be built without spreading it into a call, which overflows
  // the stack at roughly 130000 arguments. The scrub itself is stubbed: it is quadratic in this
  // chain's length and not what the case is about.
  it('should still fail the send cleanly when a very long chain returns many whole fields', async () => {
    const scrub = jest
      .spyOn(redact, 'scrubValuesFromErrorChain')
      .mockImplementation((error) => error)
    const provider = makeProvider()
    provider.send.mockImplementation(async () => {
      let error = new Error('x'.repeat(70_000))
      for (let link = 0; link < 250_000; link += 1) {
        error = new Error(`relay link ${String(link)} message`, { cause: error })
        error.stack = ''
      }
      throw error
    })
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    const caught: unknown = await service
      .send({ ...baseInput, html: '<p>an ordinary body</p>', text: 'an ordinary body' })
      .catch((error: unknown) => error)
    scrub.mockRestore()

    expect(caught).toMatchObject({ code: 'notification.email_send_failed' })
  }, 60_000)
})
