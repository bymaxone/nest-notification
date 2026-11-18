/**
 * @fileoverview Holds OtpService to reporting what happens to a code to the observer: a code issued,
 * accepted, refused or locked out, once each, and the verification inside its span, without an
 * observer that throws ever changing an answer.
 * @layer application
 */

import type { INotificationObserver } from '../interfaces/notification-observer.interface'
import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'

import { makeAudit, makeOptions, ref } from './__tests__/otp-service.fixtures'
import { OtpService } from './otp.service'

/** An observer that records what it is told and runs the operation inside its "span". */
function recorder(): jest.Mocked<Required<INotificationObserver>> {
  return {
    onSend: jest.fn(),
    onOtp: jest.fn(),
    span: jest.fn(async (_name, _attributes, run) => run())
  } as never
}

interface Built {
  readonly service: OtpService
  readonly storage: InMemoryOtpStorage
}

const build = (observer?: INotificationObserver, maxAttempts = 2): Built => {
  const storage = new InMemoryOtpStorage()
  const options = makeOptions({ defaultMaxAttempts: maxAttempts, resendCooldownSeconds: 0 })
  return { service: new OtpService(options, storage, makeAudit(), undefined, observer), storage }
}

/** Issues a code by hand and returns the one that was stored (no secret is configured). */
async function issue(built: Built): Promise<string> {
  await built.service.generate({ ...ref, deliverVia: 'manual' })
  return (await built.storage.get(ref.tenantId, ref.recipient, ref.purpose))?.code ?? ''
}

const kinds = (observer: jest.Mocked<Required<INotificationObserver>>): string[] =>
  observer.onOtp.mock.calls.map((call) => call[0].event)

describe('OtpService observer', () => {
  it('should report an issued code once', async () => {
    const observer = recorder()

    await issue(build(observer))

    expect(kinds(observer)).toEqual(['issued'])
  })

  it('should report an accepted code as verified, inside the verification span', async () => {
    const observer = recorder()
    const built = build(observer)
    const code = await issue(built)

    await built.service.verify({ ...ref, code })

    expect(observer.span).toHaveBeenCalledWith(
      'notification.otp.verify',
      { channel: 'otp' },
      expect.any(Function)
    )
    expect(kinds(observer)).toEqual(['issued', 'verified'])
  })

  it('should report a wrong code as failed', async () => {
    const observer = recorder()
    const built = build(observer)
    await issue(built)

    const result = await built.service.verify({ ...ref, code: 'not-the-code' })

    expect(result).toMatchObject({ valid: false, reason: 'invalid_code' })
    expect(kinds(observer)).toEqual(['issued', 'failed'])
  })

  it('should report a verification with no live code as failed', async () => {
    const observer = recorder()

    const result = await build(observer).service.verify({ ...ref, code: '123456' })

    expect(result).toMatchObject({ valid: false, reason: 'not_found' })
    expect(kinds(observer)).toEqual(['failed'])
  })

  it('should report the attempt that runs into the ceiling as locked', async () => {
    const observer = recorder()
    const built = build(observer, 1)
    await issue(built)

    await built.service.verify({ ...ref, code: 'wrong-1' })
    const locked = await built.service.verify({ ...ref, code: 'wrong-2' })

    expect(locked).toMatchObject({ valid: false, reason: 'max_attempts' })
    expect(kinds(observer)).toEqual(['issued', 'failed', 'locked'])
  })

  it('should report no event when the call itself is refused', async () => {
    const observer = recorder()

    await expect(
      build(observer).service.verify({ ...ref, tenantId: '', code: '123456' })
    ).rejects.toBeDefined()

    expect(observer.onOtp).not.toHaveBeenCalled()
    expect(observer.span).toHaveBeenCalledTimes(1)
  })

  it('should not report an issued code when the generation fails', async () => {
    const observer = recorder()
    const built = build(observer)
    await issue(built)
    observer.onOtp.mockClear()
    const cooling = new OtpService(
      makeOptions({ resendCooldownSeconds: 60 }),
      built.storage,
      makeAudit(),
      undefined,
      observer
    )

    await expect(cooling.generate({ ...ref, deliverVia: 'manual' })).resolves.toBeDefined()
    await expect(cooling.generate({ ...ref, deliverVia: 'manual' })).rejects.toBeDefined()

    expect(kinds(observer)).toEqual(['issued'])
  })

  it('should not let an observer that throws change an answer', async () => {
    const throwing: INotificationObserver = {
      onOtp: () => {
        throw new Error('observer broke')
      }
    }
    const built = build(throwing)

    const code = await issue(built)

    await expect(built.service.verify({ ...ref, code })).resolves.toEqual({ valid: true })
  })

  it('should still verify when the observer span throws before running the verification', async () => {
    const onOtp = jest.fn()
    const built = build({
      onOtp,
      span: () => {
        throw new Error('span broke')
      }
    })
    const code = await issue(built)

    await expect(built.service.verify({ ...ref, code })).resolves.toEqual({ valid: true })

    expect(onOtp).toHaveBeenCalledWith({ event: 'verified' })
  })

  it('should verify without an observer and with one that has no span', async () => {
    const plain = build(undefined)
    const code = await issue(plain)
    await expect(plain.service.verify({ ...ref, code })).resolves.toEqual({ valid: true })

    const onOtp = jest.fn()
    const noSpan = build({ onOtp })
    await noSpan.service.verify({ ...ref, code: 'x' })

    expect(onOtp).toHaveBeenCalledWith({ event: 'failed' })
  })
})
