import {
  baseInput,
  makeAudit,
  makeOptions,
  makeProvider,
  makeRenderer
} from './__tests__/email-service.fixtures'
import { EmailService } from './email.service'

describe('EmailService tenant scope', () => {
  const bad: ReadonlyArray<[string, string]> = [
    ['an empty tenant', ''],
    ['a whitespace-only tenant', '   '],
    ['a tenant with a newline', 'acme\nINJECTED line'],
    ['a tenant with a NUL', 'ac\u0000me']
  ]

  // A tenant that identifies nobody (or forges a log line) must be refused before the
  // provider is reached or an audit entry is written under it.
  describe.each([
    ['send', (s: EmailService, tenantId: string) => s.send({ ...baseInput, tenantId })],
    [
      'sendTemplate',
      (s: EmailService, tenantId: string) =>
        s.sendTemplate({ tenantId, to: 'jane@acme.com', template: 'welcome', data: {} })
    ]
  ])('%s', (_name, call) => {
    it.each(bad)(
      'should refuse %s before the provider or the audit sink',
      async (_label, tenantId) => {
        const provider = makeProvider()
        const renderer = makeRenderer()
        const audit = makeAudit()
        const service = new EmailService(makeOptions(), provider, renderer, audit)

        await expect(call(service, tenantId)).rejects.toMatchObject({
          code: 'notification.invalid_scope_identifier'
        })
        expect(provider.send).not.toHaveBeenCalled()
        expect(renderer.render).not.toHaveBeenCalled()
        expect(audit.create).not.toHaveBeenCalled()
      }
    )
  })

  // An ordinary tenant id is sent for and audited verbatim.
  it('should send for an ordinary tenant', async () => {
    const provider = makeProvider()
    const audit = makeAudit()
    const service = new EmailService(makeOptions(), provider, makeRenderer(), audit)

    await service.send({ ...baseInput, tenantId: 'acme:eu' })

    expect(provider.send).toHaveBeenCalledTimes(1)
    expect(audit.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'acme:eu' }))
  })
})
