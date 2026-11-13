/**
 * @fileoverview Specs for the optional `deleteIfCode` cases of the `IOtpStorage` contract: each is
 * pointed at a storage that violates exactly one obligation, because a contract case that cannot
 * fail is decoration.
 * @layer testing
 */

import type { IOtpStorage } from '../server/interfaces/otp-storage.interface'
import { InMemoryOtpStorage } from '../server/providers/in-memory-otp.storage'

import { delegating, runCase } from './__tests__/contract-helpers'

// The compare-and-delete cases: each is pointed at a storage that violates exactly one obligation.
describe('the optional deleteIfCode cases', () => {
  // A storage without the method is not held to it: the cases pass, as the failure cases do.
  it('should pass trivially for a storage that does not implement deleteIfCode', async () => {
    const inner = new InMemoryOtpStorage()
    const plain: IOtpStorage = {
      name: 'plain',
      isConfigured: () => true,
      set: inner.set.bind(inner),
      get: inner.get.bind(inner),
      consumeAttempt: inner.consumeAttempt.bind(inner),
      update: inner.update.bind(inner),
      delete: inner.delete.bind(inner),
      tryAcquireCooldown: inner.tryAcquireCooldown.bind(inner),
      getCooldown: inner.getCooldown.bind(inner),
      clearCooldown: inner.clearCooldown.bind(inner)
    }

    await expect(
      runCase(plain, 'deleteIfCode removes only the stored value')
    ).resolves.toBeUndefined()
    await expect(runCase(plain, 'deleteIfCode is ATOMIC')).resolves.toBeUndefined()
  })

  it('should catch a deleteIfCode that is a read followed by a delete', async () => {
    const inner = new InMemoryOtpStorage()
    const racy = delegating(inner, {
      deleteIfCode: async (tenantId, recipient, purpose, expectedStored): Promise<boolean> => {
        const entry = await inner.get(tenantId, recipient, purpose)
        if (entry?.code !== expectedStored) {
          return false
        }
        await inner.delete(tenantId, recipient, purpose)
        return true
      }
    })

    await expect(runCase(racy, 'deleteIfCode is ATOMIC')).rejects.toThrow(
      /25 concurrent deleteIfCode calls reported removing the same entry/
    )
  })

  it('should catch a deleteIfCode that deletes whatever is stored', async () => {
    const inner = new InMemoryOtpStorage()
    const blind = delegating(inner, {
      deleteIfCode: async (tenantId, recipient, purpose): Promise<boolean> => {
        await inner.delete(tenantId, recipient, purpose)
        return true
      }
    })

    await expect(runCase(blind, 'deleteIfCode removes only the stored value')).rejects.toThrow(
      /removed an entry whose stored value differs/
    )
  })

  // Each case below breaks exactly one half of one obligation, so a check that tested only
  // one half of its pair would let it through.
  it('should catch a deleteIfCode that removes the entry but reports false', async () => {
    const inner = new InMemoryOtpStorage()
    const silent = delegating(inner, {
      deleteIfCode: async (tenantId, recipient, purpose, expectedStored): Promise<boolean> => {
        await inner.deleteIfCode(tenantId, recipient, purpose, expectedStored)
        return false
      }
    })

    await expect(runCase(silent, 'deleteIfCode removes only the stored value')).rejects.toThrow(
      /did not remove the entry whose stored value it was given/
    )
  })

  it('should catch a deleteIfCode that deletes whatever is stored but reports false', async () => {
    const inner = new InMemoryOtpStorage()
    const blind = delegating(inner, {
      deleteIfCode: async (tenantId, recipient, purpose): Promise<boolean> => {
        await inner.delete(tenantId, recipient, purpose)
        return false
      }
    })

    await expect(runCase(blind, 'deleteIfCode removes only the stored value')).rejects.toThrow(
      /removed an entry whose stored value differs/
    )
  })

  it('should catch a deleteIfCode that reports true but removes nothing', async () => {
    const inner = new InMemoryOtpStorage()
    const liar = delegating(inner, { deleteIfCode: async (): Promise<boolean> => true })

    await expect(runCase(liar, 'deleteIfCode removes only the stored value')).rejects.toThrow(
      /removed an entry whose stored value differs/
    )
  })

  it('should catch a deleteIfCode that reports a match without removing it', async () => {
    const inner = new InMemoryOtpStorage()
    const claimed = delegating(inner, {
      deleteIfCode: async (tenantId, recipient, purpose, expectedStored): Promise<boolean> =>
        (await inner.get(tenantId, recipient, purpose))?.code === expectedStored
    })

    await expect(runCase(claimed, 'deleteIfCode removes only the stored value')).rejects.toThrow(
      /did not remove the entry whose stored value it was given/
    )
  })

  it('should catch a deleteIfCode that never deletes', async () => {
    const inner = new InMemoryOtpStorage()
    const inert = delegating(inner, { deleteIfCode: async (): Promise<boolean> => false })

    await expect(runCase(inert, 'deleteIfCode removes only the stored value')).rejects.toThrow(
      /did not remove the entry whose stored value it was given/
    )
  })

  it('should catch a deleteIfCode that reports an absent entry as removed', async () => {
    const inner = new InMemoryOtpStorage()
    let calls = 0
    const liar = delegating(inner, {
      deleteIfCode: async (tenantId, recipient, purpose, expectedStored): Promise<boolean> => {
        calls += 1
        const removed = await inner.deleteIfCode(tenantId, recipient, purpose, expectedStored)
        return calls > 2 ? true : removed
      }
    })

    await expect(runCase(liar, 'deleteIfCode removes only the stored value')).rejects.toThrow(
      /reported true for an entry that was not there/
    )
  })
})
