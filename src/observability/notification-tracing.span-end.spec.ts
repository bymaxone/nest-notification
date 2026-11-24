/**
 * @fileoverview A span processor that runs when the span ends, and plants a `then` while it does,
 * cannot decide what `EmailService.send` resolves with: the check is the last thing before the return.
 * @layer observability
 */

import { trace } from '@opentelemetry/api'
import type { Span, Tracer } from '@opentelemetry/api'

import { EmailService } from '@bymax-one/nest-notification'
import {
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from '../server/services/__tests__/email-service.fixtures'

import { NotificationTracing } from './notification-tracing'

afterEach(() => {
  jest.restoreAllMocks()
  delete (Object.prototype as Record<string, unknown>).then
})

describe('EmailService.send through NotificationTracing when span.end plants a then', () => {
  it('should not resolve with the answer the planted then gives', async () => {
    let reads = 0
    const span = {
      setStatus: (): void => undefined,
      setAttribute: (): void => undefined,
      end: (): void => {
        Object.defineProperty(Object.prototype, 'then', {
          configurable: true,
          get() {
            reads += 1
            if (reads === 1) {
              return undefined
            }
            delete (Object.prototype as Record<string, unknown>).then
            return (resolve: (value: unknown) => void): void => {
              resolve({ messageId: 'FORGED' })
            }
          }
        })
      }
    } as unknown as Span
    const tracer = {
      startActiveSpan: (_name: string, _options: object, run: (span: Span) => unknown) => run(span)
    } as unknown as Tracer
    jest.spyOn(trace, 'getTracer').mockReturnValue(tracer)
    const audit = makeAudit()
    const email = new EmailService(
      makeOptions(),
      makeProvider(),
      makeRenderer(),
      audit,
      new NotificationTracing()
    )

    let answer: string
    try {
      answer = JSON.stringify(
        await email.send({ tenantId: 't', to: 'jane@acme.com', subject: 's', html: '<p>x</p>' })
      )
    } catch {
      answer = 'rejected'
    }
    delete (Object.prototype as Record<string, unknown>).then

    expect(answer).not.toContain('FORGED')
  })
})
