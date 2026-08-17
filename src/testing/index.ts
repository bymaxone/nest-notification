/**
 * @fileoverview Public surface of the `./testing` subpath.
 * @layer testing
 *
 * Test-time helpers for consumers who implement this library's extension
 * points. Nothing here is imported by the runtime entries, so a production
 * bundle never pulls it in.
 */

export { otpStorageContract } from './otp-storage-contract'
export type {
  OtpStorageContractCase,
  OtpStorageContractOptions,
  OtpStorageFactory
} from './otp-storage-contract'
