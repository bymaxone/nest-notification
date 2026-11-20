/**
 * @fileoverview Holds every library log line to the rule that a host logger which throws cannot
 * fail the operation that wrote it. One rule spec fails on a logger call that bypasses `logEvent`;
 * the rows run real library paths through a real Nest `Logger` whose host logger throws.
 * @layer logging
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { Logger } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { BymaxNotificationModule } from './bymax-notification.module'
import { EmailService } from './services/email.service'
import { AuditWriteWarning } from './utils/audit-write-warning'
import type { IEmailProvider } from './interfaces'

const provider: IEmailProvider = {
  name: 'fake',
  isConfigured: () => true,
  send: async () => ({ messageId: 'x' })
}
const email = { provider, defaultFrom: 'noreply@example.com' }

/** Every non-spec source file of the library, with its text. */
function sources(dir: string): Array<{ file: string; text: string }> {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      return name === '__tests__' ? [] : sources(path)
    }
    return path.endsWith('.ts') && !path.endsWith('.spec.ts')
      ? [{ file: path, text: readFileSync(path, 'utf8') }]
      : []
  })
}

describe('a host logger that throws', () => {
  const throwing = ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'].reduce<
    Record<string, () => never>
  >((all, level) => {
    all[level] = () => {
      throw new Error(`${level} sink down`)
    }
    return all
  }, {})

  beforeEach(() => {
    Logger.overrideLogger(throwing as never)
  })

  afterEach(() => {
    Logger.overrideLogger(['log', 'warn', 'error', 'debug'])
  })

  it('should find no library log call that does not go through logEvent', () => {
    const direct = /\blogger\s*\??\.(log|warn|error|debug|verbose|fatal)\s*\(/
    const offenders = sources(join(__dirname, '..'))
      .filter(({ file }) => !file.endsWith(join('utils', 'log-event.ts')))
      .filter(({ text }) => direct.test(text))
      .map(({ file }) => file)

    expect(offenders).toEqual([])
  })

  it('should let forRoot return when the bootstrap line cannot be written', () => {
    expect(() => BymaxNotificationModule.forRoot({ email })).not.toThrow()
  })

  it('should let forRootAsync compile when the bootstrap line cannot be written', async () => {
    const compiling = Test.createTestingModule({
      imports: [BymaxNotificationModule.forRootAsync({ useFactory: () => ({ email }) })]
    }).compile()

    await expect(compiling).resolves.toBeDefined()
  })

  it('should let the audit write warning return when its line cannot be written', () => {
    const warning = new AuditWriteWarning(new Logger('Test'), 'email')

    expect(() => warning.warn(new Error('repository down'))).not.toThrow()
  })

  it('should still send an email whose audit failure is swallowed', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        BymaxNotificationModule.forRoot({
          email,
          audit: {
            repository: {
              name: 'broken',
              create: async () => {
                throw new Error('repository down')
              }
            },
            swallowErrors: true
          }
        })
      ]
    }).compile()

    const sent = moduleRef
      .get(EmailService)
      .send({ tenantId: 't', to: 'a@example.com', subject: 's', html: '<p>x</p>' })

    await expect(sent).resolves.toMatchObject({ messageId: 'x' })
  })
})
