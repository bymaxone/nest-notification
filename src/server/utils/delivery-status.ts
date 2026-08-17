/**
 * @fileoverview Grammar-bounded extraction of SMTP reply codes from provider
 * error text, for the sends whose body must not be published.
 * @layer domain
 *
 * Redaction is a blacklist: it removes the shapes it can predict and loses to
 * the ones it cannot — a relay quoting the body in another transfer encoding
 * defeats every declared value. This module is the whitelist counterpart. It
 * does not remove anything from the provider's text; it reads that text and
 * emits only what a fixed grammar can express, so the output cannot carry body
 * content whatever the input held.
 *
 * The safety property is that the output is **independent of the secret**, not
 * that its alphabet differs from the secret's — a numeric code shares the
 * alphabet of a status line. Independence is what makes the same reply publish
 * `550 5.7.1` whether the code was `550571`, `123456`, or absent entirely.
 *
 * The extraction READS attacker-influenced text. The safety lives in the output
 * grammar, not in avoiding the input — widening the patterns below to "keep a
 * little more context" reopens exactly the hole this module exists to close.
 */

/** Longest RFC 3463 subfield this accepts, bounding what a hostile relay can encode. */
const MAX_SUBFIELD_DIGITS = 3

/** Basic SMTP reply code: three digits opening a 2xx/4xx/5xx reply. */
const BASIC_STATUS = /(?<![\d.])([245]\d\d)(?![\d.])/g

/** RFC 3463 enhanced status code: `class.subject.detail`, each subfield bounded. */
const ENHANCED_STATUS = new RegExp(
  `(?<![\\d.])([245])\\.(\\d{1,${MAX_SUBFIELD_DIGITS}})\\.(\\d{1,${MAX_SUBFIELD_DIGITS}})(?![\\d.])`,
  'g'
)

/** What a failed delivery may publish about itself when its body must not be. */
export interface DeliveryStatus {
  /** The basic SMTP reply code, when the text carried exactly one. */
  status?: number
  /** The RFC 3463 enhanced code, when the text carried exactly one. */
  enhanced?: string
}

/**
 * Returns the sole match of `pattern`, or `undefined` when the text carries
 * none or more than one.
 *
 * Ambiguity resolves to nothing on purpose: a cause chain can place `424`
 * beside `242`, and picking one would publish a value assembled from two
 * different replies. One reply, one status, or silence.
 */
function soleMatch(text: string, pattern: RegExp): string | undefined {
  // `String.match` with a global pattern yields the full matches as plain
  // strings, so there is no index to guard and no unreachable branch to test.
  const found = new Set(text.match(pattern) ?? [])
  const [only] = found
  return found.size === 1 ? only : undefined
}

/**
 * Whether a value is a well-formed basic SMTP reply code.
 *
 * Attached values come from provider code, so they are validated against the
 * same grammar the extractor applies — otherwise a provider could attach the
 * quoted body as a "status" and have it published verbatim by a path whose
 * whole promise is that only the grammar reaches a log.
 *
 * @param value - The candidate, from an untrusted provider.
 * @returns `true` when it is a 2xx/4xx/5xx integer.
 */
export function isBasicStatus(value: number): boolean {
  return Number.isInteger(value) && /^[245]\d\d$/.test(String(value))
}

/**
 * Whether a value is a well-formed RFC 3463 enhanced status code.
 *
 * @param value - The candidate, from an untrusted provider.
 * @returns `true` when it matches `class.subject.detail` within the bounds.
 */
export function isEnhancedStatus(value: string): boolean {
  return new RegExp(`^[245]\\.\\d{1,${MAX_SUBFIELD_DIGITS}}\\.\\d{1,${MAX_SUBFIELD_DIGITS}}$`).test(
    value
  )
}

/**
 * Extracts the SMTP reply codes a provider error carries, discarding
 * everything else it says.
 *
 * Both fields are optional and independently absent: a relay answering
 * `550 Rejected` yields a basic status and no enhanced code, and the caller
 * must treat that as "unknown" rather than inferring meaning from the prose
 * that came with it.
 *
 * @param text - The provider's error text. Never published; only read.
 * @returns The codes the grammar recognized, each present only when unambiguous.
 */
export function extractDeliveryStatus(text: string): DeliveryStatus {
  const basic = soleMatch(text, BASIC_STATUS)
  const enhanced = soleMatch(text, ENHANCED_STATUS)
  return {
    ...(basic !== undefined ? { status: Number(basic) } : {}),
    ...(enhanced !== undefined ? { enhanced } : {})
  }
}
