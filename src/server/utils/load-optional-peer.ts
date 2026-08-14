/**
 * @fileoverview Loader for an optional peer dependency, with an honest diagnosis.
 * @layer infrastructure
 *
 * Every reference adapter that sits on an optional peer (`nodemailer`, `resend`, …)
 * reaches its SDK through a lazy dynamic `import()`. The failure that import can
 * produce is NOT always "the package is missing", and reporting it as such is worse
 * than reporting nothing: it names a fix that cannot work, so the consumer installs
 * a package that is already installed and starts doubting their dependency tree.
 *
 * The case that actually bites: a consumer's Jest suite running without
 * `--experimental-vm-modules` cannot service a dynamic `import()` at all, and fails
 * with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` while the package sits in
 * `node_modules`.
 */

/**
 * Error codes a genuinely absent module produces. `ERR_MODULE_NOT_FOUND` comes from
 * a dynamic `import()` (from an ESM or a CommonJS host alike); `MODULE_NOT_FOUND` is
 * the CommonJS `require` form, which a bundler's interop can still surface.
 */
const MODULE_NOT_FOUND_CODES: ReadonlySet<string> = new Set([
  'ERR_MODULE_NOT_FOUND',
  'MODULE_NOT_FOUND'
])

/**
 * Whether a thrown value says the module could not be resolved at all.
 *
 * @param error - The thrown value; anything, since a rejection is untyped.
 * @returns `true` only for a string `code` naming a module-resolution failure.
 */
function isModuleNotFound(error: unknown): boolean {
  const code = (error as { code?: unknown } | null | undefined)?.code
  return typeof code === 'string' && MODULE_NOT_FOUND_CODES.has(code)
}

/**
 * Dynamically imports an optional peer dependency.
 *
 * @param moduleName - The package specifier. Must be a `string`-typed value rather
 *   than a literal, so the compiler treats the `import()` as runtime-resolved — an
 *   optional peer may be absent at build time.
 * @returns The imported module namespace.
 * @throws Error `"<name> package is not installed…"` only when the module genuinely
 * could not be resolved. Any other failure is surfaced with its own message and the
 * original error kept as `cause`, because a catch-all that reports one cause turns
 * an unknown failure into a confident wrong answer.
 */
export async function loadOptionalPeer<T>(moduleName: string): Promise<T> {
  try {
    return (await import(moduleName)) as T
  } catch (error) {
    if (isModuleNotFound(error)) {
      throw new Error(
        `\`${moduleName}\` package is not installed. Run \`pnpm add ${moduleName}\` in the consumer app.`
      )
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to load \`${moduleName}\`: ${reason}`, { cause: error })
  }
}
