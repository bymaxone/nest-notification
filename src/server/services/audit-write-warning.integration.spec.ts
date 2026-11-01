/**
 * @fileoverview Specifies that a swallowed audit failure leaves a trace at each of the three
 * places that swallow it, including the brute-force trail, and that nothing changes for the
 * caller: the result is the same, and `audit.swallowErrors: false` still throws.
 * @layer application
 */
import { Logger } from '@nestjs/common'
import { firstValueFrom, of } from 'rxjs'
import type { CallHandler, ExecutionContext } from '@nestjs/common'

import { resolveOptions } from '../config/resolved-options'
import type { INotificationLogRepository } from '../interfaces/notification-log-repository.interface'
import { NotificationAuditInterceptor } from '../interceptors/notification-audit.interceptor'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import {
  makeAudit as makeEmailAudit,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { dummyRepo } from './__tests__/otp-service.fixtures'
import { EmailService } from './email.service'
import { OtpService } from './otp.service'

const CODE = 'BYMAX_NOTIFICATION_AUDIT_WRITE_FAILED'
const WRONG = 'ABCDEF'

const failing = (message = 'store down'): jest.Mocked<INotificationLogRepository> => ({
  name: 'audit',
  create: jest.fn().mockRejectedValue(new Error(message))
})

describe('swallowed audit failures leave a trace', () => {
  let warn: jest.SpyInstance

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  const ours = (): string[] =>
    warn.mock.calls.map((call) => String(call[0])).filter((line) => line.includes(CODE))

  const otpService = (
    audit: INotificationLogRepository,
    swallowErrors = true,
    consumeOnVerify = true
  ): OtpService => {
    const options = resolveOptions({
      otp: { storage: InMemoryOtpStorage, defaultMaxAttempts: 5, consumeOnVerify },
      audit: { repository: dummyRepo, swallowErrors }
    })
    return new OtpService(options, new InMemoryOtpStorage(), audit)
  }

  describe('OtpService', () => {
    const scope = { tenantId: 'acme', recipient: 'jane@acme.com', purpose: 'email_verification' }

    // The trail of a brute force: the entry that records the ceiling being hit is lost, the
    // counter and the answer are not.
    it('should leave a line when the max_attempts_exceeded entry cannot be written', async () => {
      const service = otpService(failing())
      await service.generate({ ...scope, deliverVia: 'manual' })

      const answers: string[] = []
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const result = await service.verify({ ...scope, code: WRONG })
        answers.push(result.valid ? 'valid' : result.reason)
      }

      expect(answers.slice(0, 5)).toEqual(Array(5).fill('invalid_code'))
      expect(answers[5]).toBe('max_attempts')
      expect(ours()).toHaveLength(1)
      expect(ours()[0]).toBe(
        `[${CODE}] An audit entry could not be written by the otp channel (store down); ` +
          "the operation's result is unaffected because audit.swallowErrors is true."
      )
    })

    it('should not put the recipient or any code in the line', async () => {
      const service = otpService(failing('store down'))
      await service.generate({ ...scope, deliverVia: 'manual' })
      await service.verify({ ...scope, code: WRONG })

      const text = ours().join('\n')

      expect(text).not.toContain('jane@acme.com')
      expect(text).not.toContain(WRONG)
    })

    it('should write no line when the audit write succeeds', async () => {
      const service = otpService(makeEmailAudit())
      await service.generate({ ...scope, deliverVia: 'manual' })
      await service.verify({ ...scope, code: WRONG })

      expect(ours()).toHaveLength(0)
    })

    it('should still throw AUDIT_LOG_FAILED and write no line when swallowErrors is false', async () => {
      const service = otpService(failing(), false)

      await expect(service.generate({ ...scope, deliverVia: 'manual' })).rejects.toMatchObject({
        code: 'notification.audit_log_failed'
      })
      expect(ours()).toHaveLength(0)
    })
  })

  describe('EmailService', () => {
    it('should leave a line when the sent entry cannot be written', async () => {
      const options = resolveOptions({
        email: { provider: makeProvider(), defaultFrom: 'no-reply@acme.com' },
        audit: { repository: dummyRepo }
      })
      const service = new EmailService(options, makeProvider(), makeRenderer(), failing('db gone'))

      const sent = await service.send({
        tenantId: 'acme',
        to: 'jane@acme.com',
        subject: 'S',
        html: '<p>B</p>'
      })

      expect(sent).toEqual({ messageId: 'msg_1' })
      expect(ours()).toEqual([
        `[${CODE}] An audit entry could not be written by the email channel (db gone); ` +
          "the operation's result is unaffected because audit.swallowErrors is true."
      ])
    })
  })

  describe('NotificationAuditInterceptor', () => {
    const dispatch = {
      channel: 'otp',
      tenantId: 'acme',
      payload: { recipient: 'maria@x.com', purpose: 'email_verification' }
    }
    const context = (): ExecutionContext =>
      ({
        getArgs: () => [dispatch],
        switchToHttp: () => ({ getRequest: () => ({ headers: {} }) })
      }) as unknown as ExecutionContext
    const handler: CallHandler = { handle: () => of('RESULT') }

    it('should leave a line when the entry cannot be written', async () => {
      const options = resolveOptions({ otp: { storage: InMemoryOtpStorage } })
      const interceptor = new NotificationAuditInterceptor(options, failing('db gone'))

      const value = await firstValueFrom(interceptor.intercept(context(), handler))

      expect(value).toBe('RESULT')
      expect(ours()).toEqual([
        `[${CODE}] An audit entry could not be written by the interceptor channel (db gone); ` +
          "the operation's result is unaffected because audit.swallowErrors is true."
      ])
    })

    // A tenant resolver that returns nothing used to empty the whole trail without a word.
    it('should leave a line when the tenant resolver returns a blank id', async () => {
      const options = resolveOptions({
        otp: { storage: InMemoryOtpStorage },
        global: { tenantIdResolver: () => '' }
      })
      const interceptor = new NotificationAuditInterceptor(options, makeEmailAudit())

      const value = await firstValueFrom(interceptor.intercept(context(), handler))

      expect(value).toBe('RESULT')
      expect(ours()).toEqual([
        `[${CODE}] An audit entry could not be written by the interceptor channel ` +
          '(notification.invalid_scope_identifier); ' +
          "the operation's result is unaffected because audit.swallowErrors is true."
      ])
    })
  })
})
