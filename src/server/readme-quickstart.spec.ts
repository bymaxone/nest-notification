/**
 * @fileoverview Executes the README development Quick Start as written: the module and the
 * verification service are compiled from the README text, not from a copy, and run against a real
 * Nest testing graph. The only substitution is the email provider, which is replaced by a stand-in
 * that keeps the delivered message, so the flow the section describes can be driven end to end.
 *
 * The README blocks run through `vm`, whose realm has its own `Reflect` without `metadata`:
 * the decorators would record no constructor types and Nest would inject nothing. The test's own
 * `Reflect` is handed in instead.
 * @layer integration
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compileFunction } from 'node:vm'

import { Test } from '@nestjs/testing'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

import * as library from './index'
import type { EmailSendOptions, IEmailProvider } from './interfaces/email-provider.interface'

const readme = readFileSync(join(__dirname, '..', '..', 'README.md'), 'utf8')

/** The TypeScript blocks of the development Quick Start, in the order the README shows them. */
function developmentBlocks(): ReadonlyArray<string> {
  const start = readme.indexOf('### 2. Development')
  const end = readme.indexOf('### 3. Production')
  const blocks = Array.from(
    readme.slice(start, end).matchAll(/```typescript\n([\s\S]*?)```/g),
    (match) => match[1] ?? ''
  )
  return blocks
}

/** Compile one README block and run it, resolving its imports through the given modules. */
function runBlock(block: string, modules: Record<string, unknown>): Record<string, unknown> {
  const { outputText } = transpileModule(block, {
    compilerOptions: {
      module: ModuleKind.CommonJS,
      target: ScriptTarget.ES2022,
      experimentalDecorators: true,
      emitDecoratorMetadata: true
    }
  })
  const exported: Record<string, unknown> = {}
  const load = (specifier: string): unknown => {
    if (specifier in modules) return modules[specifier]
    throw new Error(`The Quick Start imports "${specifier}", which this test does not provide`)
  }
  // `vm` runs the code in another realm, whose `Reflect` has no `metadata`: the decorators
  // would record no constructor types and Nest would inject nothing. Hand it the test's own.
  compileFunction(outputText, ['require', 'exports', 'Reflect'])(load, exported, Reflect)
  return exported
}

/** Stands in for `NoOpEmailProvider`: it keeps what was sent instead of logging it. */
class CapturingEmailProvider implements IEmailProvider {
  readonly name = 'capturing'
  readonly sent: EmailSendOptions[] = []

  isConfigured(): boolean {
    return true
  }

  async send(options: EmailSendOptions): Promise<{ messageId: string }> {
    this.sent.push(options)
    return { messageId: `msg-${this.sent.length}` }
  }
}

interface VerificationService {
  start(tenantId: string, email: string): Promise<{ expiresAt: number }>
  confirm(tenantId: string, email: string, code: string): Promise<boolean>
}

describe('README development Quick Start', () => {
  const provider = new CapturingEmailProvider()
  const modules = {
    '@nestjs/common': require('@nestjs/common') as unknown,
    '@bymax-one/nest-notification': {
      ...library,
      NoOpEmailProvider: class {
        constructor() {
          return provider
        }
      }
    }
  }

  /** Compiles the README module and service and boots them in a testing graph. */
  async function boot(): Promise<VerificationService> {
    const [moduleBlock, serviceBlock] = developmentBlocks()
    const AppModule = runBlock(moduleBlock ?? '', modules).AppModule as new () => unknown
    const Service = runBlock(serviceBlock ?? '', modules).VerificationService as new (
      ...args: never[]
    ) => VerificationService
    const booted = await Test.createTestingModule({
      imports: [AppModule],
      providers: [Service]
    }).compile()
    return booted.get(Service)
  }

  beforeEach(() => {
    provider.sent.length = 0
  })

  it('should show a module block followed by a service block', () => {
    /**
     * Guards the extraction, not the library: a README that reorders or drops these two blocks
     * fails here with a clear message instead of failing inside the compiled snippet.
     */
    const [moduleBlock, serviceBlock] = developmentBlocks()

    expect(moduleBlock).toContain('export class AppModule')
    expect(serviceBlock).toContain('export class VerificationService')
  })

  it('should define the same otp_code template in the development and production sections', () => {
    /**
     * Guards against drift between the two sections: the development module must carry the same
     * `otp_code::en` template text as the production one, so a reader who starts with one and
     * moves to the other changes nothing but the provider and the storage.
     */
    const template = (section: string): string | undefined =>
      /'otp_code::en': \{[\s\S]*?\n {12}\}/.exec(section)?.[0]
    const development = readme.slice(
      readme.indexOf('### 2. Development'),
      readme.indexOf('### 3. Production')
    )
    const production = readme.slice(
      readme.indexOf('### 3. Production'),
      readme.indexOf('### 4. SMTP')
    )

    expect(template(development)).toBeDefined()
    expect(template(development)).toBe(template(production))
  })

  it('should issue a code, deliver it, and verify it', async () => {
    /**
     * Guards the README section "2. Development": the module registers, `start` delivers one
     * email to the address given and returns an expiry, a wrong code is refused, and the code in
     * that email verifies.
     */
    const service = await boot()

    const { expiresAt } = await service.start('acme', 'jane@example.com')

    expect(expiresAt).toBeGreaterThan(Date.now())
    expect(provider.sent).toHaveLength(1)
    expect(provider.sent[0]?.to).toBe('jane@example.com')
    const code = /\b[0-9]{6}\b/.exec(`${provider.sent[0]?.text ?? ''} ${provider.sent[0]?.html}`)
    expect(code).not.toBeNull()
    expect(await service.confirm('acme', 'jane@example.com', 'ABCDEF')).toBe(false)
    expect(await service.confirm('acme', 'jane@example.com', code?.[0] ?? '')).toBe(true)
  })
})
