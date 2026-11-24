/**
 * @fileoverview Holds both mail adapters to naming themselves when the import of their optional peer
 * hands back a promise that cannot be pinned.
 * @layer infrastructure
 */

import { ResendEmailProvider } from './resend-email.provider'
import { SmtpEmailProvider } from './smtp-email.provider'

const mockLoadOptionalPeer = jest.fn()
jest.mock('../utils/load-optional-peer', () => ({
  loadOptionalPeer: (...args: unknown[]): unknown => mockLoadOptionalPeer(...args)
}))

const MESSAGE = { to: 'a@x.com', from: 'f@x.com', subject: 's', html: '<p>x</p>' } as const

beforeEach(() => {
  mockLoadOptionalPeer.mockReset().mockReturnValue(Object.freeze(Promise.resolve({})))
})

describe('the optional peer import of a mail adapter', () => {
  it('should name SmtpEmailProvider when the nodemailer import cannot be pinned', async () => {
    const provider = new SmtpEmailProvider({ host: 'h' })

    await expect(provider.send(MESSAGE)).rejects.toMatchObject({
      response: {
        error: {
          message: '[SmtpEmailProvider] promise cannot be pinned, so the operation is refused'
        }
      }
    })
  })

  it('should name ResendEmailProvider when the resend import cannot be pinned', async () => {
    const provider = new ResendEmailProvider({ apiKey: 're_x' })

    await expect(provider.send(MESSAGE)).rejects.toMatchObject({
      response: {
        error: {
          message: '[ResendEmailProvider] promise cannot be pinned, so the operation is refused'
        }
      }
    })
  })
})
