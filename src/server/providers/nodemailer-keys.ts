/**
 * @fileoverview Gives what the SMTP adapter hands to Nodemailer an own key for every name it reads.
 * @layer infrastructure
 *
 * Nodemailer copies the own keys of what it is given into ordinary objects (`MailMessage.data`, the
 * options of `SMTPTransport`, the `opts` of `tls.connect`) and then reads names this library never
 * sets: `envelope`, `raw`, `list`, `service`, `proxy`, `path`, `rejectUnauthorized`. From an ordinary
 * object those reads reach `Object.prototype`, so a key planted there decides who receives a message,
 * which host it is sent to, or whether the certificate is checked. An object with no prototype is not
 * enough, because the copy has one. An own key that is `undefined` is copied too, and it shadows the
 * root: every name below is an own key of what Nodemailer receives, set to our value or to
 * `undefined`. A spec reads the sources of the Nodemailer the tests install and fails when a name it reads from a
 * message, the transport options or the credentials is missing here.
 */

import { withOwnKeys } from '../utils/read-options'

/** What Nodemailer reads from a message. */
export const MESSAGE_KEYS =
  'alternatives amp attachDataUrls attachments auth baseBoundary bcc boundaryPrefix cc date disableFileAccess disableUrlAccess dkim dsn encoding envelope from headers html icalEvent inReplyTo list maxRecipients messageId newline normalizeHeaderKey otp priority raw references replyTo requireTLSExtensionEnabled sender ses signal subject text textEncoding to watchHtml xMailer'.split(
    ' '
  )

/** What Nodemailer reads from the options of a transport, and `createTransport` from its configuration. */
export const TRANSPORT_KEYS =
  'SES allowInternalNetworkInterfaces attachDataUrls auth authMethod autoSelectFamily autoSelectFamilyAttemptTimeout connectionTimeout customAuth debug direct disableFileAccess disableUrlAccess dkim dnsTimeout dnsTtl forceAuth getSocket greetingTimeout host idleTimeout ignoreTLS jsonTransport lmtp localAddress logger lookup maxConnections maxMessages maxRecipients maxRequeues maxResponseSize name normalizeHeaderKey opportunisticTLS pool port proxy rateDelta rateLimit requireTLS secure secured sendmail servername service socket socketCloseTimeout socketTimeout streamTransport timeout tls transactionLog url'.split(
    ' '
  )

/** What Nodemailer reads from the credentials, and what Node reads from the options of `tls.connect`. */
export const AUTH_KEYS =
  'accessToken accessUrl clientId clientSecret credentials customHeaders customParams expires method oauth2 options pass privateKey provisionCallback refreshToken scope service serviceClient serviceRequestTimeout timeout tls type user xoauth2'.split(
    ' '
  )

/** What `tls.connect` and `net.connect` read from the options Nodemailer builds out of `tls`. */
export const TLS_KEYS =
  'ALPNProtocols allowHalfOpen allowPartialTrustChain ca cert checkServerIdentity ciphers clientCertEngine crl dhparam ecdhCurve enableTrace family handshakeTimeout highWaterMark hints honorCipherOrder host key keepAlive localAddress lookup maxVersion minDHSize minVersion noDelay onread passphrase path pfx port privateKeyEngine privateKeyIdentifier pskCallback pskIdentityHint rejectUnauthorized requestCert secureContext secureOptions secureProtocol servername session sessionIdContext sessionTimeout sigalgs socket ticketKeys timeout'.split(
    ' '
  )

/**
 * The `tls` option as the transport gets it: an object with an own key for every name `tls.connect`
 * reads, the host's values in place. A value that is not an options object (`x`, `5`, an array) is
 * left to the transport as it is, and an unset one becomes an object of unset keys, so a key planted
 * on the realm root cannot turn the certificate check off.
 *
 * @param tls - The `tls` option the host gave, read once.
 * @returns The object to hand to Nodemailer, or the value when it is not an object.
 */
export function ownTlsKeys<T>(tls: T): T {
  const isOptions =
    tls === undefined || (typeof tls === 'object' && tls !== null && !Array.isArray(tls))
  return (isOptions ? withOwnKeys((tls ?? {}) as object, TLS_KEYS) : tls) as T
}
