/**
 * @fileoverview Pins the whole `DEFAULT_TTLS` table by exact value. The table is the public
 * recommendation consumers copy from, and a mutation run neither removes an entry from it nor
 * changes a number in it, so only an assertion on the entire table keeps every entry in place.
 * @layer shared
 */

import { DEFAULT_TTLS } from './default-ttls'

describe('DEFAULT_TTLS', () => {
  // The whole table, entry by entry and with no extra key: a removed entry, a changed number
  // and an added entry each fail it.
  it('should be exactly the published table', () => {
    expect(DEFAULT_TTLS).toStrictEqual({
      OTP_EMAIL_VERIFICATION_SECONDS: 3600,
      OTP_PASSWORD_RESET_SECONDS: 600,
      OTP_MFA_OOB_SECONDS: 300,
      OTP_PHONE_VERIFICATION_SECONDS: 600,
      OTP_MAGIC_LINK_SECONDS: 900,
      RESEND_COOLDOWN_SECONDS: 60,
      OTP_GENERIC_SECONDS: 600
    })
  })
})
