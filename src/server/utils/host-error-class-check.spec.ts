/**
 * @fileoverview Holds every class check the library makes on something the host threw or rejected
 * with to the rule that the check cannot throw: a proxy whose `getPrototypeOf` trap throws must not
 * replace the library's own error or escape a catch block. Rows run the real paths: the SMTP
 * transport build, an OTP storage outage, and an email provider failure.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'
import type { IEmailProvider } from '../interfaces'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { SmtpEmailProvider } from '../providers/smtp-email.provider'
import { baseOptions } from '../providers/__tests__/smtp-email-provider.fixtures'
import { makeAudit, makeOptions } from '../services/__tests__/otp-service.fixtures'
import {
  makeAudit as makeEmailAudit,
  makeRenderer
} from '../services/__tests__/email-service.fixtures'
import { resolveOptions } from '../config/resolved-options'
import { dummyRepo } from '../services/__tests__/otp-service.fixtures'
import { EmailService } from '../services/email.service'
import { OtpService } from '../services/otp.service'

const TRAP = 'getPrototypeOf trap of the host object'

/** An object whose class check throws, as a hostile or revoked proxy does. */
function hostile(): object {
  return new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error(TRAP)
      }
    }
  )
}

// `mock`-prefixed names are allowed inside the hoisted jest.mock factory.
const mockCreateTransport = jest.fn()
jest.mock('nodemailer', () => ({ __esModule: true, createTransport: mockCreateTransport }), {
  virtual: true
})

describe('a class check on a host error', () => {
  it('should not let a hostile object thrown by the SMTP transport build escape as its own error', async () => {
    mockCreateTransport.mockImplementation(() => {
      throw hostile()
    })

    const sending = new SmtpEmailProvider({ host: 'h' }).send(baseOptions)

    await expect(sending).rejects.toBeInstanceOf(Error)
    await expect(sending).rejects.not.toThrow(TRAP)
  })

  it('should pass a hostile storage failure on as the object the store threw', async () => {
    const thrown = hostile()
    const storage = new InMemoryOtpStorage()
    storage.tryAcquireCooldown = async () => {
      throw thrown
    }
    const service = new OtpService(makeOptions({}), storage, makeAudit())

    const generating = service.generate({
      tenantId: 'acme',
      recipient: 'a@example.com',
      purpose: 'login',
      deliverVia: 'manual'
    })

    await expect(generating).rejects.toBe(thrown)
  })

  it('should answer a hostile provider failure with a NotificationException', async () => {
    const provider: IEmailProvider = {
      name: 'hostile',
      isConfigured: () => true,
      send: async () => {
        throw hostile()
      }
    }
    const options = resolveOptions({
      email: { provider, defaultFrom: 'no-reply@acme.com' },
      audit: { repository: dummyRepo }
    })
    const service = new EmailService(options, provider, makeRenderer(), makeEmailAudit())

    const sending = service.send({
      tenantId: 'acme',
      to: 'a@example.com',
      subject: 's',
      html: '<p>x</p>'
    })

    await expect(sending).rejects.toBeInstanceOf(NotificationException)
  })

  it('should treat a hostile outage-shaped storage failure as no library error, not as one', async () => {
    const thrown = new Proxy(
      { code: 'ECONNREFUSED' },
      {
        getPrototypeOf() {
          throw new Error(TRAP)
        }
      }
    )
    const storage = new InMemoryOtpStorage()
    storage.tryAcquireCooldown = async () => {
      throw thrown
    }
    const service = new OtpService(makeOptions({}), storage, makeAudit())

    const generating = service.generate({
      tenantId: 'acme',
      recipient: 'a@example.com',
      purpose: 'login',
      deliverVia: 'manual'
    })

    await expect(generating).rejects.toMatchObject({
      getResponse: expect.any(Function)
    })
  })
})
