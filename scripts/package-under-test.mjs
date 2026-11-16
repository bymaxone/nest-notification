// Where the release gates read the package from.
//
// Without PACKAGE_TARBALL the gates read `dist/` of the working tree, which is what a developer
// has just built. With it they read the tarball itself: the file is unpacked into a directory
// under `node_modules`, so the peer packages the bundle imports still resolve, and the gates
// measure and import what `npm publish` will upload and not a directory that is supposed to
// match it.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

/**
 * @param {string} root Repository root.
 * @returns {{ root: string, tarball: string | undefined }} The directory to read `dist/` and
 *   `package.json` from, and the tarball it came from when there is one.
 */
export function openPackage(root) {
  const tarball = process.env.PACKAGE_TARBALL
  if (tarball === undefined || tarball === '') {
    return { root, tarball: undefined }
  }
  if (!isAbsolute(tarball)) {
    console.error(`PACKAGE_TARBALL must be an absolute path, got: ${tarball}`)
    process.exit(2)
  }
  let dir
  try {
    dir = mkdtempSync(join(root, 'node_modules', '.package-under-test-'))
  } catch {
    console.error('Cannot unpack the tarball: node_modules is missing — run `pnpm install` first.')
    process.exit(2)
  }
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }))
  const unpacked = spawnSync('tar', ['-xzf', tarball, '-C', dir], { encoding: 'utf8' })
  if (unpacked.status !== 0) {
    console.error(`Cannot unpack ${tarball}: ${unpacked.stderr || unpacked.error?.message}`)
    process.exit(2)
  }
  return { root: join(dir, 'package'), tarball }
}

/**
 * @param {string} tarball Absolute path of the tarball.
 * @returns {string[] | undefined} Every file in it, without the leading `package/`, or
 *   `undefined` when it cannot be listed.
 */
export function listTarball(tarball) {
  const listed = spawnSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
  if (listed.status !== 0) {
    return undefined
  }
  return listed.stdout
    .split('\n')
    .filter((entry) => entry !== '' && !entry.endsWith('/'))
    .map((entry) => (entry.startsWith('package/') ? entry.slice('package/'.length) : entry))
}
