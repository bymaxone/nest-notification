/**
 * @fileoverview Holds every exception that wraps a failing dependency to a serialised body free of
 * the dependency's own text. The body is what a client receives, so an internal address, a path or
 * a relay's reply that rode in `details` or in `message` would leave the process; the original
 * error belongs on `cause` only, which no serialiser here reads.
 * @layer domain
 */

import {
  baseInput,
  makeAudit as makeEmailAudit,
  makeOptions as makeEmailOptions,
  makeProvider,
  makeRenderer
} from '../services/__tests__/email-service.fixtures'
import { makeAudit, makeOptions, ref } from '../services/__tests__/otp-service.fixtures'
import { EmailService } from '../services/email.service'
import { OtpService } from '../services/otp.service'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { NotificationException } from './notification-exception'

const ADDRESS = '10.1.2.3'
const HOST = 'mail.internal.example'
const PATH = '/srv/app/secret-templates'

/** A failure carrying the fields a real driver attaches, each holding internal text. */
function hostile(code?: string): Error {
  return Object.assign(new Error(`connect failed to ${ADDRESS}:587 via ${HOST} at ${PATH}`), {
    ...(code === undefined ? {} : { code }),
    address: ADDRESS,
    response: `421 ${HOST} unavailable`,
    command: 'CONN'
  })
}

async function thrown(call: Promise<unknown>): Promise<NotificationException> {
  const caught: unknown = await call.then(
    () => undefined,
    (error: unknown) => error
  )
  expect(caught).toBeInstanceOf(NotificationException)
  return caught as NotificationException
}

describe('serialised body of an exception that wraps a failing dependency', () => {
  const cases: ReadonlyArray<readonly [string, () => Promise<NotificationException>]> = [
    [
      'EMAIL_SEND_FAILED (provider unreachable)',
      () => {
        const provider = makeProvider()
        provider.send.mockRejectedValue(hostile('ECONNREFUSED'))
        const service = new EmailService(
          makeEmailOptions(),
          provider,
          makeRenderer(),
          makeEmailAudit()
        )
        return thrown(service.send(baseInput))
      }
    ],
    [
      'EMAIL_SEND_FAILED (provider refused)',
      () => {
        const provider = makeProvider()
        provider.send.mockRejectedValue(hostile())
        const service = new EmailService(
          makeEmailOptions(),
          provider,
          makeRenderer(),
          makeEmailAudit()
        )
        return thrown(service.send(baseInput))
      }
    ],
    [
      'TEMPLATE_RENDER_FAILED',
      () => {
        const renderer = makeRenderer()
        renderer.render.mockRejectedValue(hostile())
        const service = new EmailService(
          makeEmailOptions(),
          makeProvider(),
          renderer,
          makeEmailAudit()
        )
        return thrown(
          service.sendTemplate({ tenantId: 't', to: 'a@x.com', template: 'welcome', data: {} })
        )
      }
    ],
    [
      'AUDIT_LOG_FAILED (email)',
      () => {
        const audit = makeEmailAudit()
        audit.create.mockRejectedValue(hostile())
        const service = new EmailService(
          makeEmailOptions({}, { swallowErrors: false }),
          makeProvider(),
          makeRenderer(),
          audit
        )
        return thrown(service.send(baseInput))
      }
    ],
    [
      'OTP_STORAGE_UNAVAILABLE',
      () => {
        const storage = new InMemoryOtpStorage()
        jest.spyOn(storage, 'get').mockRejectedValue(hostile('ECONNREFUSED'))
        const service = new OtpService(makeOptions({}), storage, makeAudit())
        return thrown(service.getStatus(ref))
      }
    ]
  ]

  // Each dependency failure is hostile on purpose (message, code, address, reply, command). The
  // body must hold none of it, in `message` or anywhere under `details`, while the original
  // error stays reachable on `cause` for the host's logs.
  it.each(cases)('should leave the dependency text out of the body of %s', async (_name, run) => {
    const exception = await run()

    const body = JSON.stringify(exception.getResponse())

    for (const internal of [ADDRESS, HOST, PATH, 'CONN', 'ECONNREFUSED']) {
      expect(body).not.toContain(internal)
    }
    expect(exception.cause).toBeDefined()
  })
})
