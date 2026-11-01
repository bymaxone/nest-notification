/**
 * @fileoverview Finds the members a source file tags `@internal`.
 * @layer scripts
 *
 * `check:published` uses it to prove none of those members reaches a published declaration. A
 * tag whose member this reader cannot name must not pass unseen, so the reader reports the
 * number of tags it saw next to the members it named, and the caller fails when they differ.
 *
 * It refuses rather than guesses, and it cannot backtrack: comment blocks are found with
 * `indexOf` and what follows a tag is read by one forward scan over characters, never by a
 * pattern that could give characters back and name a fragment. A member is named only when
 * every word before its name is a modifier, a decorator argument list is read whole on one line
 * with no quote in it and within a fixed length, and the name is followed by what can follow a
 * member's name. Anything else leaves the tag without a member.
 */

const MODIFIERS = new Set([
  'private',
  'protected',
  'public',
  'async',
  'readonly',
  'static',
  'abstract',
  'override',
  'declare',
  'accessor',
  'get',
  'set'
])

/** What may follow a member's name. Anything else (a `$`, a non-ASCII letter, a keyword such as
 * `const` or `function`) means the name was cut short or is not a member. */
const AFTER_NAME = '?!:=(<;,'

/** The longest decorator argument list read. A longer one is unreadable, which bounds the work a
 * tag costs on one very long line. */
const MAX_ARGUMENTS = 2000

const TAG = /@internal(?!\w)/
const WORD = /\w+/y
const DECORATOR_NAME = /[\w.]+/y
const SPACE = /\s/

/** The index of the first non-space character at or after `i`. */
function skipSpace(text, i) {
  let at = i
  while (at < text.length && SPACE.test(text.charAt(at))) at += 1
  return at
}

/** The index after a decorator's argument list that starts at `open`, or -1 when it cannot be read whole. */
function skipArguments(text, open) {
  const limit = Math.min(text.length, open + MAX_ARGUMENTS)
  for (let at = open + 1; at < limit; at += 1) {
    const char = text.charAt(at)
    if (char === ')') return at + 1
    if (char === '"' || char === "'" || char === '`' || char === '\n') return -1
  }
  return -1
}

/** The index of the first character after any line comments and decorators, or -1 when the shape
 * is unreadable or reaches `limit`, the start of the next comment block: a member that follows
 * another block belongs to that block, and stopping there keeps the work of all tags linear. */
function skipTrivia(text, start, limit) {
  let at = start
  for (;;) {
    at = skipSpace(text, at)
    if (at >= limit) return -1
    if (text.startsWith('//', at)) {
      const newline = text.indexOf('\n', at)
      if (newline === -1) return text.length
      at = newline
    } else if (text.charAt(at) === '@') {
      DECORATOR_NAME.lastIndex = at + 1
      if (!DECORATOR_NAME.exec(text)) return -1
      at = DECORATOR_NAME.lastIndex
      if (text.charAt(at) === '(') {
        at = skipArguments(text, at)
        if (at === -1) return -1
      }
    } else {
      return at
    }
  }
}

/** The name of the member declared at `start`, or undefined when the shape is not one it reads. */
function memberAt(text, start, limit) {
  let at = skipTrivia(text, start, limit)
  if (at === -1) return undefined
  const words = []
  let afterStar = false
  for (;;) {
    WORD.lastIndex = at
    const word = WORD.exec(text)
    if (!word) return undefined
    words.push(word[0])
    at = skipSpace(text, WORD.lastIndex)
    if (afterStar) break
    if (text.charAt(at) === '*') {
      if (word[0] !== 'async') return undefined
      afterStar = true
      at = skipSpace(text, at + 1)
    } else if (!WORD_CHAR.test(text.charAt(at))) {
      break
    }
  }
  const name = words.pop()
  if (!words.every((word) => MODIFIERS.has(word))) return undefined
  return at < text.length && AFTER_NAME.includes(text.charAt(at)) ? name : undefined
}

const WORD_CHAR = /\w/

/**
 * Reads the `@internal` tags of one source text.
 *
 * @param {string} text - Contents of a source file.
 * @returns {{ tags: number, members: string[] }} The tags seen, and the member each one hides
 *   where the reader could name it, in source order.
 */
export function readInternalMembers(text) {
  let tags = 0
  const members = []
  let from = 0
  for (;;) {
    const start = text.indexOf('/**', from)
    if (start === -1) break
    const close = text.indexOf('*/', start + 2)
    if (close === -1) break
    const end = close + 2
    from = end
    if (!TAG.test(text.slice(start, end))) continue
    tags += 1
    const next = text.indexOf('/**', end)
    const member = memberAt(text, end, next === -1 ? text.length : next)
    if (member !== undefined) members.push(member)
  }
  return { tags, members }
}
