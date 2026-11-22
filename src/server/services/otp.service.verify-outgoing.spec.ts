/**
 * @fileoverview Holds a failed verify to leaving the way a failed generate does: a host error
 * with a throwing accessor is cleaned of the guess and never handed on as the host built it.
 * @layer domain
 */

import { NotificationException } from '../errors/notification-exception'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

const GUESS = '987654'

function throwing(failure: unknown): InMemoryOtpStorage {
  const storage = new InMemoryOtpStorage()
  storage.get = async () => {
    throw failure
  }
  return storage
}

async function verifying(failure: unknown): Promise<unknown> {
  const service = new OtpService(makeOptions({}), throwing(failure), makeAudit())
  return service.verify({ ...ref, code: GUESS }).catch((error: unknown) => error)
}

describe('the failure of a verify', () => {
  it('should remove the guess from the chain of a host library error whose code getter throws', async () => {
    const hostBuilt = new NotificationException('OTP_STORAGE_UNAVAILABLE', undefined, {
      cause: new Error(`echoed ${GUESS}`)
    })
    Object.defineProperty(hostBuilt, 'code', {
      get() {
        throw new Error('code getter of the host')
      }
    })

    const caught = await verifying(hostBuilt)

    expect(((caught as Error).cause as Error).message).not.toContain(GUESS)
  })

  it('should remove the guess from the text of a store error', async () => {
    const caught = await verifying(new Error(`rejected ${GUESS} for the key`))

    // The store's own text is the cause of the library error that wraps it: that is where it is read.
    const cause = (caught as Error).cause as Error
    expect(cause.message).toContain('rejected')
    expect(JSON.stringify([cause.message, cause.stack])).not.toContain(GUESS)
  })

  it('should answer a thrown string with a library error that holds no guess', async () => {
    const caught = await verifying(`bad ${GUESS}`)

    expect(caught).toBeInstanceOf(NotificationException)
    expect(JSON.stringify(caught)).not.toContain(GUESS)
  })

  it('should still clean a failure when the guess is not a string', async () => {
    const service = new OtpService(makeOptions({}), throwing(new Error('store down')), makeAudit())

    const caught: unknown = await service
      .verify({ ...ref, ...(JSON.parse('{"code":123456}') as { code: string }) })
      .catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(Error)
  })

  // A guess that is not a string is refused before it reaches the digest or the comparison, where a
  // platform error quotes what it was given: no storage call, no TypeError, no echo of the value.
  it.each([
    ['a number', 271620],
    ['a String object', new String('271620')],
    ['an object', { toString: () => '271620' }],
    ['null', null],
    ['no code', undefined]
  ])(
    'should refuse %s as the guess with a typed error that does not echo it',
    async (_label, code) => {
      const storage = throwing(new Error('store down'))
      const get = jest.spyOn(storage, 'get')
      const service = new OtpService(
        makeOptions({ codeSecret: 'a-secret-of-at-least-thirty-two-bytes!!' }),
        storage,
        makeAudit()
      )

      const caught = (await service
        .verify({ ...ref, ...({ code } as { code: string }) })
        .catch((error: unknown) => error)) as NotificationException

      expect(caught).toBeInstanceOf(NotificationException)
      expect(caught.code).toBe('notification.invalid_scope_identifier')
      expect(JSON.stringify([caught.getResponse(), caught.message, caught.stack])).not.toContain(
        '271620'
      )
      expect(get).not.toHaveBeenCalled()
    }
  )

  it('should read the guess once when it cleans a failure', async () => {
    const service = new OtpService(makeOptions({}), throwing(new Error('store down')), makeAudit())
    let reads = 0

    await service
      .verify({
        ...ref,
        get code(): string {
          reads += 1
          return reads === 1 ? GUESS : 'other'
        }
      })
      .catch(() => undefined)

    expect(reads).toBe(1)
  })

  // A guess is any text the caller chose; one that is a stretch of the library's own error code must
  // not rewrite the code a client matches on.
  it.each(['otp', 'storage', 'failed', 'notification', 'OTP storage'])(
    'should leave the code of the library error as it is for the guess %p',
    async (guess) => {
      const service = new OtpService(makeOptions({}), throwing('boom'), makeAudit())

      const caught = (await service
        .verify({ ...ref, code: guess })
        .catch((error: unknown) => error)) as NotificationException

      expect(caught.code).toBe('notification.otp_storage_failed')
      expect(caught.getResponse()).toMatchObject({
        error: { code: 'notification.otp_storage_failed', message: 'OTP storage failed' }
      })
    }
  )

  it("should still remove a guess that is not the library's own text from the cause", async () => {
    const service = new OtpService(
      makeOptions({}),
      throwing(new Error('rejected 987654 here')),
      makeAudit()
    )

    const caught = (await service
      .verify({ ...ref, code: '987654' })
      .catch((error: unknown) => error)) as NotificationException

    expect((caught.cause as Error).message).not.toContain('987654')
  })
})
