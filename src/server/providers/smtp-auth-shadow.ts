/**
 * @fileoverview Gives the auth objects Nodemailer builds for itself an own key for every name it
 * reads from them.
 * @layer infrastructure
 *
 * From the credentials it is given Nodemailer builds a second object, `{ type, user, credentials,
 * method }`, and reads `oauth2`, `pass` and `options` from it, which it does not hold. Those reads
 * reach `Object.prototype`: a string planted there under `oauth2` is taken for an OAuth2 client and
 * called, and throws inside a socket callback, where no caller can catch it. The adapter cannot hand
 * these objects over, so it completes them as Nodemailer builds them; a pool's `verify` builds one it
 * cannot reach, which is for the caller to avoid. A transport asked to build its auth from no
 * options of the call, as `verify` asks during a login, is answered the one it holds: copying the
 * credentials again would assign over a locked key and throw. This relies on three members
 * of Nodemailer's transports, `auth`, `getAuth` and, on a pooled one, `_createConnection`; a spec
 * runs the real Nodemailer and fails when the objects are no longer reached.
 */

import { AUTH_KEYS } from './nodemailer-keys'

/** The members of Nodemailer's own transport this module reaches. */
interface NodemailerInternals {
  auth?: unknown
  getAuth?: (...args: unknown[]) => unknown
  _createConnection?: (...args: unknown[]) => { auth?: unknown }
}

/**
 * Adds, in place, an own key that is `undefined` for every name of {@link AUTH_KEYS} the object does
 * not hold. In place because Nodemailer keeps the object and writes to it later.
 *
 * @param auth - An auth object, or what stands for none (`false`, `undefined`).
 * @returns The same value.
 */
function completeAuth(auth: unknown): unknown {
  if (typeof auth === 'object' && auth !== null) {
    for (const name of AUTH_KEYS) {
      if (!Object.hasOwn(auth, name)) {
        Reflect.set(auth, name, undefined)
      }
    }
  }
  return auth
}

/** Whether `getAuth` was asked to build from options that add nothing to the transport's own. */
function addsNothing(options: unknown): boolean {
  return typeof options === 'object' && options !== null && Object.keys(options).length === 0
}

/**
 * Completes the auth object a transport has built and every one it builds afterwards. A transport
 * that is not Nodemailer's own (a stand-in) is left alone.
 *
 * @param transport - What `createTransport` returned.
 */
export function shadowTransportAuth(transport: object): void {
  if (!Object.hasOwn(transport, 'transporter')) {
    return
  }
  const inner = (transport as { transporter: NodemailerInternals }).transporter
  completeAuth(inner.auth)
  const getAuth = inner.getAuth
  if (typeof getAuth === 'function') {
    inner.getAuth = (...args): unknown => {
      if (addsNothing(args[0]) && Object.hasOwn(inner, 'auth') && inner.auth) {
        return inner.auth
      }
      return completeAuth(getAuth.apply(inner, args))
    }
  }
  const createConnection = inner._createConnection
  if (typeof createConnection === 'function') {
    inner._createConnection = (...args): { auth?: unknown } => {
      const connection = createConnection.apply(inner, args)
      completeAuth(connection.auth)
      return connection
    }
  }
}
