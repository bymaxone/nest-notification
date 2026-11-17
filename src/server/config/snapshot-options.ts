/**
 * @fileoverview A copy of the module options that is read once.
 * @layer application
 *
 * Options are validated and then used. A getter or a Proxy on the host's object may answer with a
 * valid value the first time and another afterwards, and the second answer would then be stored
 * without having been checked. The module copies the options first, validates the copy and builds
 * every service from it, so what is checked is what is kept.
 *
 * Only the option sections are copied, one level at a time down to each `perPurpose` entry:
 * providers, stores, repositories and resolvers are the host's objects and stay as they are.
 */

import type { BymaxNotificationModuleOptions } from '../interfaces/notification-module-options.interface'

/**
 * A shallow copy of a section when it is a plain object; anything else is returned as it is. An
 * array is not a section: spreading it into `{}` would turn it into an object that passes the
 * validation that refuses it.
 */
function copySection<T>(section: T): T {
  return typeof section === 'object' && section !== null && !Array.isArray(section)
    ? { ...section }
    : section
}

/** A copy of the `perPurpose` container and of each entry in it, or the value as it is. */
function copyPerPurpose<T>(perPurpose: T): T {
  if (typeof perPurpose !== 'object' || perPurpose === null || Array.isArray(perPurpose)) {
    return perPurpose
  }
  return Object.fromEntries(
    Object.entries(perPurpose).map(([key, entry]) => [key, copySection(entry)])
  ) as T
}

/**
 * Copies the options, reading each of them once.
 *
 * @param options - The options as the host gave them.
 * @returns Options of the same shape whose sections are fresh objects.
 */
export function snapshotOptions(
  options: BymaxNotificationModuleOptions
): BymaxNotificationModuleOptions {
  const copy = { ...options }
  if (copy.global !== undefined) {
    copy.global = copySection(copy.global)
  }
  if (copy.email !== undefined) {
    copy.email = copySection(copy.email)
  }
  if (copy.audit !== undefined) {
    copy.audit = copySection(copy.audit)
  }
  if (typeof copy.otp === 'object' && copy.otp !== null) {
    const otp = { ...copy.otp }
    if (otp.perPurpose !== undefined) {
      otp.perPurpose = copyPerPurpose(otp.perPurpose)
    }
    copy.otp = otp
  }
  return copy
}
