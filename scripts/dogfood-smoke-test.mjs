#!/usr/bin/env node
/**
 * Dogfood smoke test — validates the published package shape before tagging.
 *
 * Validates:
 *   1. Build artifacts exist for all three subpaths (ESM, CJS, .d.ts)
 *   2. ESM import resolves the expected named exports (server + shared)
 *   3. CJS require resolves the expected named exports (server + shared)
 *   4. The react subpath resolves (no named exports asserted yet)
 *   5. Tarball contents (npm pack --dry-run) contain only dist/ + meta files
 *   6. A minimal consumer (file: link in an OS temp dir) resolves every subpath
 *      through the published `exports` map
 *
 * Exit codes: 0 pass · 1 assertion failed · 2 build artifacts missing.
 *
 * Usage: pnpm build && node scripts/dogfood-smoke-test.mjs
 */

import { execSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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
  'dist/react/index.d.ts'
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
  'NoOpNotificationLogRepository',
  'DefaultTemplateRenderer'
]

const EXPECTED_SHARED_EXPORTS = ['NOTIFICATION_ERROR_CODES', 'DEFAULT_TTLS']

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
  if (!existsSync(resolve(ROOT, f))) {
    console.error(`Missing build artifact: ${f} — run \`pnpm build\` first.`)
    process.exit(2)
  }
  pass(f)
}

// -- 2. ESM named exports ----------------------------------------------------
section('2. ESM named exports — server')
const serverEsm = await import(resolve(ROOT, 'dist/server/index.mjs'))
for (const name of EXPECTED_SERVER_EXPORTS) {
  name in serverEsm ? pass(`export ${name}`) : fail(`Missing export: ${name}`)
}

section('3. ESM named exports — shared')
const sharedEsm = await import(resolve(ROOT, 'dist/shared/index.mjs'))
for (const name of EXPECTED_SHARED_EXPORTS) {
  name in sharedEsm ? pass(`export ${name}`) : fail(`Missing export: ${name}`)
}

// -- 4. CJS exports ----------------------------------------------------------
section('4. CJS exports')
const req = createRequire(import.meta.url)
const serverCjs = req(resolve(ROOT, 'dist/server/index.cjs'))
for (const name of EXPECTED_SERVER_EXPORTS) {
  name in serverCjs ? pass(`cjs server ${name}`) : fail(`Missing CJS export: ${name}`)
}
const sharedCjs = req(resolve(ROOT, 'dist/shared/index.cjs'))
for (const name of EXPECTED_SHARED_EXPORTS) {
  name in sharedCjs ? pass(`cjs shared ${name}`) : fail(`Missing CJS export (shared): ${name}`)
}

// -- 5. Tarball contents -----------------------------------------------------
section('5. Tarball contents (npm pack --dry-run)')
try {
  const packOut = execSync('npm pack --dry-run 2>&1', { cwd: ROOT, encoding: 'utf8' })
  const SIZE_RE = /\s+[\d.]+\s*(?:[Mm][Bb]|[Kk][Bb]?|[Bb])\s+\S+/
  const SIZE_STRIP_RE = /.*npm notice\s+[\d.]+\s*(?:[Mm][Bb]|[Kk][Bb]?|[Bb])\s+/
  const contentLines = packOut
    .split('\n')
    .filter((l) => l.includes('npm notice') && SIZE_RE.test(l))
    .map((l) => l.replace(SIZE_STRIP_RE, '').trim())
    .filter((l) => Boolean(l) && !l.startsWith('npm notice') && !/^sha\d+:/i.test(l))
  const unexpected = contentLines.filter(
    (f) =>
      !ALLOWED_TARBALL_PATHS.some(
        (entry) => f === entry || (entry.endsWith('/') && f.startsWith(entry))
      )
  )
  if (unexpected.length === 0) {
    pass(`Tarball contains only dist/ + meta files (${contentLines.length} entries)`)
  } else {
    for (const f of unexpected) fail(`Unexpected file in tarball: ${f}`)
  }
} catch (err) {
  fail(`npm pack --dry-run failed: ${err instanceof Error ? err.message : String(err)}`)
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
        dependencies: { '@bymax-one/nest-notification': `file:${ROOT}`, react: '^19.0.0' }
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
      ".then(() => import('@bymax-one/nest-notification/react'))",
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

  const reactEsm = await import(resolve(ROOT, 'dist/react/index.mjs'))
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
