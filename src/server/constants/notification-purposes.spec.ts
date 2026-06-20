import { NOTIFICATION_PURPOSES } from './notification-purposes'

describe('NOTIFICATION_PURPOSES', () => {
  // The canonical purposes are a documented contract; the values must be the
  // exact snake_case strings the OTP layer keys on.
  it('should map each canonical name to its snake_case value', () => {
    expect(NOTIFICATION_PURPOSES).toEqual({
      EMAIL_VERIFICATION: 'email_verification',
      PASSWORD_RESET: 'password_reset',
      MFA_OOB: 'mfa_oob',
      PHONE_VERIFICATION: 'phone_verification',
      MAGIC_LINK: 'magic_link'
    })
  })
})
