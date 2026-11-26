/**
 * @fileoverview Public entry of the `./push/fcm` subpath: the Firebase Cloud Messaging adapter.
 * @layer infrastructure
 *
 * Its own entry, so a host that does not send through FCM loads none of it.
 */

export {
  FcmPushProvider,
  type FcmPushProviderOptions
} from '../../server/providers/fcm-push.provider'
export type { FcmFetch } from '../../server/providers/fcm-push.client'
