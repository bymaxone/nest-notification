/**
 * @fileoverview Public entry of the `./push` subpath: the reference push adapters.
 * @layer infrastructure
 *
 * A host that sends push through its own `IPushProvider` never loads a byte of this entry. The
 * channel itself (`PushService`, the `push` option, `dispatch`) is part of the main entry; only the
 * adapters live here, so an adapter a host does not use costs it nothing.
 */

export {
  ExpoPushProvider,
  type ExpoPushProviderOptions
} from '../server/providers/expo-push.provider'
