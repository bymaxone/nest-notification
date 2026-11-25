#!/usr/bin/env node
/**
 * Dogfood smoke test — validates the published package shape before tagging.
 *
 * Validates:
 *   1. Build artifacts exist for all six subpaths (ESM, CJS, .d.ts)
 *   2. ESM import resolves the expected named exports (server + shared)
 *   3. CJS require resolves the expected named exports (server + shared)
 *   4. The react subpath resolves; the testing subpath exposes otpStorageContract
 *   4b. The built observability entry, wired beside the built server, records real samples
 *   4c. The built push entry, wired beside the built server, in CJS and ESM
 *   5. Tarball contents (npm pack --dry-run) contain only dist/ + meta files
 *   6. A minimal consumer (file: link in an OS temp dir) resolves every subpath
 *      through the published `exports` map
 *
 * Exit codes: 0 pass · 1 assertion failed · 2 build artifacts missing.
 *
 * Usage: pnpm build && node scripts/dogfood-smoke-test.mjs
 */

import { execSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { isAllowedEntry, listTarball, openPackage } from './package-under-test.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// The tarball when PACKAGE_TARBALL names one, the working tree's `dist/` otherwise: with a
// tarball every section below reads the file that `npm publish` uploads.
const PACKAGE = openPackage(ROOT)
// Created lazily inside section 6 so an earlier `process.exit(2)` leaks no temp dir.
let consumerDir

const EXPECTED_DIST_FILES = [
  'dist/server/index.mjs',
  'dist/server/index.cjs',
  'dist/server/index.d.ts',
  'dist/shared/index.mjs',
  'dist/shared/index.cjs',
  'dist/shared/index.d.ts',
  'dist/react/index.mjs',
  'dist/react/index.cjs',
  'dist/react/index.d.ts',
  'dist/testing/index.mjs',
  'dist/testing/index.cjs',
  'dist/testing/index.d.ts',
  'dist/observability/index.mjs',
  'dist/observability/index.cjs',
  'dist/observability/index.d.ts',
  'dist/push/index.mjs',
  'dist/push/index.cjs',
  'dist/push/index.d.ts'
]

const EXPECTED_SERVER_EXPORTS = [
  'BymaxNotificationModule',
  'BYMAX_NOTIFICATION_OPTIONS',
  'BYMAX_NOTIFICATION_EMAIL_PROVIDER',
  'BYMAX_NOTIFICATION_OTP_STORAGE',
  'NotificationException',
  'NOTIFICATION_ERROR_DEFINITIONS',
  'NOTIFICATION_ERROR_CODES',
  'NOTIFICATION_PURPOSES',
  'NoOpEmailProvider',
  'SmtpEmailProvider',
  'NoOpNotificationLogRepository',
  'DefaultTemplateRenderer',
  'PushService',
  'BYMAX_NOTIFICATION_PUSH_PROVIDER'
]

const EXPECTED_SHARED_EXPORTS = ['NOTIFICATION_ERROR_CODES', 'DEFAULT_TTLS']
const EXPECTED_TESTING_EXPORTS = ['otpStorageContract']
// The observability entry needs optional peers a bare tarball does not carry, so it is read as text
// and its export list is checked, not imported.
const EXPECTED_OBSERVABILITY_EXPORTS = [
  'NotificationObservabilityModule',
  'NotificationMetrics',
  'NotificationTracing',
  'NotificationHealthIndicator',
  'NOTIFICATION_METRIC_NAMES'
]

const ALLOWED_TARBALL_PATHS = ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'dist/']

let failures = 0
const fail = (msg) => {
  console.error(`  FAIL: ${msg}`)
  failures++
}
const pass = (msg) => console.log(`  PASS: ${msg}`)
const section = (title) => console.log(`\n-- ${title}`)

// -- 1. Build artifact presence ----------------------------------------------
section('1. Build artifacts')
for (const f of EXPECTED_DIST_FILES) {
  if (!existsSync(resolve(PACKAGE.root, f))) {
    console.error(
      PACKAGE.tarball
        ? `Missing build artifact: ${f} is not in ${PACKAGE.tarball}`
        : `Missing build artifact: ${f} — run \`pnpm build\` first.`
    )
    process.exit(2)
  }
  pass(f)
}

// -- 2. ESM named exports ----------------------------------------------------
section('2. ESM named exports — server')
const serverEsm = await import(resolve(PACKAGE.root, 'dist/server/index.mjs'))
for (const name of EXPECTED_SERVER_EXPORTS) {
  name in serverEsm ? pass(`export ${name}`) : fail(`Missing export: ${name}`)
}

section('3. ESM named exports — shared')
const sharedEsm = await import(resolve(PACKAGE.root, 'dist/shared/index.mjs'))
for (const name of EXPECTED_SHARED_EXPORTS) {
  name in sharedEsm ? pass(`export ${name}`) : fail(`Missing export: ${name}`)
}
const testingEsmExports = await import(resolve(PACKAGE.root, 'dist/testing/index.mjs'))
for (const name of EXPECTED_TESTING_EXPORTS) {
  name in testingEsmExports ? pass(`export ${name}`) : fail(`Missing export: ${name}`)
}

// -- 4. CJS exports ----------------------------------------------------------
section('4. CJS exports')
const req = createRequire(import.meta.url)
const serverCjs = req(resolve(PACKAGE.root, 'dist/server/index.cjs'))
for (const name of EXPECTED_SERVER_EXPORTS) {
  name in serverCjs ? pass(`cjs server ${name}`) : fail(`Missing CJS export: ${name}`)
}
const sharedCjs = req(resolve(PACKAGE.root, 'dist/shared/index.cjs'))
for (const name of EXPECTED_SHARED_EXPORTS) {
  name in sharedCjs ? pass(`cjs shared ${name}`) : fail(`Missing CJS export (shared): ${name}`)
}
// The CJS condition is a separate build output: an ESM-only assertion would let
// a broken `require('@bymax-one/nest-notification/testing')` through the gate.
const testingCjs = req(resolve(PACKAGE.root, 'dist/testing/index.cjs'))
for (const name of EXPECTED_TESTING_EXPORTS) {
  // Read through a descriptor rather than a dynamic index: the value must be
  // callable, and the lint rule against index sinks is right that a bare
  // `obj[name]` on external data is the wrong habit to keep.
  const exported = Object.getOwnPropertyDescriptor(testingCjs, name)?.value
  typeof exported === 'function'
    ? pass(`cjs testing ${name}`)
    : fail(`Missing or non-callable CJS export (testing): ${name}`)
}

// The observability entry in both formats: the ESM file ends in one export statement listing its
// names, and the CJS file assigns each name to `exports`.
const observabilityEsm = readFileSync(resolve(PACKAGE.root, 'dist/observability/index.mjs'), 'utf8')
const esmExportList = observabilityEsm.match(/export\s*\{([^}]*)\}\s*;?\s*$/)?.[1] ?? ''
const observabilityCjs = readFileSync(resolve(PACKAGE.root, 'dist/observability/index.cjs'), 'utf8')
for (const name of EXPECTED_OBSERVABILITY_EXPORTS) {
  esmExportList.split(',').some((entry) => entry.trim() === name)
    ? pass(`esm observability ${name}`)
    : fail(`Missing ESM export (observability): ${name}`)
  new RegExp(`exports\\.${name}\\b`).test(observabilityCjs)
    ? pass(`cjs observability ${name}`)
    : fail(`Missing CJS export (observability): ${name}`)
}

// The built observability entry beside the built server entry, run from inside the package under
// test so that the package name resolves to it: the specs run on src, where there is one copy of
// every token, and only the built bundles can show that the two entries share them.
section('4b. Observability wired against the built server')
const probeFile = join(PACKAGE.root, '.observability-dist-probe.cjs')
copyFileSync(join(ROOT, 'scripts', 'observability-dist-probe.cjs'), probeFile)
try {
  const probe = spawnSync('node', [probeFile], {
    cwd: PACKAGE.root,
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: join(ROOT, 'node_modules') },
    timeout: 60_000
  })
  probe.status === 0
    ? pass('observability samples and readiness come out of the built packages')
    : fail(
        `Observability dist probe failed (code ${probe.status}): ${probe.stderr || probe.stdout}`
      )
} finally {
  rmSync(probeFile, { force: true })
}

// The built push entry beside the built server entry, in both module formats: one copy of the error
// class, the adapter plugged into the module, and the retry decisions read through the built service.
section('4c. Push adapter wired against the built server')
const pushProbeFile = join(PACKAGE.root, '.push-dist-probe.cjs')
copyFileSync(join(ROOT, 'scripts', 'push-dist-probe.cjs'), pushProbeFile)
try {
  const probe = spawnSync('node', [pushProbeFile], {
    cwd: PACKAGE.root,
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: join(ROOT, 'node_modules') },
    timeout: 60_000
  })
  probe.status === 0
    ? pass('the push adapter works through the built server, in CJS and ESM')
    : fail(`Push dist probe failed (code ${probe.status}): ${probe.stderr || probe.stdout}`)
} finally {
  rmSync(pushProbeFile, { force: true })
}

// -- 5. Tarball contents -----------------------------------------------------
section(
  PACKAGE.tarball ? '5. Tarball contents (tar -tzf)' : '5. Tarball contents (npm pack --dry-run)'
)
try {
  let contentLines
  if (PACKAGE.tarball) {
    // The list of the file itself, not of a pack the working tree would make.
    contentLines = listTarball(PACKAGE.tarball)
    if (contentLines === undefined) {
      throw new Error(`tar -tzf could not list ${PACKAGE.tarball}`)
    }
    for (const f of EXPECTED_DIST_FILES) {
      contentLines.includes(f) ? pass(`tarball holds ${f}`) : fail(`Tarball is missing ${f}`)
    }
  } else {
    const packOut = execSync('npm pack --dry-run 2>&1', { cwd: ROOT, encoding: 'utf8' })
    const SIZE_RE = /\s+[\d.]+\s*(?:[Mm][Bb]|[Kk][Bb]?|[Bb])\s+\S+/
    const SIZE_STRIP_RE = /.*npm notice\s+[\d.]+\s*(?:[Mm][Bb]|[Kk][Bb]?|[Bb])\s+/
    contentLines = packOut
      .split('\n')
      .filter((l) => l.includes('npm notice') && SIZE_RE.test(l))
      .map((l) => l.replace(SIZE_STRIP_RE, '').trim())
      .filter((l) => Boolean(l) && !l.startsWith('npm notice') && !/^sha\d+:/i.test(l))
  }
  const unexpected = contentLines.filter((f) => !isAllowedEntry(f, ALLOWED_TARBALL_PATHS))
  if (unexpected.length === 0) {
    pass(`Tarball contains only dist/ + meta files (${contentLines.length} entries)`)
  } else {
    for (const f of unexpected) fail(`Unexpected file in tarball: ${f}`)
  }
} catch (err) {
  fail(`Listing the tarball failed: ${err instanceof Error ? err.message : String(err)}`)
}

// -- 6. Consumer file: link smoke --------------------------------------------
section('6. Consumer file: link smoke (resolution check)')
try {
  consumerDir = mkdtempSync(join(tmpdir(), 'dogfood-consumer-'))
  writeFileSync(
    resolve(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'dogfood-consumer',
        version: '0.0.1',
        type: 'module',
        // `react` is an OPTIONAL peer dep — install it explicitly so the `./react`
        // subpath (which imports `react` eagerly) resolves. Required peers
        // (`@nestjs/*`, `rxjs`, `reflect-metadata`) are auto-installed by pnpm.
        dependencies: {
          '@bymax-one/nest-notification': `file:${PACKAGE.tarball ?? ROOT}`,
          react: '^19.0.0'
        }
      },
      null,
      2
    )
  )
  const installResult = spawnSync('pnpm', ['install', '--no-frozen-lockfile'], {
    cwd: consumerDir,
    encoding: 'utf8',
    timeout: 120_000
  })
  if (installResult.status !== 0) {
    fail(`pnpm install in consumer failed: ${installResult.stderr}`)
  } else {
    pass('pnpm install with file: link succeeded')
    const probe = [
      "import('@bymax-one/nest-notification')",
      ".then((m) => { if (!('BymaxNotificationModule' in m)) process.exit(3) })",
      ".then(() => import('@bymax-one/nest-notification/shared'))",
      ".then((s) => { if (!('DEFAULT_TTLS' in s)) process.exit(4) })",
      ".then(() => import('@bymax-one/nest-notification/push'))",
      ".then((p) => { if (typeof p.ExpoPushProvider !== 'function') process.exit(7) })",
      ".then(() => import('@bymax-one/nest-notification/react'))",
      ".then(() => import('@bymax-one/nest-notification/testing'))",
      ".then((t) => { if (typeof t.otpStorageContract !== 'function') process.exit(6) })",
      '.catch((e) => { console.error(e); process.exit(5) })'
    ].join('')
    const importResult = spawnSync('node', ['--input-type=module', '-e', probe], {
      cwd: consumerDir,
      encoding: 'utf8',
      timeout: 30_000
    })
    importResult.status === 0
      ? pass('package specifiers resolve via exports map from consumer cwd')
      : fail(`Consumer-side import failed (code ${importResult.status}): ${importResult.stderr}`)
  }
} catch (err) {
  fail(`Consumer scaffolding failed: ${err instanceof Error ? err.message : String(err)}`)
} finally {
  if (consumerDir) {
    try {
      rmSync(consumerDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup failures
    }
  }
}

// -- 7. Behavioral smoke — forRoot pipeline + react hook surface --------------
// Exercises the published artifact, not the source: a minimal `forRoot(...)` runs
// the full validate -> resolve -> conditional-registration pipeline and must
// return a DynamicModule descriptor; the react subpath must expose the two hooks
// as callable functions. (Hook *behavior* is covered by the unit suite under a
// React renderer; here we only assert the published shape is wired.)
section('7. Behavioral smoke (forRoot + react hooks)')
try {
  const { BymaxNotificationModule, NoOpEmailProvider, InMemoryOtpStorage } = serverEsm
  const dynamicModule = BymaxNotificationModule.forRoot({
    email: { provider: new NoOpEmailProvider(), defaultFrom: 'no-reply@dev.local' },
    otp: { storage: new InMemoryOtpStorage() }
  })
  const wired =
    dynamicModule.module === BymaxNotificationModule &&
    Array.isArray(dynamicModule.providers) &&
    dynamicModule.providers.length > 0 &&
    Array.isArray(dynamicModule.exports)
  wired
    ? pass('forRoot({ email, otp }) returns a wired DynamicModule')
    : fail('forRoot did not return a wired DynamicModule descriptor')

  // The push channel end to end against the built artifact: a stubbed `fetch` stands in for Expo, so
  // nothing leaves the machine, and a token that is not an Expo token is refused locally.
  const { ExpoPushProvider } = await import(resolve(PACKAGE.root, 'dist/push/index.mjs'))
  const calls = []
  const provider = new ExpoPushProvider({
    fetch: async (url, init) => {
      calls.push({ url, body: init?.body })
      return new Response(JSON.stringify({ data: [{ status: 'ok', id: 'ticket-1' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  const pushed = await provider.send({
    tokens: ['ExponentPushToken[abc]', 'not-a-token'],
    title: 'T',
    body: 'B'
  })
  pushed.results[0]?.messageId === 'ticket-1' &&
  pushed.results[1]?.reason === 'token_invalid' &&
  calls.length === 1 &&
  calls[0].url === 'https://exp.host/--/api/v2/push/send'
    ? pass('ExpoPushProvider answers per token and calls only the fixed Expo URL')
    : fail('ExpoPushProvider did not answer per token against the built artifact')

  const testingEsm = await import(resolve(PACKAGE.root, 'dist/testing/index.mjs'))
  const contractCases = testingEsm.otpStorageContract(() => {
    throw new Error('the factory must not run while only building the case list')
  })
  Array.isArray(contractCases) && contractCases.length > 0
    ? pass(`testing export otpStorageContract builds ${contractCases.length} cases`)
    : fail('otpStorageContract did not return cases')

  const reactEsm = await import(resolve(PACKAGE.root, 'dist/react/index.mjs'))
  for (const [hook, fn] of [
    ['useOtpInput', reactEsm.useOtpInput],
    ['useOtpCountdown', reactEsm.useOtpCountdown]
  ]) {
    typeof fn === 'function'
      ? pass(`react export ${hook} is callable`)
      : fail(`Missing or non-callable react export: ${hook}`)
  }
} catch (err) {
  fail(`Behavioral smoke threw: ${err instanceof Error ? err.message : String(err)}`)
}

console.log('')
if (failures === 0) {
  console.log('All dogfood smoke assertions passed.')
  process.exit(0)
} else {
  console.error(`${failures} assertion(s) failed.`)
  process.exit(1)
}
