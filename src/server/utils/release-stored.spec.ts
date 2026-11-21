/**
 * @fileoverview Holds the release of a recipient's state to running both steps, whichever fails.
 * @layer utils
 */

import { InMemoryOtpStorage } from '../providers/in-memory-otp.storage'
import { releaseStored } from './release-stored'

const scope = { tenantId: 't', recipient: 'a@b.c', purpose: 'login' }
const entry = { code: '1', expiresAt: Date.now() + 60_000, attempts: 0, maxAttempts: 3 }

describe('releaseStored', () => {
  it('should clear the cooldown and delete the entry', async () => {
    const storage = new InMemoryOtpStorage()
    await storage.set('t', 'a@b.c', 'login', entry)
    await storage.tryAcquireCooldown('t', 'a@b.c', 'login', 60)

    await releaseStored(storage, scope)

    expect(await storage.get('t', 'a@b.c', 'login')).toBeNull()
    expect(await storage.getCooldown('t', 'a@b.c', 'login')).toBe(0)
  })

  it('should still delete the entry when clearing the cooldown throws, and rethrow that error', async () => {
    const storage = new InMemoryOtpStorage()
    await storage.set('t', 'a@b.c', 'login', entry)
    const boom = new Error('clear failed')
    storage.clearCooldown = async () => {
      throw boom
    }

    const caught: unknown = await releaseStored(storage, scope).catch((e: unknown) => e)

    expect(caught).toBe(boom)
    expect(await storage.get('t', 'a@b.c', 'login')).toBeNull()
  })

  it('should still clear the cooldown when the delete throws, and rethrow that error', async () => {
    const storage = new InMemoryOtpStorage()
    await storage.tryAcquireCooldown('t', 'a@b.c', 'login', 60)
    const boom = new Error('delete failed')
    storage.delete = async () => {
      throw boom
    }

    const caught: unknown = await releaseStored(storage, scope).catch((e: unknown) => e)

    expect(caught).toBe(boom)
    expect(await storage.getCooldown('t', 'a@b.c', 'login')).toBe(0)
  })

  it('should report the first failure when both throw', async () => {
    const storage = new InMemoryOtpStorage()
    const first = new Error('first')
    storage.clearCooldown = async () => {
      throw first
    }
    storage.delete = async () => {
      throw new Error('second')
    }

    expect(await releaseStored(storage, scope).catch((e: unknown) => e)).toBe(first)
  })
})
