import type { ResolvedNotificationOptions } from '../config/resolved-options'
import { NotificationException } from '../errors/notification-exception'
import type {
  EmailSendOptions,
  EmailSendResult,
  IEmailProvider
} from '../interfaces/email-provider.interface'
import type {
  IEmailTemplateRenderer,
  RenderedEmail
} from '../interfaces/email-template-renderer.interface'
import type { INotificationLogRepository } from '../interfaces/notification-log-repository.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import {
  freezeClockAwayFromCodes,
  emailSendTemplate,
  emailServiceStub,
  makeAudit,
  makeOptions,
  ref,
  serializeErrorChain
} from './__tests__/otp-service.fixtures'
import { EmailService } from './email.service'
import { OtpService } from './otp.service'

describe('OtpService email delivery contract', () => {
  // SECURITY: the OTP body IS a credential, so its send must both declare the
  // code (precision where text is published) and forbid publishing provider
  // text at all (the shapes declaration cannot predict). Pinned on the input
  // the service builds, because a failure here is silent — delivery still
  // works, and only a provider echo would reveal it.
  it('should declare the code and withhold provider text on OTP delivery', async () => {
    const audit = makeAudit()
    const storage = new InMemoryOtpStorage()
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)
    emailSendTemplate.mockClear()

    await service.generate({ ...ref, deliverVia: 'email' })

    const sent = emailSendTemplate.mock.calls[0]?.[0] as {
      auditRedactValues?: readonly string[]
      publishProviderText?: boolean
      data?: { code?: string }
    }
    const issued = sent.data?.code as string
    expect(sent.auditRedactValues).toEqual([issued])
    expect(sent.publishProviderText).toBe(false)
  })
})

describe('OtpService.generate — delivery-error redaction', () => {
  let storage: InMemoryOtpStorage
  let audit: jest.Mocked<INotificationLogRepository>

  beforeEach(() => {
    storage = new InMemoryOtpStorage()
    audit = makeAudit()
    emailSendTemplate.mockResolvedValue({ messageId: 'm1' })
  })

  // SECURITY (regression): a renderer/provider that echoes its template data —
  // which carries the plaintext code — in a thrown error must have the code
  // scrubbed from the audit errorMessage AND from every level of the rethrown
  // chain (message + stack) before anything leaves the service.
  it('should scrub the code from a delivery error chain and the audit entry', async () => {
    let leakedCode = ''
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      const inner = new Error(`socket wrote body code=${input.data.code}`)
      const outer = new Error(`render failed for ${input.data.code}`, { cause: inner })
      // Materialize the lazy V8 stacks NOW, while the message still carries the
      // code — the header line freezes on first read, so a pre-read stack is
      // exactly what the stack scrub exists to clean.
      void inner.stack
      void outer.stack
      return Promise.reject(outer)
    })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(leakedCode).not.toBe('')
    const chain = serializeErrorChain(caught)
    expect(chain.includes(leakedCode)).toBe(false)
    expect(chain).toContain('[redacted]')
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(leakedCode)).toBe(false)
    }
  })

  // The scrub traversal is identity-based, so a chain deeper than any fixed
  // bound is scrubbed in full — no unscrubbed tail a cause-walking serializer
  // could still print (regression for the old depth cap).
  it('should scrub every link of a deep delivery-error chain', async () => {
    let leakedCode = ''
    const nodes: Error[] = []
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      for (let level = 0; level < 12; level += 1) {
        const node = new Error(`level ${level} code=${input.data.code}`)
        delete node.stack
        nodes.push(node)
      }
      nodes.reduce((parent, node) => {
        parent.cause = node
        return node
      })
      return Promise.reject(nodes[0])
    })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    await service.generate({ ...ref, deliverVia: 'email' }).catch(() => undefined)

    for (const node of nodes) {
      expect(node.message.includes(leakedCode)).toBe(false)
    }
  })

  // A custom storage or provider may reject with a raw OBJECT that carries the
  // plaintext entry in its properties; every non-Error rejection is flattened
  // to a redacted string so nothing serializable retains the code.
  it('should flatten an object rejection to a redacted string', async () => {
    let leakedCode = ''
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      return Promise.reject({ entry: { code: input.data.code } })
    })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(caught).toBe('[object Object]')
    expect(JSON.stringify(audit.create.mock.calls).includes(leakedCode)).toBe(false)
  })

  // Real-path regression (no EmailService stub): a provider failure that echoes
  // the rendered OTP body must leave the code out of BOTH audit entries — the
  // EmailService 'failed' entry (redacted via `auditRedactValues`) and the
  // OtpService 'failed' entry (scrubbed) — and out of the rethrown chain.
  // SECURITY (regression): when the provider quotes ONLY the code — too short
  // for the 16-char echo window — the DECLARED `auditRedactValues: [code]`
  // from buildOtpEmail is the control that scrubs it. Pins the declaration
  // against an emptied-array mutant that the echo guard would mask.
  it('should scrub a short code-only echo through the declared values', async () => {
    const restoreClock = freezeClockAwayFromCodes()
    let realCode = ''
    const shortEchoProvider: IEmailProvider = {
      name: 'short-echo',
      isConfigured: (): boolean => true,
      send: async (sendOptions: EmailSendOptions): Promise<EmailSendResult> => {
        const digits = /\d{6}/.exec(sendOptions.html)
        throw new Error(`550 rejected: ${digits?.[0] ?? 'none'}`)
      }
    }
    const capturingRenderer: IEmailTemplateRenderer = {
      name: 'capturing',
      hasTemplate: async (): Promise<boolean> => true,
      render: async (
        _template: string,
        data: Record<string, unknown>,
        _locale: string
      ): Promise<RenderedEmail> => {
        realCode = String(data.code)
        return { subject: 'Your code', html: `<p>${realCode}</p>` }
      }
    }
    const resolved: ResolvedNotificationOptions = {
      ...makeOptions(),
      email: { defaultFrom: 'noreply@acme.com', defaultTags: [], maxAttachmentBytes: 1_000_000 }
    }
    const emailService = new EmailService(resolved, shortEchoProvider, capturingRenderer, audit)
    const service = new OtpService(resolved, storage, audit, emailService)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(realCode.length).toBeGreaterThan(0)
    expect(serializeErrorChain(caught).includes(realCode)).toBe(false)
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(realCode)).toBe(false)
    }
    restoreClock()
  })

  it('should keep the code out of both audit entries on a real email delivery failure', async () => {
    const restoreClock = freezeClockAwayFromCodes()
    let realCode = ''
    const echoingProvider: IEmailProvider = {
      name: 'echoing',
      isConfigured: (): boolean => true,
      send: async (sendOptions: EmailSendOptions): Promise<EmailSendResult> => {
        // Echo the OTP-bearing body through every serializer-visible surface:
        // message, name, and a PRIMITIVE nested cause (which the log-safe copy
        // preserves verbatim and only the scrub can clean).
        const providerError = new Error(`provider rejected payload: ${sendOptions.html}`, {
          cause: `wire dump: ${sendOptions.html}`
        })
        providerError.name = `REJECT_${sendOptions.html}`
        throw providerError
      }
    }
    const renderer: IEmailTemplateRenderer = {
      name: 'capturing',
      hasTemplate: async (): Promise<boolean> => true,
      render: async (
        _template: string,
        data: Record<string, unknown>,
        _locale: string
      ): Promise<RenderedEmail> => {
        realCode = String(data.code)
        return { subject: 'Your code', html: `<p>Your code is ${realCode}</p>` }
      }
    }
    const options: ResolvedNotificationOptions = {
      ...makeOptions(),
      email: { defaultFrom: 'noreply@acme.com', defaultTags: [], maxAttachmentBytes: 1_000_000 }
    }
    const emailService = new EmailService(options, echoingProvider, renderer, audit)
    const service = new OtpService(options, storage, audit, emailService)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(realCode.length).toBeGreaterThan(0)
    expect(serializeErrorChain(caught).includes(realCode)).toBe(false)
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(realCode)).toBe(false)
    }
    restoreClock()
  })

  // A STRING rejection cannot be mutated in place, so a scrubbed copy must be
  // rethrown and the audit errorMessage must carry the scrubbed form.
  it('should rethrow a scrubbed copy of a string rejection', async () => {
    let leakedCode = ''
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      return Promise.reject(`string failure code=${input.data.code}`)
    })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(caught).toBe(`string failure code=[redacted]`)
    expect(audit.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { errorMessage: 'string failure code=[redacted]' } })
    )
    expect(JSON.stringify(audit.create.mock.calls).includes(leakedCode)).toBe(false)
  })

  // SECURITY (regression): a failed cleanup used to escape the catch block
  // BEFORE the scrub ran — the cleanup error must supersede the delivery error
  // (the cooldown/OTP may be orphaned), carry it as `cause`, and still pass
  // through the scrub and the audit like any outgoing delivery failure.
  it('should scrub a cleanup failure and attach the delivery error as its cause', async () => {
    let leakedCode = ''
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      return Promise.reject(new Error(`delivery failed for ${input.data.code}`))
    })
    jest.spyOn(storage, 'clearCooldown').mockImplementation(async () => {
      throw new Error(`cleanup failed while holding ${leakedCode}`)
    })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('cleanup failed while holding [redacted]')
    expect(((caught as Error).cause as Error).message).toBe('delivery failed for [redacted]')
    expect(serializeErrorChain(caught).includes(leakedCode)).toBe(false)
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(leakedCode)).toBe(false)
    }
  })

  // A cleanup error that already carries its own cause must keep it — the
  // delivery error is only attached when the slot is genuinely free.
  it('should not overwrite an existing cause on a cleanup failure', async () => {
    emailSendTemplate.mockRejectedValue(new Error('delivery failed'))
    const ownCause = new Error('disk full')
    jest
      .spyOn(storage, 'clearCooldown')
      .mockRejectedValue(new Error('cleanup failed', { cause: ownCause }))
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect((caught as Error).cause).toBe(ownCause)
  })

  // A non-Error cleanup rejection takes the same flattening path as any other
  // non-Error outgoing failure.
  it('should flatten a non-Error cleanup rejection to a redacted string', async () => {
    let leakedCode = ''
    emailSendTemplate.mockImplementation((input: { data: { code: string } }) => {
      leakedCode = input.data.code
      return Promise.reject(new Error('delivery failed'))
    })
    jest
      .spyOn(storage, 'clearCooldown')
      .mockImplementation(() => Promise.reject(`cleanup dump ${leakedCode}`))
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'email' })
      .catch((error: unknown) => error)

    expect(caught).toBe('cleanup dump [redacted]')
  })

  // SECURITY (regression): a storage rejection whose COERCION throws (hostile
  // toString) must fail closed to the marker — the hostile error must never
  // escape the catch path unaudited.
  it('should fail closed on a rejection whose coercion throws', async () => {
    let leakedCode = ''
    jest
      .spyOn(storage, 'set')
      .mockImplementation(async (_tenantId, _recipient, _purpose, entry) => {
        leakedCode = entry.code
        throw {
          toString: (): never => {
            throw new Error(`toString leaked ${entry.code}`)
          }
        }
      })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'manual' })
      .catch((error: unknown) => error)

    expect(leakedCode).not.toBe('')
    expect(caught).toBe('[redacted]')
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(leakedCode)).toBe(false)
    }
  })

  // SECURITY (regression): a custom storage may reject `set()` with the entry
  // attached as an enumerable property — the code inside it must not survive
  // into the rethrown error or any audit entry.
  it('should strip a storage rejection that retains the entry', async () => {
    let leakedCode = ''
    jest
      .spyOn(storage, 'set')
      .mockImplementation(async (_tenantId, _recipient, _purpose, entry) => {
        leakedCode = entry.code
        throw Object.assign(new Error('write failed'), { entry })
      })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'manual' })
      .catch((error: unknown) => error)

    expect(leakedCode).not.toBe('')
    expect(caught).toBeInstanceOf(Error)
    expect(Object.keys(caught as Error)).toEqual([])
    expect(serializeErrorChain(caught).includes(leakedCode)).toBe(false)
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(leakedCode)).toBe(false)
    }
  })

  // SECURITY (regression): a custom storage may reject with its OWN
  // NotificationException carrying the code in caller-supplied details — the
  // instance is preserved (consumers branch on it) but its response body is
  // deep-redacted before the rethrow.
  it('should redact a consumer NotificationException rejection from storage', async () => {
    let leakedCode = ''
    jest
      .spyOn(storage, 'set')
      .mockImplementation(async (_tenantId, _recipient, _purpose, entry) => {
        leakedCode = entry.code
        throw new NotificationException('OTP_STORAGE_NOT_CONFIGURED', { code: entry.code })
      })
    const service = new OtpService(makeOptions(), storage, audit, emailServiceStub)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'manual' })
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(NotificationException)
    expect(serializeErrorChain(caught).includes(leakedCode)).toBe(false)
    for (const call of audit.create.mock.calls) {
      expect(JSON.stringify(call[0]).includes(leakedCode)).toBe(false)
    }
  })

  // SECURITY: with swallowErrors:false the AUDIT_LOG_FAILED chain — message, stack,
  // response body, and every nested cause — must never carry the plaintext code.
  // The cause chain is exactly what cause-walking log serializers now print.
  it('should keep the code out of the full AUDIT_LOG_FAILED error chain', async () => {
    audit.create.mockRejectedValue(new Error('db down'))
    const service = new OtpService(makeOptions({}, { swallowErrors: false }), storage, audit)

    const caught: unknown = await service
      .generate({ ...ref, deliverVia: 'manual' })
      .catch((error: unknown) => error)
    const realCode = (await storage.get(ref.tenantId, ref.recipient, ref.purpose))?.code as string

    expect(caught).toBeInstanceOf(NotificationException)
    expect(serializeErrorChain(caught).includes(realCode)).toBe(false)
  })
})
