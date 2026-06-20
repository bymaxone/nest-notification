import { Logger } from '@nestjs/common'

import type { EmailSendOptions } from '../interfaces/email-provider.interface'

import { NoOpEmailProvider } from './no-op-email.provider'

const baseOptions: EmailSendOptions = {
  to: 'jane@acme.com',
  subject: 'Your code',
  html: '<p>Secret 123456</p>',
  text: 'Secret 123456'
}

describe('NoOpEmailProvider', () => {
  // Identity contract: the provider names itself "noop" and is always ready.
  it('should report name "noop" and be configured', () => {
    const provider = new NoOpEmailProvider()

    expect(provider.name).toBe('noop')
    expect(provider.isConfigured()).toBe(true)
  })

  // The synthetic message id must be recognizable as a no-op send.
  it('should return a messageId prefixed with "noop-"', async () => {
    const result = await new NoOpEmailProvider().send(baseOptions)

    expect(result.messageId).toMatch(/^noop-/)
  })

  // Security: the provider must never log the html or text body, which can carry
  // OTP codes / PII. It logs only the recipient and subject.
  it('should log only recipient and subject, never the body', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)

    await new NoOpEmailProvider().send(baseOptions)

    expect(debugSpy).toHaveBeenCalledTimes(1)
    const logged = String(debugSpy.mock.calls[0]?.[0])
    expect(logged).toContain('jane@acme.com')
    expect(logged).toContain('Your code')
    expect(logged).not.toContain('Secret 123456')
  })

  // An array of recipients must be joined for the log line (covers the array branch).
  it('should join multiple recipients in the log line', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)

    await new NoOpEmailProvider().send({ ...baseOptions, to: ['a@x.com', 'b@x.com'] })

    expect(String(debugSpy.mock.calls[0]?.[0])).toContain('a@x.com,b@x.com')
  })
})
