/**
 * @fileoverview Reads the input of a generate once, by name, so one value of each field is checked
 * and used.
 * @layer domain
 *
 * `deliverVia` decides whether the recipient is checked as a mailbox and whether the code is
 * delivered by email. A getter that answers `'manual'` to the first read and `'email'` to the last
 * would be checked as one and delivered as the other, so the fields are copied before anything runs.
 */

import { copyByName } from '../utils/bounded-list'
import { assertDeliverVia } from '../utils/otp-input'
import type { OtpGenerateInput, OtpVerifyInput } from './otp.service'

/** Every field of {@link OtpGenerateInput}, read by name. */
const GENERATE_KEYS = [
  'tenantId',
  'recipient',
  'purpose',
  'userId',
  'deliverVia',
  'emailTemplate',
  'emailData',
  'locale'
] as const satisfies readonly (keyof OtpGenerateInput)[]

/** The fields of {@link OtpGenerateInput} that the list leaves out; `never` while it lists them all. */
export type UnlistedGenerateKey = Exclude<keyof OtpGenerateInput, (typeof GENERATE_KEYS)[number]>

/**
 * Copies the input of a generate, each field read once.
 *
 * @param input - The input as the caller gave it.
 * @returns A plain copy that the rest of the call uses.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` for a `deliverVia` that is not known.
 */
export function readGenerateInput(input: OtpGenerateInput): OtpGenerateInput {
  const copy = copyByName(input, GENERATE_KEYS)
  assertDeliverVia('OtpService', copy.deliverVia)
  return copy as unknown as OtpGenerateInput
}

/** Every field of {@link OtpVerifyInput}, read by name. */
const VERIFY_KEYS = [
  'tenantId',
  'recipient',
  'purpose',
  'userId',
  'code'
] as const satisfies readonly (keyof OtpVerifyInput)[]

/** The fields of {@link OtpVerifyInput} that the list leaves out; `never` while it lists them all. */
export type UnlistedVerifyKey = Exclude<keyof OtpVerifyInput, (typeof VERIFY_KEYS)[number]>

/**
 * Copies the input of a verify, each field read once.
 *
 * @param input - The input as the caller gave it.
 * @returns A plain copy that the rest of the call uses.
 */
export function readVerifyInput(input: OtpVerifyInput): OtpVerifyInput {
  return copyByName(input, VERIFY_KEYS) as unknown as OtpVerifyInput
}
