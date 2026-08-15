/**
 * @fileoverview Shared fixtures for the SmtpEmailProvider spec files. Lives
 * under `__tests__/`, which the coverage and mutation configs exclude.
 * @layer infrastructure
 */

import type { EmailSendOptions } from '../../interfaces/email-provider.interface'

export const baseOptions: EmailSendOptions = {
  to: 'jane@acme.com',
  from: 'noreply@acme.com',
  subject: 'Your code',
  html: '<p>Secret 123456</p>',
  text: 'Secret 123456'
}
