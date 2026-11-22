/**
 * @fileoverview Refuses an OTP action or delivery channel the library does not know.
 * @layer utils
 *
 * An action that is not one of the three would fall through to `generate` and send a code nobody
 * asked for, and a delivery channel that is not one of the two would be read as `manual` and store
 * a code that is never delivered. Both are refused before any state exists.
 */

import { refuseInput } from './bounded-list'

/** The actions an OTP dispatch carries. */
const ACTIONS: readonly unknown[] = ['generate', 'verify', 'consume']

/** The ways a generated code reaches the recipient. */
const DELIVERIES: readonly unknown[] = ['email', 'manual']

/** What an OTP dispatch does. */
export type OtpAction = 'generate' | 'verify' | 'consume'

/**
 * Validates the action the caller gave and answers the one to run, `generate` when none was given.
 * The caller reads the field once and hands the value here, so what is checked is what is run: a
 * getter that answers `'verify'` to a check and another word to the dispatch would otherwise send
 * a code nobody asked for.
 *
 * @param owner - The component that refuses.
 * @param action - The action as the caller gave it, read once.
 * @returns The action to run.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` for any other value.
 */
export function readOtpAction(owner: string, action: unknown): OtpAction {
  if (action === undefined) {
    return 'generate'
  }
  if (!ACTIONS.includes(action)) {
    throw refuseInput(owner, 'action', 'expected generate, verify or consume')
  }
  return action as OtpAction
}

/**
 * Throws unless the delivery is absent or `email` or `manual`.
 *
 * @param owner - The component that refuses.
 * @param deliverVia - The delivery as the caller gave it.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` for any other value.
 */
export function assertDeliverVia(owner: string, deliverVia: unknown): void {
  if (deliverVia !== undefined && !DELIVERIES.includes(deliverVia)) {
    throw refuseInput(owner, 'deliverVia', 'expected email or manual')
  }
}
