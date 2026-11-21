/**
 * @fileoverview Reads a list a host or a caller supplied into a copy of bounded size, once.
 * @layer utils
 */

import { NotificationException } from '../errors/notification-exception'

/** The most entries a list read from a host or a caller may have. */
export const MAX_LIST_ENTRIES = 1000

/**
 * Builds the refusal of a value that is not an acceptable list or entry. Both fields name the
 * boundary, the parameter and the reason, and neither carries the value.
 *
 * @param owner - The component that refused.
 * @param label - The parameter, or the entry of it.
 * @param reason - Why, in a fixed vocabulary.
 * @returns The exception to throw.
 */
export function refuseInput(owner: string, label: string, reason: string): NotificationException {
  return new NotificationException(
    'INVALID_SCOPE_IDENTIFIER',
    { boundary: owner, parameter: label, reason },
    { message: `[${owner}] ${label} ${reason}` }
  )
}

/**
 * Copies a list after its length has been read once and found to be an integer from 0 to
 * {@link MAX_LIST_ENTRIES}, reading each index once and checking the kind of each entry.
 *
 * The length is checked before anything is copied or iterated, so a list of a length the host
 * chose costs nothing to refuse. The copy is what the caller uses from then on: a getter or a
 * proxy that answers another entry the second time is never asked again.
 *
 * @param owner - The component that reads the list, for the refusal.
 * @param label - The parameter, for the refusal.
 * @param value - What the host or the caller gave.
 * @param isEntry - Whether an entry is of the kind the list holds.
 * @param refuse - Builds the refusal for a reason; by default `INVALID_SCOPE_IDENTIFIER`.
 * @returns The copy.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` when it is not a list, is longer than
 *   allowed, or holds an entry of another kind.
 */
export function boundedList<T>(
  owner: string,
  label: string,
  value: unknown,
  isEntry: (entry: unknown) => entry is T,
  refuse: (reason: string) => NotificationException = (reason) => refuseInput(owner, label, reason)
): T[] {
  if (!Array.isArray(value)) {
    throw refuse('expected a list')
  }
  const length: unknown = value.length
  if (
    typeof length !== 'number' ||
    !Number.isInteger(length) ||
    length < 0 ||
    length > MAX_LIST_ENTRIES
  ) {
    throw refuse(`expected at most ${String(MAX_LIST_ENTRIES)} entries`)
  }
  const copy: T[] = []
  for (let index = 0; index < length; index += 1) {
    const entry: unknown = Reflect.get(value, index)
    if (!isEntry(entry)) {
      throw refuse(`entry ${String(index)} is of an unexpected kind`)
    }
    copy.push(entry)
  }
  return copy
}
