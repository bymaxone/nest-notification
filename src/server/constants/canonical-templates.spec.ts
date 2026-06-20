import { CANONICAL_EMAIL_TEMPLATES } from './canonical-templates'

describe('CANONICAL_EMAIL_TEMPLATES', () => {
  // The canonical names are a documented convention shared with consumers; the
  // values must be the exact snake_case strings a renderer keys on.
  it('should map each canonical name to its snake_case value', () => {
    expect(CANONICAL_EMAIL_TEMPLATES).toEqual({
      OTP_CODE: 'otp_code',
      OTP_PASSWORD_RESET: 'otp_password_reset',
      OTP_RESENT: 'otp_resent',
      WELCOME: 'welcome',
      PASSWORD_RESET_SUCCESS: 'password_reset_success',
      TRIAL_EXPIRING: 'trial_expiring',
      TRIAL_EXPIRED: 'trial_expired',
      NEW_LOGIN_ALERT: 'new_login_alert',
      MFA_ENABLED: 'mfa_enabled',
      MFA_DISABLED: 'mfa_disabled'
    })
  })
})
