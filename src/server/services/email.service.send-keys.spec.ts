/**
 * @fileoverview Holds the lists of fields the send reader copies to every field of the types they
 * name: the file fails to compile when a type gains a field a list misses.
 * @layer domain
 */

import type { UnlistedEntryKey } from '../utils/email-send-input'
import type { UnlistedSendKey, UnlistedTemplateKey } from './email-send-keys'
import type { UnlistedDispatchEmailKey } from './dispatch-email-keys'
import type { UnlistedGenerateKey, UnlistedRefKey, UnlistedVerifyKey } from './otp-generate-input'

// `[X] extends [never]` is `true` only when nothing is unlisted; the literal `true` then fails to
// compile for any other answer, which an assignment of `[]` to an array of the keys never does.
const sendKeysComplete: [UnlistedSendKey] extends [never] ? true : false = true
const templateKeysComplete: [UnlistedTemplateKey] extends [never] ? true : false = true
const generateKeysComplete: [UnlistedGenerateKey] extends [never] ? true : false = true
const dispatchKeysComplete: [UnlistedDispatchEmailKey] extends [never] ? true : false = true
const verifyKeysComplete: [UnlistedVerifyKey] extends [never] ? true : false = true
const refKeysComplete: [UnlistedRefKey] extends [never] ? true : false = true
const entryKeysComplete: [UnlistedEntryKey] extends [never] ? true : false = true

describe('the fields of a send the reader copies', () => {
  it('should leave no field of a send, a template send, a generate, a tag or an attachment unlisted', () => {
    expect([
      sendKeysComplete,
      templateKeysComplete,
      generateKeysComplete,
      entryKeysComplete
    ]).toEqual([true, true, true, true])
  })
})
