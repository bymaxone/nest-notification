/**
 * Pins how `package.json` declares `@types/react`: the declarations of the `./react` subpath import
 * from `react`, so the types are an optional peer, with no version range of their own. A range
 * would make npm refuse to install the package beside a `@types/react` outside it, including for
 * consumers who never import the subpath.
 *
 * Layer: repository tooling, tests.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

interface Manifest {
  readonly peerDependencies: Record<string, string>
  readonly peerDependenciesMeta: Record<string, { readonly optional?: boolean }>
}

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8')
) as Manifest

describe('the @types/react peer', () => {
  // `*` accepts whatever types the consumer's own React major uses.
  it('should accept any version', () => {
    expect(manifest.peerDependencies['@types/react']).toBe('*')
  })

  // A consumer of the server entry has no React, so nothing may be installed for them.
  it('should be optional', () => {
    expect(manifest.peerDependenciesMeta['@types/react']).toEqual({ optional: true })
  })
})
