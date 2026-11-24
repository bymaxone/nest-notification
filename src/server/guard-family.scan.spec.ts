/**
 * @fileoverview Holds every production file of the server and observability entries to the
 * pinned-await rule: an `await` (or `for await`, or a `.then` chain) on a promise a host could have
 * shaped goes through `own`, `ownChecked`, `checkedAwait` or `pinOnce`, or is listed here with the
 * reason it is exempt. The counts are exact, so a new unpinned await fails until it is looked at and
 * given a reason, and a removed one fails until the stale entry is deleted.
 * @layer integration
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..')

const PINNED = /\bawait\s+(own|ownChecked|checkedAwait|pinOnce)\(/u
const USES = /\bawait\b|\.then\(/u

/** Exact count of unpinned uses per file, and why each is acceptable. */
const EXEMPT: Readonly<Record<string, { count: number; reason: string }>> = {
  'server/bymax-notification.module.ts': {
    count: 1,
    reason:
      'The host factory runs once at startup, before any operation; its answer is copied by snapshotOptions.'
  },
  'server/interceptors/notification-audit.interceptor.ts': {
    count: 3,
    reason:
      'Host resolver and audit sink awaited inside a try whose outcome is never a verdict; an audit failure is swallowed by policy and the interceptor returns no library result.'
  },
  'server/providers/escaping-log-repository.ts': {
    count: 1,
    reason:
      'Awaits the inner sink for the audit writer, which pins and checks the call that reaches it (writeAudit).'
  },
  'server/providers/redis-otp.storage.ts': {
    count: 14,
    reason:
      'Awaits of the host Redis client inside the reference store; every call reaches the services through withStorageFailures, whose guardedCall pins and checks the answer.'
  },
  'server/providers/resend-email.provider.ts': {
    count: 5,
    reason:
      'Provider internals: the promise the service sees is the provider send, which EmailService awaits through own and checks after.'
  },
  'server/providers/smtp-email.provider.ts': {
    count: 10,
    reason:
      'Provider internals: the promise the service sees is the provider send, which EmailService awaits through own and checks after.'
  },
  'server/services/email.service.ts': {
    count: 1,
    reason:
      'Awaits writeAudit, which pins the sink promise, absorbs only the sink own failure and asserts the realm before it returns.'
  },
  'server/services/otp.service.ts': {
    count: 14,
    reason:
      'Awaits of the wrapped store (every method returns a promise pinned and checked by guardedCall), plus the detached template check at resolvesTemplate (a boolean probe whose inner awaits are pinned in EmailService; a forged answer can only change which template a code is sent with, never a verdict).'
  },
  'server/utils/audit-write.ts': {
    count: 1,
    reason: 'Awaits the promise checkedAwait just pinned, and the realm is asserted right after.'
  },
  'server/utils/cooldown-release.ts': {
    count: 1,
    reason:
      'Awaits the wrapped store while releasing a cooldown on a failure path whose outcome is the original error.'
  },
  'server/utils/load-optional-peer.ts': {
    count: 1,
    reason:
      'Dynamic import of a peer package at first use; the module namespace is validated by the caller.'
  },
  'server/utils/observe.ts': {
    count: 1,
    reason:
      'Awaits the span promise checkedAwait pinned; its outcome is never the operation outcome.'
  },
  'server/utils/otp-failure-count.ts': {
    count: 2,
    reason:
      'Awaits the wrapped store, and the count it reads is a number checked by checkStoreResult.'
  },
  'server/utils/realm-root.ts': {
    count: 1,
    reason: 'The absorb path of silence: awaits a promise it has just given a handler.'
  },
  'server/utils/release-stored.ts': {
    count: 1,
    reason:
      'Awaits the undo of a failure path; its failure is absorbed and the original error is thrown.'
  },
  'observability/notification-health.indicator.ts': {
    count: 5,
    reason:
      'Each await follows promisesIntact() in the same expression and the answer is checked again before the result is built; the verification promise itself is heard with the load-time then.'
  },
  'observability/notification-tracing.ts': {
    count: 1,
    reason: 'Awaits the span operation of a tracer; the library takes no verdict from it.'
  }
}

function sources(directory: string): string[] {
  const found: string[] = []
  for (const name of readdirSync(directory)) {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') {
        found.push(...sources(path))
      }
    } else if (name.endsWith('.ts') && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) {
      found.push(path)
    }
  }
  return found
}

/** Lines that use `await` or `.then(` outside a comment and not behind a pinning helper. */
function unpinned(path: string): string[] {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
    .filter((line) => USES.test(line))
    .filter((line) => !PINNED.test(line))
}

describe('the pinned-await rule', () => {
  const files = [...sources(join(ROOT, 'server')), ...sources(join(ROOT, 'observability'))].map(
    (path) => relative(ROOT, path)
  )

  it.each(files)('should list every unpinned await or then chain of %s', (file) => {
    const found = unpinned(join(ROOT, file)).length

    expect(found).toBe(EXEMPT[file]?.count ?? 0)
  })

  it('should keep no entry for a file that does not exist', () => {
    expect(Object.keys(EXEMPT).filter((file) => !files.includes(file))).toStrictEqual([])
  })

  it('should give every exemption a reason', () => {
    expect(Object.values(EXEMPT).filter((entry) => entry.reason.length < 20)).toStrictEqual([])
  })
})
