/**
 * @fileoverview Holds EmailService to a provider whose `name` or `isConfigured` cannot be read:
 * the name is read once per failed send and reads as `[unreadable]` when it throws, and a provider
 * that cannot say whether it is configured is not configured.
 * @layer application
 */

import type { NotificationLogEntry } from '../interfaces/notification-log-repository.interface'

import {
  baseInput,
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'

const failingSend = (): Promise<never> => Promise.reject(new Error('relay refused'))

/** What a failed send answered with and what it wrote to the audit repository. */
async function failedSend(
  provider: ReturnType<typeof makeProvider>
): Promise<{ details: unknown; audited: NotificationLogEntry }> {
  const audit = makeAudit()
  provider.send.mockImplementation(failingSend)

  const caught = (await new EmailService(makeOptions(), provider, makeRenderer(), audit)
    .send(baseInput)
    .catch((error: unknown) => error)) as { getResponse(): { error: { details: unknown } } }

  return {
    details: caught.getResponse().error.details,
    audited: audit.create.mock.calls[0]?.[0] as NotificationLogEntry
  }
}

describe('EmailService with a provider that cannot be read', () => {
  it('should read a name whose getter throws as [unreadable] in the error and the audit entry', async () => {
    const provider = makeProvider()
    Object.defineProperty(provider, 'name', {
      configurable: true,
      get: () => {
        throw new Error('name getter of the host')
      }
    })

    const { details, audited } = await failedSend(provider)

    expect(details).toEqual({ providerName: '[unreadable]' })
    expect(audited.providerName).toBe('[unreadable]')
  })

  // A getter can answer differently each time it is read: the error and the audit entry of one
  // failed send must name the provider alike, which one read gives and two do not.
  it('should read the name once for a failed send', async () => {
    const provider = makeProvider()
    let reads = 0
    Object.defineProperty(provider, 'name', {
      configurable: true,
      get: () => `relay-${(reads += 1)}`
    })

    const { details, audited } = await failedSend(provider)

    expect(details).toEqual({ providerName: 'relay-1' })
    expect(audited.providerName).toBe('relay-1')
    expect(reads).toBe(1)
  })

  it('should refuse a send, not fail it with the host error, when isConfigured throws', async () => {
    const provider = makeProvider()
    provider.isConfigured.mockImplementation(() => {
      throw new Error('isConfigured of the host')
    })
    const service = new EmailService(makeOptions(), provider, makeRenderer(), makeAudit())

    await expect(service.send(baseInput)).rejects.toMatchObject({
      code: 'notification.email_provider_not_configured'
    })
    expect(service.isConfigured()).toBe(false)
    expect(provider.send).not.toHaveBeenCalled()
  })
})
