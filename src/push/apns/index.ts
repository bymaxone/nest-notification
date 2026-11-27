/**
 * @fileoverview Public entry of the `./push/apns` subpath: the Apple Push Notification service adapter.
 * @layer infrastructure
 *
 * Its own entry, so a host that does not send through APNs loads none of it.
 */

export {
  ApnsPushProvider,
  type ApnsPushProviderOptions,
  type ApnsConnect
} from '../../server/providers/apns-push.provider'
