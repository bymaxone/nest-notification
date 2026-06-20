import {
  BYMAX_NOTIFICATION_EMAIL_PROVIDER,
  BYMAX_NOTIFICATION_LOG_REPOSITORY,
  BYMAX_NOTIFICATION_OPTIONS,
  BYMAX_NOTIFICATION_OTP_STORAGE,
  BYMAX_NOTIFICATION_PUSH_PROVIDER,
  BYMAX_NOTIFICATION_SMS_PROVIDER,
  BYMAX_NOTIFICATION_TEMPLATE_RENDERER
} from './bymax-notification.constants'

describe('injection tokens', () => {
  const tokens = [
    BYMAX_NOTIFICATION_OPTIONS,
    BYMAX_NOTIFICATION_EMAIL_PROVIDER,
    BYMAX_NOTIFICATION_OTP_STORAGE,
    BYMAX_NOTIFICATION_SMS_PROVIDER,
    BYMAX_NOTIFICATION_PUSH_PROVIDER,
    BYMAX_NOTIFICATION_TEMPLATE_RENDERER,
    BYMAX_NOTIFICATION_LOG_REPOSITORY
  ]

  // Tokens must be symbols (not strings) so they cannot collide with another
  // library's DI tokens in the same container.
  it('should declare every token as a symbol', () => {
    for (const token of tokens) {
      expect(typeof token).toBe('symbol')
    }
  })

  // Each token must be distinct; a duplicated symbol would alias two providers.
  it('should declare seven unique tokens', () => {
    expect(new Set(tokens).size).toBe(7)
  })
})
