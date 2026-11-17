/**
 * @fileoverview A copy of the module options that is read once.
 * @layer application
 *
 * Options are validated and then used. A getter or a Proxy on the host's object may answer with a
 * valid value the first time and another afterwards, and the second answer would then be stored
 * without having been checked. The module reads the options once into plain objects, validates
 * those and builds every service from them, so what is checked is what is kept.
 *
 * Only the option sections are read, one level at a time down to each `perPurpose` entry:
 * providers, stores, repositories and resolvers are the host's objects and stay as they are. Each
 * section is read by property access on its known keys (see {@link readOptionKeys}), so a class that
 * supplies its options from the prototype works as a plain object does.
 */

import type {
  AuditOptions,
  BymaxNotificationModuleOptions,
  EmailChannelOptions,
  GlobalOptions,
  OtpChannelOptions,
  OtpPurposeConfig
} from '../interfaces/notification-module-options.interface'
import { isPlainOrClassInstance, readOptionKeys } from '../utils/read-options'

/** A default tag of the email channel. */
type DefaultTag = NonNullable<EmailChannelOptions['defaultTags']>[number]

/** Every key of the options the module takes. */
const MODULE_KEYS = [
  'global',
  'email',
  'otp',
  'sms',
  'push',
  'audit'
] as const satisfies readonly (keyof BymaxNotificationModuleOptions)[]

/** The group whose omission turns the audit trail off: a `null` is refused, not read as omitted. */
const MODULE_WEAKER_WHEN_UNSET = [
  'audit'
] as const satisfies readonly (keyof BymaxNotificationModuleOptions)[]

/** Every key of a default tag. */
const TAG_KEYS = ['name', 'value'] as const satisfies readonly (keyof DefaultTag)[]

/** Every key of the `global` section. */
const GLOBAL_KEYS = [
  'redisNamespace',
  'defaultLocale',
  'tenantIdResolver'
] as const satisfies readonly (keyof GlobalOptions)[]

/** Every key of the `email` section. */
const EMAIL_KEYS = [
  'provider',
  'defaultFrom',
  'defaultFromName',
  'templateRenderer',
  'defaultReplyTo',
  'defaultTags',
  'maxAttachmentBytes',
  'maxRecipients'
] as const satisfies readonly (keyof EmailChannelOptions)[]

/** Every key of the `otp` section. */
const OTP_KEYS = [
  'storage',
  'defaultLength',
  'defaultCodeType',
  'defaultTtlSeconds',
  'defaultMaxAttempts',
  'resendCooldownSeconds',
  'consumeOnVerify',
  'codeSecret',
  'perPurpose',
  'strictPurposes'
] as const satisfies readonly (keyof OtpChannelOptions)[]

/** Options whose default is the weaker posture (no key, non-strict, not consumed): a `null` is refused, not defaulted. */
const WEAKER_WHEN_UNSET = [
  'codeSecret',
  'strictPurposes',
  'consumeOnVerify'
] as const satisfies readonly (keyof OtpChannelOptions)[]

/** The same for the global section: no tenant resolver means the payload's tenant is trusted. */
const GLOBAL_WEAKER_WHEN_UNSET = [
  'tenantIdResolver'
] as const satisfies readonly (keyof GlobalOptions)[]

/** The same for the audit section: errors not swallowed, and recipients masked. */
const AUDIT_WEAKER_WHEN_UNSET = [
  'swallowErrors',
  'maskRecipient'
] as const satisfies readonly (keyof AuditOptions)[]

/** Every key of a `perPurpose` entry. */
const PURPOSE_KEYS = [
  'length',
  'codeType',
  'ttlSeconds',
  'maxAttempts',
  'resendCooldownSeconds'
] as const satisfies readonly (keyof OtpPurposeConfig)[]

/** Every key of the `audit` section. */
const AUDIT_KEYS = [
  'repository',
  'swallowErrors',
  'maskRecipient'
] as const satisfies readonly (keyof AuditOptions)[]

/**
 * The purposes a container holds: its own enumerable string keys, and the accessors (getters) of
 * the prototypes it inherits from before `Object.prototype`. A class used as a record, with a getter
 * for each purpose, is read the way a plain object is. A method, `constructor`, a symbol and a
 * non-enumerable own key are not purposes.
 */
function purposesOf(container: object): string[] {
  const names = new Set(Object.keys(container))
  for (
    let prototype = Object.getPrototypeOf(container) as object | null;
    prototype !== null && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype) as object | null
  ) {
    for (const [name, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(prototype))) {
      if (descriptor.get !== undefined) {
        names.add(name)
      }
    }
  }
  return [...names]
}

/** The `perPurpose` container, and each entry in it, read once; anything else as it is. */
function readPerPurpose<T>(perPurpose: T): T {
  if (
    typeof perPurpose !== 'object' ||
    perPurpose === null ||
    Array.isArray(perPurpose) ||
    !isPlainOrClassInstance(perPurpose)
  ) {
    return perPurpose
  }
  const entries = purposesOf(perPurpose).map(
    (key) =>
      [
        key,
        readOptionKeys(Reflect.get(perPurpose, key) as Partial<OtpPurposeConfig>, PURPOSE_KEYS)
      ] as const
  )
  return Object.fromEntries(entries) as T
}

/**
 * Reads the options once into plain objects.
 *
 * @param options - The options as the host gave them.
 * @returns Options of the same shape whose sections are fresh plain objects.
 */
export function snapshotOptions(
  options: BymaxNotificationModuleOptions
): BymaxNotificationModuleOptions {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    return options
  }
  const read = readOptionKeys(options, MODULE_KEYS, MODULE_WEAKER_WHEN_UNSET)
  if (read.global !== undefined) {
    read.global = readOptionKeys(read.global, GLOBAL_KEYS, GLOBAL_WEAKER_WHEN_UNSET)
  }
  if (read.email !== undefined) {
    const email = readOptionKeys(read.email, EMAIL_KEYS)
    if (Array.isArray(email.defaultTags)) {
      email.defaultTags = email.defaultTags.map((tag: DefaultTag) => readOptionKeys(tag, TAG_KEYS))
    }
    read.email = email
  }
  if (read.audit !== undefined) {
    read.audit = readOptionKeys(read.audit, AUDIT_KEYS, AUDIT_WEAKER_WHEN_UNSET)
  }
  if (read.otp !== undefined) {
    const otp = readOptionKeys(read.otp, OTP_KEYS, WEAKER_WHEN_UNSET)
    if (otp.perPurpose !== undefined) {
      otp.perPurpose = readPerPurpose(otp.perPurpose)
    }
    read.otp = otp
  }
  return read
}
