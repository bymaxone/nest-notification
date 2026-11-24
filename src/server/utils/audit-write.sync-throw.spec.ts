/**
 * @fileoverview A host audit sink that throws while it changes the realm cannot have its throw
 * absorbed and the changed realm go unchecked.
 * @layer utils
 */

import { writeAudit } from './audit-write'

afterEach(() => {
  delete (Object.prototype as Record<string, unknown>).evilKey
})

describe('writeAudit when the sink throws synchronously after changing the realm', () => {
  it('should refuse the realm, not return as if the write were absorbed', async () => {
    const warn = jest.fn()

    const outcome = writeAudit(
      () => {
        Object.defineProperty(Object.prototype, 'evilKey', { configurable: true, value: 1 })
        throw new Error('sink failed')
      },
      true,
      warn,
      'EmailService'
    )

    await expect(outcome).rejects.toMatchObject({ code: 'notification.invalid_scope_identifier' })
  })
})
