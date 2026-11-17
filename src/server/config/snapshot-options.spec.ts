/**
 * @fileoverview Holds the options snapshot to reading what the host gave once. Options are
 * validated and then used, and a getter or a Proxy that answers differently on the second read
 * would pass the validation with one value and be stored with another. The module therefore takes
 * a copy first, validates the copy and resolves the copy.
 * @layer infrastructure
 */

import type { BymaxNotificationModuleOptions, IEmailProvider, IOtpStorage } from '../interfaces'
import type {
  AuditOptions,
  EmailChannelOptions,
  GlobalOptions,
  OtpChannelOptions,
  OtpPurposeConfig
} from '../interfaces/notification-module-options.interface'

import { snapshotOptions } from './snapshot-options'

const storage = {} as IOtpStorage
const provider = {} as IEmailProvider

/** An accessor that answers `first` once and `later` for every read after. */
function flipping(first: unknown, later: unknown): { get: () => unknown; reads: () => number } {
  let reads = 0
  return {
    get: () => {
      reads += 1
      return reads === 1 ? first : later
    },
    reads: () => reads
  }
}

describe('snapshotOptions', () => {
  it('should read each option once', () => {
    const attempts = flipping(3, Number.NaN)
    const ttl = flipping(60, -1)
    const otp = { storage }
    Object.defineProperty(otp, 'defaultMaxAttempts', { get: attempts.get, enumerable: true })
    Object.defineProperty(otp, 'defaultTtlSeconds', { get: ttl.get, enumerable: true })

    const copy = snapshotOptions({ otp } as never)

    expect(copy.otp?.defaultMaxAttempts).toBe(3)
    expect(copy.otp?.defaultTtlSeconds).toBe(60)
    expect(attempts.reads()).toBe(1)
    expect(ttl.reads()).toBe(1)
  })

  it('should read the sections and the perPurpose container once', () => {
    const email = flipping({ provider, defaultFrom: 'a@b.com' }, null)
    const perPurpose = flipping({ mfa_oob: { maxAttempts: 2 } }, null)
    const options = {} as Record<string, unknown>
    Object.defineProperty(options, 'email', { get: email.get, enumerable: true })
    const otp = { storage }
    Object.defineProperty(otp, 'perPurpose', { get: perPurpose.get, enumerable: true })
    options.otp = otp

    const copy = snapshotOptions(options as never)

    expect(copy.email?.defaultFrom).toBe('a@b.com')
    expect(copy.otp?.perPurpose).toEqual({ mfa_oob: { maxAttempts: 2 } })
    expect(email.reads()).toBe(1)
    expect(perPurpose.reads()).toBe(1)
  })

  it('should read each perPurpose entry once', () => {
    const attempts = flipping(2, Number.NaN)
    const entry = {}
    Object.defineProperty(entry, 'maxAttempts', { get: attempts.get, enumerable: true })

    const copy = snapshotOptions({ otp: { storage, perPurpose: { mfa_oob: entry } } } as never)

    expect(copy.otp?.perPurpose?.['mfa_oob']?.maxAttempts).toBe(2)
    expect(attempts.reads()).toBe(1)
  })

  it('should hand back sections the host cannot change afterwards', () => {
    const options = {
      email: { provider, defaultFrom: 'a@b.com' },
      otp: { storage, defaultMaxAttempts: 3, perPurpose: { mfa_oob: { maxAttempts: 2 } } },
      audit: { swallowErrors: true },
      global: { defaultLocale: 'en' }
    } as unknown as BymaxNotificationModuleOptions

    const copy = snapshotOptions(options)
    ;(options.otp as { defaultMaxAttempts: number }).defaultMaxAttempts = 99
    ;(options.otp?.perPurpose?.['mfa_oob'] as { maxAttempts: number }).maxAttempts = 99
    ;(options.email as { defaultFrom: string }).defaultFrom = 'x@y.com'
    ;(options.audit as { swallowErrors: boolean }).swallowErrors = false
    ;(options.global as { defaultLocale: string }).defaultLocale = 'pt'

    expect(copy.otp?.defaultMaxAttempts).toBe(3)
    expect(copy.otp?.perPurpose?.['mfa_oob']?.maxAttempts).toBe(2)
    expect(copy.email?.defaultFrom).toBe('a@b.com')
    expect(copy.audit?.swallowErrors).toBe(true)
    expect(copy.global?.defaultLocale).toBe('en')
  })

  // Providers, stores and repositories are the host's objects: they are not copied.
  it('should keep the host objects by reference', () => {
    const repository = { create: jest.fn() }
    const copy = snapshotOptions({
      email: { provider, defaultFrom: 'a@b.com' },
      otp: { storage },
      audit: { repository }
    } as never)

    expect(copy.email?.provider).toBe(provider)
    expect(copy.otp?.storage).toBe(storage)
    expect(copy.audit?.repository).toBe(repository)
  })

  // An array is not a section or an entry, and spreading it into `{}` would hide it from the
  // validation that refuses it: it is kept as it is.
  it('should keep an array where a section or an entry is expected', () => {
    const entry: unknown[] = []
    const email: unknown[] = ['x']

    const copy = snapshotOptions({
      email,
      otp: { storage, perPurpose: { mfa_oob: entry } }
    } as never)

    expect(copy.email).toBe(email)
    expect(copy.otp?.perPurpose?.['mfa_oob']).toBe(entry)
  })

  it('should leave absent sections absent and a section that is not an object as it is', () => {
    expect(snapshotOptions({ email: { provider, defaultFrom: 'a@b.com' } } as never)).toEqual({
      email: { provider, defaultFrom: 'a@b.com' }
    })
    expect(snapshotOptions({ otp: null } as never)).toEqual({})
    expect(
      snapshotOptions({ otp: { storage, perPurpose: 'login' } } as never).otp?.perPurpose
    ).toBe('login')
    expect(
      snapshotOptions({ otp: { storage, perPurpose: [{}] } } as never).otp?.perPurpose
    ).toEqual([{}])
    expect(
      snapshotOptions({ otp: { storage, perPurpose: { a: null, b: 5 } } } as never).otp?.perPurpose
    ).toEqual({ a: null, b: 5 })
  })

  // A host may pass a class whose options are getters on the prototype, reading a ConfigService.
  // They are read by property access, so own and prototype getters both work, once each.
  it('should keep the options a class instance supplies from its prototype', () => {
    let ttlReads = 0
    class Otp {
      readonly storage = storage
      get defaultTtlSeconds(): number {
        ttlReads += 1
        return ttlReads === 1 ? 120 : -1
      }
      get defaultMaxAttempts(): number {
        return 4
      }
    }
    class Email {
      readonly provider = provider
      get defaultFrom(): string {
        return 'noreply@relay.example'
      }
    }
    class Global {
      get defaultLocale(): string {
        return 'pt'
      }
    }
    class Entry {
      get maxAttempts(): number {
        return 2
      }
    }
    class Container {
      get mfa_oob(): Entry {
        return new Entry()
      }
    }
    const otp = new Otp() as unknown as { perPurpose?: unknown }
    otp.perPurpose = new Container()

    const copy = snapshotOptions({
      otp: otp as never,
      email: new Email() as never,
      global: new Global() as never
    })

    expect(copy.otp?.defaultTtlSeconds).toBe(120)
    expect(ttlReads).toBe(1)
    expect(copy.otp?.defaultMaxAttempts).toBe(4)
    expect(copy.email?.defaultFrom).toBe('noreply@relay.example')
    expect(copy.global?.defaultLocale).toBe('pt')
    expect(copy.otp?.perPurpose).toEqual({ mfa_oob: { maxAttempts: 2 } })
  })

  // The purposes of a container are its own keys, so a class used as a record is read through the
  // property names of its prototype chain as well, and nothing it inherits from Object.
  it('should read the purposes of a container class from its prototype', () => {
    class Entry {
      get maxAttempts(): number {
        return 2
      }
    }
    class Container {
      readonly own = { ttlSeconds: 30 }
      get mfa_oob(): Entry {
        return new Entry()
      }
    }

    const copy = snapshotOptions({ otp: { storage, perPurpose: new Container() } } as never)

    expect(copy.otp?.perPurpose).toEqual({ own: { ttlSeconds: 30 }, mfa_oob: { maxAttempts: 2 } })
  })

  // The cases of reading a container, one each: what is a purpose and what is not.
  describe('the purposes a container holds', () => {
    const purposes = (container: object): string[] =>
      Object.keys(
        snapshotOptions({ otp: { storage, perPurpose: container } } as never).otp?.perPurpose ?? {}
      )

    it('should take a getter of a parent class too', () => {
      class Base {
        get from_base(): object {
          return {}
        }
      }
      class Child extends Base {
        get from_child(): object {
          return {}
        }
      }

      expect(purposes(new Child()).sort()).toEqual(['from_base', 'from_child'])
    })

    it('should not take a method, the constructor or a symbol', () => {
      const symbol = Symbol('purpose')
      class Container {
        helper(): object {
          return {}
        }
        get real(): object {
          return {}
        }
        readonly [symbol] = {}
      }

      expect(purposes(new Container())).toEqual(['real'])
    })

    it('should not take a non-enumerable own key', () => {
      const container = { shown: {} }
      Object.defineProperty(container, 'hidden', { value: {}, enumerable: false })

      expect(purposes(container)).toEqual(['shown'])
    })

    it('should list a purpose once when an own key shadows a getter, and keep the own value', () => {
      class Container {
        get mfa_oob(): object {
          return { maxAttempts: 9 }
        }
      }
      const container = new Container()
      Object.defineProperty(container, 'mfa_oob', {
        value: { maxAttempts: 2 },
        enumerable: true
      })

      const copy = snapshotOptions({ otp: { storage, perPurpose: container } } as never)

      expect(copy.otp?.perPurpose).toEqual({ mfa_oob: { maxAttempts: 2 } })
    })

    it('should read each getter once', () => {
      let reads = 0
      class Container {
        get mfa_oob(): object {
          reads += 1
          return { maxAttempts: 2 }
        }
      }

      snapshotOptions({ otp: { storage, perPurpose: new Container() } } as never)

      expect(reads).toBe(1)
    })

    it('should read a container that has no prototype', () => {
      const container = Object.create(null) as Record<string, object>
      container['mfa_oob'] = { maxAttempts: 2 }

      const copy = snapshotOptions({ otp: { storage, perPurpose: container } } as never)

      expect(copy.otp?.perPurpose).toEqual({ mfa_oob: { maxAttempts: 2 } })
    })

    it('should keep a purpose named __proto__ as an own key', () => {
      const container = JSON.parse('{"__proto__":{"maxAttempts":2}}') as object

      const copy = snapshotOptions({ otp: { storage, perPurpose: container } } as never)

      expect(Object.keys(copy.otp?.perPurpose ?? {})).toEqual(['__proto__'])
    })
  })

  it('should not take the purposes of a plain container from Object', () => {
    const copy = snapshotOptions({ otp: { storage, perPurpose: { mfa_oob: {} } } } as never)

    expect(Object.keys(copy.otp?.perPurpose ?? {})).toEqual(['mfa_oob'])
  })

  // The validation refuses these with a message that names the options.
  it.each([undefined, null, 'x', 5, true])('should return %p as it is', (value) => {
    expect(snapshotOptions(value as never)).toBe(value)
  })

  it('should return an array as it is', () => {
    const options: unknown[] = []

    expect(snapshotOptions(options as never)).toBe(options)
  })

  // Every option of the interfaces is copied. These literals must list every key (the compiler
  // refuses one that misses a key, so adding an option forces an update here), and each key must
  // survive the copy: an option that is not on the list would be dropped without a sound.
  describe('every option of every section', () => {
    it('should copy every option of the module', () => {
      const options = {
        global: {} as never,
        email: {} as never,
        otp: {} as never,
        sms: {} as never,
        push: {} as never,
        audit: {} as never
      } satisfies Required<BymaxNotificationModuleOptions>

      expect(snapshotOptions(options as never)).toEqual(options)
    })

    it('should copy every option of global', () => {
      const global = {
        redisNamespace: 'ns',
        defaultLocale: 'pt',
        tenantIdResolver: () => 't'
      } satisfies Required<GlobalOptions>

      expect(snapshotOptions({ global } as never).global).toEqual(global)
    })

    it('should copy every option of email', () => {
      const email = {
        provider,
        defaultFrom: 'a@b.com',
        defaultFromName: 'Acme',
        templateRenderer: {} as never,
        defaultReplyTo: 'r@b.com',
        defaultTags: [{ name: 'a', value: 'b' }],
        maxAttachmentBytes: 1,
        maxRecipients: 2
      } satisfies Required<EmailChannelOptions>

      expect(snapshotOptions({ email } as never).email).toEqual(email)
    })

    it('should copy every option of otp and of a perPurpose entry', () => {
      const entry = {
        length: 8,
        codeType: 'numeric',
        ttlSeconds: 60,
        maxAttempts: 3,
        resendCooldownSeconds: 5
      } satisfies Required<OtpPurposeConfig>
      const otp = {
        storage,
        defaultLength: 6,
        defaultCodeType: 'alpha',
        defaultTtlSeconds: 10,
        defaultMaxAttempts: 2,
        resendCooldownSeconds: 1,
        consumeOnVerify: true,
        codeSecret: 'x'.repeat(40),
        perPurpose: { mfa_oob: entry },
        strictPurposes: true
      } satisfies Required<OtpChannelOptions>

      expect(snapshotOptions({ otp } as never).otp).toEqual(otp)
    })

    it('should copy every option of audit', () => {
      const audit = {
        repository: {} as never,
        swallowErrors: false,
        maskRecipient: (value: string) => value
      } satisfies Required<AuditOptions>

      expect(snapshotOptions({ audit } as never).audit).toEqual(audit)
    })
  })
})
