import { loadOptionalPeer } from './load-optional-peer'

// The loader is exercised through a virtual module whose factory decides how the
// import fails, which is the only way to drive the `code` branches deterministically.
let mockFailure: (Error & { code?: string }) | null = null

jest.mock(
  'virtual-optional-peer',
  () => {
    if (mockFailure) {
      throw mockFailure
    }
    return { __esModule: true, hello: 'world' }
  },
  { virtual: true }
)

/** Builds an error carrying a Node `code`, the way a failed import does. */
function failWith(message: string, code?: string): Error & { code?: string } {
  const error: Error & { code?: string } = new Error(message)
  if (code !== undefined) {
    error.code = code
  }
  return error
}

const MODULE: string = 'virtual-optional-peer'

describe('loadOptionalPeer', () => {
  beforeEach(() => {
    mockFailure = null
    jest.resetModules()
  })

  // The happy path hands the namespace back untouched.
  it('should return the imported module', async () => {
    await expect(loadOptionalPeer<{ hello: string }>(MODULE)).resolves.toMatchObject({
      hello: 'world'
    })
  })

  // Only a genuinely unresolvable module earns the install instruction, and both
  // codes mean that: ERR_MODULE_NOT_FOUND from a dynamic import, MODULE_NOT_FOUND
  // from the CommonJS require form a bundler's interop can still surface. The
  // messages are the shapes Node 24 actually produces.
  it.each([
    ['ERR_MODULE_NOT_FOUND', `Cannot find package '${MODULE}' imported from /app/index.mjs`],
    ['MODULE_NOT_FOUND', `Cannot find module '${MODULE}'`]
  ])('should report a missing package for %s naming this module', async (code, message) => {
    mockFailure = failWith(message, code)
    jest.resetModules()

    const error = (await loadOptionalPeer(MODULE).catch((thrown: unknown) => thrown)) as Error & {
      cause?: unknown
    }

    expect(error.message).toBe(
      '`virtual-optional-peer` package is not installed. Run `pnpm add virtual-optional-peer` in the consumer app.'
    )
    // The instruction names the fix; the cause names the specifier the runtime
    // actually rejected, which a nested resolution failure does not share with it.
    expect(error.cause).toBe(mockFailure)
  })

  // The trap the code alone walks into. An INSTALLED peer whose own evaluation
  // fails because one of ITS dependencies is missing rejects with the very same
  // codes — verified on Node 24 with a real fixture package. Blaming the top-level
  // peer there is the same bug this helper exists to fix, one level down.
  it.each([
    [
      'ERR_MODULE_NOT_FOUND',
      "Cannot find package 'missing-transitive' imported from /app/node_modules/virtual-optional-peer/index.mjs"
    ],
    ['MODULE_NOT_FOUND', "Cannot find module 'missing-transitive'"]
  ])(
    'should not blame this module when %s names a transitive dependency',
    async (code, message) => {
      mockFailure = failWith(message, code)
      jest.resetModules()

      const error = (await loadOptionalPeer(MODULE).catch((thrown: unknown) => thrown)) as Error

      expect(error.message).toBe(`Failed to load \`${MODULE}\`: ${message}`)
      expect(error.message).not.toContain('not installed')
    }
  )

  // The specifier check must not be reached for an unrelated code, even when the
  // message happens to name this module.
  it('should not report a missing package for an unrelated code naming this module', async () => {
    mockFailure = failWith(`Cannot access '${MODULE}'`, 'EACCES')
    jest.resetModules()

    await expect(loadOptionalPeer(MODULE)).rejects.toThrow(
      `Failed to load \`${MODULE}\`: Cannot access '${MODULE}'`
    )
  })

  // A resolution code with no usable message cannot confirm the specifier is ours,
  // so it degrades to the honest report rather than guessing.
  it('should not report a missing package when the message is not a string', async () => {
    const error = new Error('placeholder') as Error & { code?: string; message: unknown }
    error.code = 'ERR_MODULE_NOT_FOUND'
    error.message = 42 as unknown as string
    mockFailure = error as Error & { code?: string }
    jest.resetModules()

    await expect(loadOptionalPeer(MODULE)).rejects.toThrow('Failed to load `virtual-optional-peer`')
  })

  // The failure that made this helper necessary. A consumer's Jest suite without
  // `--experimental-vm-modules` cannot service a dynamic import at all, while the
  // package sits in node_modules. Reporting that as "not installed" names a fix that
  // cannot work, so the consumer reinstalls a package they already have.
  it('should surface a dynamic-import-unsupported failure as itself', async () => {
    mockFailure = failWith(
      'A dynamic import callback was invoked without --experimental-vm-modules',
      'ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG'
    )
    jest.resetModules()

    const error = (await loadOptionalPeer(MODULE).catch((thrown: unknown) => thrown)) as Error & {
      cause?: unknown
    }

    expect(error.message).toBe(
      'Failed to load `virtual-optional-peer`: A dynamic import callback was invoked without --experimental-vm-modules'
    )
    expect(error.message).not.toContain('not installed')
    // The original is kept so a consumer can inspect the real cause.
    expect(error.cause).toBe(mockFailure)
  })

  // A failure with no `code` at all — a broken module body throwing on evaluation,
  // say — must not be mistaken for an absent package either.
  it('should surface a failure carrying no code as itself', async () => {
    mockFailure = failWith('boom during module evaluation')
    jest.resetModules()

    await expect(loadOptionalPeer(MODULE)).rejects.toThrow(
      'Failed to load `virtual-optional-peer`: boom during module evaluation'
    )
  })

  // An unrelated Node code must not be swept into the missing-package branch.
  it('should surface an unrelated error code as itself', async () => {
    mockFailure = failWith('permission denied', 'EACCES')
    jest.resetModules()

    await expect(loadOptionalPeer(MODULE)).rejects.toThrow(
      'Failed to load `virtual-optional-peer`: permission denied'
    )
  })

  // A non-Error rejection still has to produce a usable message rather than
  // "[object Object]" swallowing the cause.
  it('should stringify a non-Error rejection', async () => {
    mockFailure = 'kaboom' as unknown as Error & { code?: string }
    jest.resetModules()

    await expect(loadOptionalPeer(MODULE)).rejects.toThrow(
      'Failed to load `virtual-optional-peer`: kaboom'
    )
  })

  // A thrown value with a non-string `code` must not be compared as if it were one.
  it('should surface a failure whose code is not a string as itself', async () => {
    const error = new Error('weird') as Error & { code?: unknown }
    error.code = 42
    mockFailure = error as Error & { code?: string }
    jest.resetModules()

    await expect(loadOptionalPeer(MODULE)).rejects.toThrow(
      'Failed to load `virtual-optional-peer`: weird'
    )
  })
})
