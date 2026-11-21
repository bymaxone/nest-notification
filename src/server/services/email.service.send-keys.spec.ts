/**
 * @fileoverview Holds the lists of fields the send reader copies to every field of the types they
 * name: the file fails to compile when a type gains a field a list misses.
 * @layer domain
 */

import type { UnlistedEntryKey } from '../utils/email-send-input'
import type { UnlistedSendKey } from './email.service'

// `[X] extends [never]` is `true` only when nothing is unlisted; the literal `true` then fails to
// compile for any other answer, which an assignment of `[]` to an array of the keys never does.
const sendKeysComplete: [UnlistedSendKey] extends [never] ? true : false = true
const entryKeysComplete: [UnlistedEntryKey] extends [never] ? true : false = true

describe('the fields of a send the reader copies', () => {
  it('should leave no field of EmailSendInput, a tag or an attachment unlisted', () => {
    expect([sendKeysComplete, entryKeysComplete]).toEqual([true, true])
  })
})
