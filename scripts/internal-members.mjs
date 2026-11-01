/**
 * @fileoverview Finds the members a source file tags `@internal`.
 * @layer scripts
 *
 * `check:published` uses it to prove none of those members reaches a published declaration. A
 * tag whose member this reader cannot name must not pass unseen, so the reader reports the
 * number of tags it saw next to the members it named, and the caller fails when they differ.
 * It refuses rather than guesses: a name must be followed by what can follow a member's name, a
 * decorator name cannot be shortened, and a decorator argument it cannot read whole (a nested
 * call, several lines, a string) leaves the member unnamed.
 *
 * Comment blocks are found with `indexOf`, one pass over the text, so no input makes the scan
 * backtrack.
 */

const MODIFIER =
  'private|protected|public|async|readonly|static|abstract|override|declare|accessor|get|set'

/** A decorator or a line comment between the tag and the member. A decorator argument holding a
 * quote or a backtick is unreadable here: its `)` may be text. */
const BETWEEN = String.raw`(?:@[\w.]+(?![\w.])(?:\([^)"'\`\n]*\))?|\/\/[^\n]*)\s*`

/** What may follow a member's name. Anything else (a `$`, a non-ASCII letter, a keyword such as
 * `const` or `function`) means the name was cut short or is not a member, so the match fails. */
const AFTER_NAME = String.raw`(?=\s*[?!:=(<;,])`

/** The member that follows a comment block, matched at the exact end of the block. */
const MEMBER = new RegExp(
  `\\s*(?:${BETWEEN})*(?:(?:${MODIFIER})\\s+)*(?:\\*\\s*)?(\\w+)${AFTER_NAME}`,
  'y'
)

const TAG = /@internal(?!\w)/

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
    MEMBER.lastIndex = end
    const match = MEMBER.exec(text)
    if (match) members.push(match[1])
  }
  return { tags, members }
}
