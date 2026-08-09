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

  // Security: the provider must never log the html or text body, and must log the
  // recipient MASKED — the full address is personal data that would otherwise sit in
  // every developer's log. It logs only the subject and a first-initial mask.
  it('should log the masked recipient and subject, never the full address or body', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)

    await new NoOpEmailProvider().send(baseOptions)

    expect(debugSpy).toHaveBeenCalledTimes(1)
    const logged = String(debugSpy.mock.calls[0]?.[0])
    expect(logged).toContain('j***@acme.com')
    expect(logged).not.toContain('jane@acme.com')
    expect(logged).toContain('Your code')
    expect(logged).not.toContain('Secret 123456')
  })

  // An array of recipients must each be masked and joined (covers the array branch).
  it('should mask and join multiple recipients in the log line', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)

    await new NoOpEmailProvider().send({ ...baseOptions, to: ['alice@x.com', 'bob@x.com'] })

    const logged = String(debugSpy.mock.calls[0]?.[0])
    expect(logged).toContain('a***@x.com,b***@x.com')
    expect(logged).not.toContain('alice@x.com')
  })

  // An address with no local part before its `@` is masked whole — the malformed
  // branch must not leak the address through the first-initial path.
  it('should fully redact an address with no local part', async () => {
    const debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined)

    await new NoOpEmailProvider().send({ ...baseOptions, to: '@nope.com' })

    const logged = String(debugSpy.mock.calls[0]?.[0])
    expect(logged).toContain('to=***')
    expect(logged).not.toContain('@nope.com')
  })
})
