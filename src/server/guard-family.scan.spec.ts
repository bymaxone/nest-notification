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

import ts from 'typescript'

const ROOT = join(__dirname, '..')

const PINNED = /\bawait\s+(own|ownChecked|checkedAwait|pinOnce)\(/u
const USES = /\bawait\b|\.then\(|\.catch\(|\.finally\(/u

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
  'server/services/otp.service.ts': {
    count: 14,
    reason:
      'Awaits of the wrapped store (every method returns a promise pinned and checked by guardedCall), plus the probe at resolvesTemplate, whose awaits are pinned in EmailService.'
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
      'Dynamic import of a peer package at first use, awaited unpinned: the namespace is not validated here, the callers read the members they need and refuse an absent one, and a promise planted by same-process code at that moment is a known limit (SECURITY.md, threat model).'
  },
  'server/utils/observe.ts': {
    count: 1,
    reason:
      'The wait of settledWithin on the span promise checkedAwait pinned; its outcome is never the operation outcome, and the realm is asserted before the return.'
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
  'react/useOtpInput.ts': {
    count: 1,
    reason:
      'A hook of the browser bundle: it awaits the host callback the component passes it, in a client with no library promise, no storage and no verdict to forge.'
  },
  'testing/otp-storage-contract.consume.ts': {
    count: 8,
    reason:
      'The executable contract of a consumer storage: it awaits the storage under test in a spec run by the consumer, and reaches no production bundle.'
  },
  'testing/otp-storage-contract.failures.ts': {
    count: 22,
    reason:
      'The executable contract of a consumer storage: it awaits the storage under test in a spec run by the consumer, and reaches no production bundle.'
  },
  'testing/otp-storage-contract.ts': {
    count: 70,
    reason:
      'The executable contract of a consumer storage: it awaits the storage under test in a spec run by the consumer, and reaches no production bundle.'
  },
  'observability/notification-health.indicator.ts': {
    count: 6,
    reason:
      'Each await follows promisesIntact() in the same expression and the answer is checked again before the result is built; absorbRejection awaits a promise no handler could be attached to; the verification promise itself is heard with the load-time then. The check is best-effort: a clock or timer replaced by same-process code is outside it (SECURITY.md, threat model).'
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
  const files = sources(ROOT).map((path) => relative(ROOT, path))

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

describe('the pinned-await rule, second awaits', () => {
  const files = sources(ROOT)

  it('should never put a second await on a line that pins one', () => {
    const doubled = files.flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line))
        .filter((line) => PINNED.test(line) && (line.match(/\bawait\b/gu) ?? []).length > 1)
        .map((line) => `${relative(ROOT, path)}: ${line.trim()}`)
    )

    expect(doubled).toStrictEqual([])
  })
})

/**
 * Where a result reaches the host's `await`: the services and the helpers that hand a promise on. A
 * `return` of anything but a primitive from an async function there resolves with a value whose `then`
 * is read, so it follows a realm check with nothing between, or is a null-prototype copy, or is listed
 * here with the reason it is not a decision.
 */
const RETURN_SCOPE = [
  'server/providers/resend-email.provider.ts',
  'server/providers/smtp-email.provider.ts',
  'server/services/',
  'server/utils/observe.ts',
  'server/utils/storage-failures.ts',
  'observability/notification-tracing.ts'
]

const SEALS =
  /^(assertStandardRealmRoot|boxed|nullProto|assignTo|createBare|frozenCopy|Object\.create)/u

const RETURN_EXEMPT: Readonly<Record<string, { count: number; reason: string }>> = {
  'server/services/email.service.ts': {
    count: 8,
    reason:
      'Returns of the provider result and of strings after awaits whose callee asserts the realm last, or of a promise that always rejects; sendUnobserved and the public methods assert before they resolve with an object.'
  },
  'server/services/notification.service.ts': {
    count: 4,
    reason:
      'route builds the answer from callees that end with their own check and run no host code after it, and dispatch pins and checks it as it is handed over; the two messageId returns are strings.'
  },
  'server/services/otp.service.ts': {
    count: 5,
    reason:
      'Returns of a rejecting call (the reject helpers always throw) and of the frozen null-prototype copy of a verdict; the status object follows the realm check of statusChecked.'
  },
  'server/utils/observe.ts': {
    count: 1,
    reason:
      'The branch with no span: the answer of run, whose callee asserts the realm last, and nothing of the host runs after it.'
  },
  'server/utils/storage-failures.ts': {
    count: 1,
    reason:
      'checkStoreResult answers a primitive or a null-prototype object, and the wrapper pins and checks the promise it hands on.'
  },
  'observability/notification-tracing.ts': {
    count: 1,
    reason:
      'The operation of a tracer span: the library takes no verdict from it, and the operation was already sealed.'
  }
}

/** Returns inside an async function whose value is not a primitive and which no realm check seals. */
function unsealedReturns(path: string): number {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const isAsync = (node: ts.Node): boolean =>
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)
  const primitive = (expression: ts.Expression): boolean =>
    ts.isStringLiteralLike(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isTemplateExpression(expression) ||
    ts.isPrefixUnaryExpression(expression) ||
    [ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(
      expression.kind
    ) ||
    (ts.isIdentifier(expression) && expression.text === 'undefined')
  const sealedByPrevious = (statement: ts.Node): boolean => {
    let current: ts.Node | undefined = statement
    while (current?.parent !== undefined && !ts.isFunctionLike(current)) {
      const parent: ts.Node = current.parent
      if (ts.isBlock(parent)) {
        const previous = parent.statements[parent.statements.indexOf(current as ts.Statement) - 1]
        if (previous !== undefined) {
          return SEALS.test(previous.getText())
        }
        current = parent.parent
      } else {
        current = parent
      }
    }
    return false
  }
  let count = 0
  const visit = (node: ts.Node, inAsync: boolean): void => {
    const here = ts.isFunctionLike(node) ? isAsync(node) : inAsync
    if (
      ts.isReturnStatement(node) &&
      inAsync &&
      node.expression !== undefined &&
      !primitive(node.expression) &&
      !SEALS.test(node.expression.getText()) &&
      !sealedByPrevious(node)
    ) {
      count += 1
    }
    ts.forEachChild(node, (child) => {
      visit(child, here)
    })
  }
  visit(file, false)
  return count
}

describe('the sealed-return rule', () => {
  const files = sources(ROOT)
    .map((path) => relative(ROOT, path))
    .filter((file) => RETURN_SCOPE.some((scope) => file.startsWith(scope)))

  it.each(files)('should list every unsealed async return of %s', (file) => {
    expect(unsealedReturns(join(ROOT, file))).toBe(RETURN_EXEMPT[file]?.count ?? 0)
  })

  it('should keep no entry for a file outside the scope or that does not exist', () => {
    expect(Object.keys(RETURN_EXEMPT).filter((file) => !files.includes(file))).toStrictEqual([])
  })

  it('should give every exemption a reason', () => {
    expect(Object.values(RETURN_EXEMPT).filter((entry) => entry.reason.length < 20)).toStrictEqual(
      []
    )
  })
})
