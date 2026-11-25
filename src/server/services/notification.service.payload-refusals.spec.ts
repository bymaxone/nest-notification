/**
 * @fileoverview Holds a dispatch to refusing a request, a channel or a payload that is not of its
 * kind with the library's own refusal, never a raw error and never a send.
 * @layer application
 */

import { NotificationException } from '../errors/notification-exception'
import {
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'
import { NotificationService } from './notification.service'
import type { OtpService } from './otp.service'

function build(): { service: NotificationService; otpCalls: unknown[] } {
  const otpCalls: unknown[] = []
  const otp = {
    isConfigured: () => true,
    generate: async (input: unknown) => (otpCalls.push(input), { code: 'c' }),
    verify: async (input: unknown) => (otpCalls.push(input), { valid: true }),
    consume: async (input: unknown) => (otpCalls.push(input), undefined)
  } as unknown as OtpService
  const email = new EmailService(makeOptions(), makeProvider(), makeRenderer(), makeAudit())
  return { service: new NotificationService(email, otp), otpCalls }
}

async function refusalOf(run: () => Promise<unknown>): Promise<unknown> {
  const error = await run().then(
    () => undefined,
    (thrown: unknown) => thrown
  )
  expect(error).toBeInstanceOf(NotificationException)
  return (error as NotificationException).getResponse()
}

const refusal = (parameter: string, reason: string): unknown => ({
  error: {
    code: 'notification.invalid_scope_identifier',
    message: `[NotificationService] ${parameter} ${reason}`,
    details: { boundary: 'NotificationService', parameter, reason }
  }
})

describe('a dispatch that is not of its kind', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 7],
    ['a string', 'x']
  ] as const)('should refuse a request that is %s', async (_label, input) => {
    const { service } = build()

    expect(await refusalOf(() => service.dispatch(input as never))).toEqual(
      refusal('input', 'must be an object')
    )
  })

  it.each([
    ['an unknown channel', { channel: 'sms', tenantId: 't', payload: {} }],
    ['no channel', { tenantId: 't', payload: {} }],
    ['a list as the request', []]
  ] as const)('should refuse %s and send nothing', async (_label, input) => {
    const { service, otpCalls } = build()

    expect(await refusalOf(() => service.dispatch(input as never))).toEqual(
      refusal('channel', 'expected email, otp or push')
    )
    expect(otpCalls).toEqual([])
  })

  it.each([
    ['null', { channel: 'email', tenantId: 't', payload: null }],
    ['undefined', { channel: 'email', tenantId: 't', payload: undefined }],
    ['absent', { channel: 'email', tenantId: 't' }]
  ] as const)('should refuse an email payload that is %s', async (_label, input) => {
    const { service } = build()

    expect(await refusalOf(() => service.dispatch(input as never))).toEqual(
      refusal('payload', 'must be an object')
    )
  })

  it.each([
    ['a number', 7],
    ['a string', 'x'],
    ['a list', []]
  ] as const)(
    'should keep answering an email payload that is %s as missing its body',
    async (_label, payload) => {
      const { service } = build()

      expect(
        await refusalOf(() =>
          service.dispatch({ channel: 'email', tenantId: 't', payload } as never)
        )
      ).toEqual({
        error: {
          code: 'notification.email_missing_body',
          message: 'Email payload requires either a template or a subject and html body',
          details: { hint: 'payload requires either `template` OR `{ subject, html }`' }
        }
      })
    }
  )

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['absent', 'absent'],
    ['a number', 7],
    ['a string', 'x'],
    ['true', true],
    ['a list', []]
  ] as const)(
    'should refuse an otp payload that is %s and call nothing',
    async (_label, payload) => {
      const { service, otpCalls } = build()
      const input =
        payload === 'absent'
          ? { channel: 'otp', tenantId: 't' }
          : { channel: 'otp', tenantId: 't', payload }

      expect(await refusalOf(() => service.dispatch(input as never))).toEqual(
        refusal('payload', 'must be an object')
      )
      expect(otpCalls).toEqual([])
    }
  )
})

describe('a direct email send that is not of its kind', () => {
  it.each([
    ['send', (email: EmailService) => email.send(null as never)],
    ['sendTemplate', (email: EmailService) => email.sendTemplate(null as never)]
  ] as const)(
    'should answer %s(null) with the library send failure, not a raw error',
    async (_label, run) => {
      const email = new EmailService(makeOptions(), makeProvider(), makeRenderer(), makeAudit())

      const answer = (await refusalOf(() => run(email))) as { error: { code: string } }

      expect(answer.error.code).toBe('notification.email_send_failed')
    }
  )
})
