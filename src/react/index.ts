/**
 * @fileoverview Public entry point for the React subpath (`@bymax-one/nest-notification/react`).
 * @layer api
 *
 * Browser-targeted, state/UX-only OTP hooks. No HTTP client, no server code, no
 * Node builtins — verifying a code is the consumer app's job. `react` is an
 * optional peer dependency, external in the published bundle.
 */

export { useOtpInput } from './useOtpInput'
export { useOtpCountdown } from './useOtpCountdown'
export type {
  OtpInputType,
  UseOtpInputOptions,
  UseOtpInputState,
  UseOtpCountdownOptions,
  UseOtpCountdownState
} from './types'
