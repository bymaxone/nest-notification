/**
 * @fileoverview Specs for EmailService redaction when the provider's error is very large or its
 * cause chain is very long: a chain past the examined window publishes none of the provider's text,
 * and the failure path costs the same however long the chain is. The ordinary redaction specs live
 * in `email.service.redaction.spec.ts`; shared fixtures in `__tests__/email-service.fixtures.ts`.
 * @layer application
 */

import type { NotificationException } from '../errors/notification-exception'
import { MAX_ERROR_CHAIN_LINKS } from '../utils/redact'

import {
  baseInput,
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'

const LABEL = '[provider text withheld]'
/** A body, and a secret inside it, big enough to pass the detector's scan limit on its own. */
const SECRET = '998877'
const BODY = `<p>${`reset code ${SECRET} `.repeat(5_000)}</p>`

/**
 * Builds a chain of `links` errors, the innermost carrying `inner`. Each stack is one short line,
 * so the size of a chain does not depend on how deep the test runner's own call stack is.
 */
function chainOf(links: number, message: (link: number) => string, inner = 'inner'): Error {
  let error = new Error(inner)
  error.stack = `Error: ${inner}`
  for (let link = 1; link < links; link += 1) {
    const text = message(link)
    error = new Error(text, { cause: error })
    error.stack = `Error: ${text}`
  }
  return error
}

async function sendFailing(
  failure: (html: string) => Error,
  input: { html?: string; text?: string; auditRedactValues?: string[] } = {}
) {
  const provider = makeProvider()
  provider.send.mockImplementation(async (options) => {
    throw failure(options.html)
  })
  const audit = makeAudit()
  const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)
  const caught = (await service
    .send({ ...baseInput, html: BODY, ...input })
    .catch((error: unknown) => error)) as NotificationException
  return { caught, audit }
}

/** Nothing of the body, nor the provider's own words, is on the exception or the audit entry. */
function expectWithheld(caught: NotificationException, audit: ReturnType<typeof makeAudit>): void {
  expect(caught).toMatchObject({ code: 'notification.email_send_failed' })
  expect(caught.cause).toBeUndefined()
  expect(JSON.stringify(caught.getResponse())).not.toContain(SECRET)
  expect(audit.create).toHaveBeenCalledWith(
    expect.objectContaining({
      verb: 'failed',
      errorMessage: LABEL
    })
  )
  expect(JSON.stringify(audit.create.mock.calls)).not.toContain(SECRET)
}

describe('EmailService.send redaction of a very large error', () => {
  // An echo past the detector's scan limit cannot be examined: the whole text is withheld, which
  // can only remove more than needed.
  it('should withhold an echo longer than the scan limit from the audit entry and the cause', async () => {
    const { caught, audit } = await sendFailing((html) => new Error(`550 5.7.1 rejected: ${html}`))

    expectWithheld(caught, audit)
  })

  it('should withhold an over-limit echo that lives only in a nested cause', async () => {
    const { caught, audit } = await sendFailing(
      (html) => new Error('relay failed', { cause: new Error(`550 body: ${html}`) })
    )

    expectWithheld(caught, audit)
  })

  it('should withhold an over-limit echo that lives in a stack', async () => {
    const { caught, audit } = await sendFailing((html) => {
      const error = new Error('relay failed')
      error.stack = `Error: relay failed\n    at relay (${html})`
      return error
    })

    expectWithheld(caught, audit)
  })

  it('should withhold an over-limit echo of the plain-text body as well', async () => {
    const text = `reset code ${SECRET} `.repeat(5_000)
    const { caught, audit } = await sendFailing((_html) => new Error(`550 rejected: ${text}`), {
      text
    })

    expectWithheld(caught, audit)
  })
})

describe('EmailService.send redaction of a very long cause chain', () => {
  it('should read a 5000-link chain with the real scrub in time that does not grow with its length', async () => {
    const started = performance.now()
    const { caught, audit } = await sendFailing(() =>
      chainOf(5_000, (link) => `relay link ${String(link)} failed with a sizeable message`)
    )
    const elapsed = performance.now() - started

    expectWithheld(caught, audit)
    // The chain is built inside this call, so the bound covers building 5000 errors as well; the
    // quadratic scrub this replaced took 33 s.
    expect(elapsed).toBeLessThan(2_000)
  })

  it('should cost the same for a chain of 5000 links as for one just past the window', async () => {
    const time = async (links: number): Promise<number> => {
      const provider = makeProvider()
      const error = chainOf(links, (link) => `relay link ${String(link)} failed with a message`)
      provider.send.mockRejectedValue(error)
      const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())
      const started = performance.now()
      await service.send(baseInput).catch(() => undefined)
      return performance.now() - started
    }

    const short = await time(MAX_ERROR_CHAIN_LINKS + 1)
    const long = await time(5_000)

    expect(long).toBeLessThan(Math.max(short * 20, 100))
  })

  it('should withhold a long chain even when the caller declared values', async () => {
    const { caught, audit } = await sendFailing(
      () => chainOf(5_000, (link) => `relay link ${String(link)} failed`),
      { auditRedactValues: ['declared-secret-1'] }
    )

    expect(caught.cause).toBeUndefined()
    expect(JSON.stringify(audit.create.mock.calls)).toContain(LABEL)
  })

  it('should read exactly as many links as the window allows and no more', async () => {
    const within = await sendFailing(() =>
      chainOf(MAX_ERROR_CHAIN_LINKS, (link) => `link ${String(link)} says ${SECRET} was rejected`)
    )
    const past = await sendFailing(() =>
      chainOf(
        MAX_ERROR_CHAIN_LINKS + 1,
        (link) => `link ${String(link)} says ${SECRET} was rejected`
      )
    )

    // Inside the window the cause is kept, with nothing echoed to scrub; one link past it, withheld.
    expect(within.caught.cause).toBeDefined()
    expect(past.caught.cause).toBeUndefined()
  })

  it('should still publish the reply code found inside the window', async () => {
    const { caught } = await sendFailing(() =>
      chainOf(5_000, (link) =>
        link === 4_990 ? '550 5.7.1 rejected by policy' : 'relay link failed'
      )
    )

    expect(caught.getResponse()).toMatchObject({
      error: { details: { status: 550, enhanced: '5.7.1' } }
    })
  })

  it('should fail cleanly for a chain of 50000 links', async () => {
    const { caught } = await sendFailing(() =>
      chainOf(50_000, (link) => `relay link ${String(link)} failed`)
    )

    expect(caught).toMatchObject({ code: 'notification.email_send_failed' })
  }, 60_000)
})
