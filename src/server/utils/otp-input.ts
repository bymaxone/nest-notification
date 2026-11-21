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

/**
 * Throws unless the action is absent or one of `generate`, `verify` and `consume`.
 *
 * @param owner - The component that refuses.
 * @param action - The action as the caller gave it.
 * @throws NotificationException `INVALID_SCOPE_IDENTIFIER` for any other value.
 */
export function assertOtpAction(owner: string, action: unknown): void {
  if (action !== undefined && !ACTIONS.includes(action)) {
    throw refuseInput(owner, 'action', 'expected generate, verify or consume')
  }
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
