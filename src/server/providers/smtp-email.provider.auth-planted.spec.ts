/**
 * @fileoverview Specs for a key planted on the realm root while the real Nodemailer is logging in:
 * the auth objects Nodemailer builds for itself must not read it, so the call is refused or fails
 * and nothing throws outside it.
 * @layer infrastructure
 */

import { Logger } from '@nestjs/common'

import { startRelay, type Relay } from './__tests__/smtp-relay.fixture'
import { SmtpEmailProvider } from './smtp-email.provider'
import type { SmtpEmailProviderOptions } from './smtp-email.types'

const MESSAGE = {
  to: 'real@acme.com',
  from: 'noreply@acme.com',
  subject: 'Your code',
  html: '<p>123456</p>'
} as const

/** The names Nodemailer reads from the auth object it builds that the object does not hold. */
const UNSET_ON_BUILT_AUTH = ['oauth2', 'pass', 'options'] as const

const root = Object.prototype as unknown as Record<string, unknown>
let planted: string[] = []
let relay: Relay | undefined
let provider: SmtpEmailProvider | undefined

function plant(name: string): void {
  Object.defineProperty(Object.prototype, name, {
    value: 'x',
    configurable: true,
    writable: true,
    enumerable: true
  })
  planted.push(name)
}

/** A provider that logs in to a relay which runs `onEhlo` before it answers EHLO. */
async function loggingIn(
  options: Partial<SmtpEmailProviderOptions>,
  onEhlo?: () => void
): Promise<SmtpEmailProvider> {
  relay = await startRelay({ login: onEhlo ? { onEhlo } : {} })
  provider = new SmtpEmailProvider({
    host: '127.0.0.1',
    port: relay.port,
    secure: false,
    requireTls: false,
    credentials: { user: 'u', pass: 'p' },
    sendTimeoutMs: 3000,
    socketTimeout: 1500,
    ...options
  })
  return provider
}

/** What the call ended with: `resolved`, or the code or message of what it threw. */
async function outcome(call: Promise<unknown>): Promise<string> {
  try {
    await call
    return 'resolved'
  } catch (error) {
    const failure = error as { code?: string; message: string }
    return failure.code ?? failure.message
  }
}

/** Lets what Nodemailer left for later ticks run while the key is still planted. */
function settleSockets(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 150))
}

afterEach(async () => {
  for (const name of planted) {
    delete root[name]
  }
  planted = []
  await provider?.close()
  await relay?.close()
  provider = undefined
  relay = undefined
  jest.restoreAllMocks()
})

describe.each([
  ['an unpooled transport', {}],
  ['a pooled transport', { pool: {} }]
])('a key planted while %s logs in', (_label, options) => {
  it.each(UNSET_ON_BUILT_AUTH)('should refuse the send when %s is planted', async (name) => {
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const sender = await loggingIn(options, () => plant(name))

    const result = await outcome(sender.send(MESSAGE))
    await sender.close()
    await settleSockets()

    expect(planted).toEqual([name])
    expect(result).toBe('notification.invalid_scope_identifier')
    expect(relay?.messages).toHaveLength(0)
    expect(JSON.stringify(warned.mock.calls)).not.toContain('SMTP_CLOSE_FAILED')
  })

  it.each(UNSET_ON_BUILT_AUTH)('should settle verify() when %s is planted', async (name) => {
    const checker = await loggingIn(options, () => plant(name))

    const result = await outcome(checker.verify())
    await checker.close()
    await settleSockets()

    expect(planted).toEqual([name])
    expect(['resolved', 'SmtpEmailProvider: the relay did not accept the connection']).toContain(
      result
    )
  })

  it('should still log in and send on a clean realm', async () => {
    const sender = await loggingIn(options)

    await sender.verify()
    await sender.send(MESSAGE)

    expect(relay?.commands).toContain('AUTH')
    expect(relay?.messages).toHaveLength(1)
  })

  it('should close without throwing when oauth2 is planted after a send', async () => {
    const warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined)
    const sender = await loggingIn(options)
    await sender.send(MESSAGE)

    plant('oauth2')
    await sender.close()
    await settleSockets()

    expect(warned).not.toHaveBeenCalled()
  })
})
