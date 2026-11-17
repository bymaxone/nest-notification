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
import { readOptionKeys } from '../utils/read-options'

/** Every key of the options the module takes. */
const MODULE_KEYS = [
  'global',
  'email',
  'otp',
  'sms',
  'push',
  'audit'
] as const satisfies readonly (keyof BymaxNotificationModuleOptions)[]

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
 * The purposes a container holds: its own enumerable keys, and the property names of the prototypes
 * it inherits from before `Object.prototype`, so a class used as a record, with a getter for each
 * purpose, is read the way a plain object is.
 */
function purposesOf(container: object): string[] {
  const names = new Set(Object.keys(container))
  for (
    let prototype: object | null = Object.getPrototypeOf(container) as object | null;
    prototype !== null && prototype !== Object.prototype;
    prototype = Object.getPrototypeOf(prototype) as object | null
  ) {
    for (const name of Object.getOwnPropertyNames(prototype)) {
      if (name !== 'constructor') {
        names.add(name)
      }
    }
  }
  return [...names]
}

/** The `perPurpose` container, and each entry in it, read once; anything else as it is. */
function readPerPurpose<T>(perPurpose: T): T {
  if (typeof perPurpose !== 'object' || perPurpose === null || Array.isArray(perPurpose)) {
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
  const read = readOptionKeys(options, MODULE_KEYS)
  if (read.global !== undefined) {
    read.global = readOptionKeys(read.global, GLOBAL_KEYS)
  }
  if (read.email !== undefined) {
    read.email = readOptionKeys(read.email, EMAIL_KEYS)
  }
  if (read.audit !== undefined) {
    read.audit = readOptionKeys(read.audit, AUDIT_KEYS)
  }
  if (read.otp !== undefined) {
    const otp = readOptionKeys(read.otp, OTP_KEYS)
    if (typeof otp === 'object' && otp !== null && otp.perPurpose !== undefined) {
      otp.perPurpose = readPerPurpose(otp.perPurpose)
    }
    read.otp = otp
  }
  return read
}
