/**
 * @fileoverview Holds `EmailService` to the status of a failed send: a provider that cannot be
 * reached or timed out is 503, a provider that answered and refused is 502, and the code stays
 * `email_send_failed` either way so a host that branches on it is unaffected.
 * @layer application
 */

import { HttpStatus } from '@nestjs/common'

import type { NotificationException } from '../errors/notification-exception'

import {
  baseInput,
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'

const coded = (code: string): Error => Object.assign(new Error('relay said something'), { code })

async function failWith(
  error: unknown,
  input: Partial<typeof baseInput> & { publishProviderText?: boolean } = {}
) {
  const provider = makeProvider()
  provider.send.mockRejectedValue(error)
  const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())
  return (await service
    .send({ ...baseInput, ...input })
    .catch((thrown: unknown) => thrown)) as NotificationException
}

describe('EmailService status of a failed send', () => {
  it.each(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNECTION', 'EUNAVAILABLE'])(
    'should answer 503 when the provider failed with %s',
    async (code) => {
      const caught = await failWith(coded(code))

      expect(caught).toMatchObject({ code: 'notification.email_send_failed' })
      expect(caught.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE)
    }
  )

  it('should answer 503 when the unavailability is in the cause of the provider error', async () => {
    const caught = await failWith(new Error('SMTP send failed', { cause: coded('ECONNREFUSED') }))

    expect(caught.getStatus()).toBe(503)
  })

  it.each([
    ['a rejection with no code', new Error('550 5.7.1 rejected by policy')],
    ['an authentication failure', coded('EAUTH')],
    ['a non-Error', 'boom']
  ])('should answer 502 for %s', async (_name, error) => {
    const caught = await failWith(error)

    expect(caught).toMatchObject({ code: 'notification.email_send_failed' })
    expect(caught.getStatus()).toBe(HttpStatus.BAD_GATEWAY)
  })

  // The withheld path builds the exception on its own.
  it('should answer 503 on the withheld path as well', async () => {
    const caught = await failWith(coded('ETIMEDOUT'), { publishProviderText: false })

    expect(caught).toMatchObject({ code: 'notification.email_send_failed' })
    expect(caught.getStatus()).toBe(503)
  })

  it('should answer 502 on the withheld path for a refusal', async () => {
    const caught = await failWith(new Error('550 5.7.1 rejected'), { publishProviderText: false })

    expect(caught.getStatus()).toBe(502)
  })

  it('should answer 503 when the error is too large to examine but the code is on the first link', async () => {
    const error = Object.assign(new Error('x'.repeat(200_000)), { code: 'ETIMEDOUT' })

    expect((await failWith(error)).getStatus()).toBe(503)
  })
})
