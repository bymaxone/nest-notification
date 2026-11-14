# `SmtpEmailProvider` reference

Reference for the bundled `SmtpEmailProvider` of [`@bymax-one/nest-notification`](../README.md). The README's SMTP section is the short version.

`SmtpEmailProvider` speaks the protocol rather than one vendor's HTTP API, so the same adapter drives a corporate relay, Postfix, SES-via-SMTP, and the mail-capture servers (Mailpit, MailHog) that make email flows testable end to end. Requires the optional `nodemailer` peer dependency.

```typescript
import { BymaxNotificationModule, SmtpEmailProvider } from '@bymax-one/nest-notification'

// Local capture server — no credentials, no TLS. Read the captured mail at :8025.
const mailpit = new SmtpEmailProvider({ host: 'localhost', port: 1025, secure: false })

// Authenticated production relay. STARTTLS is already mandatory by default here.
const relay = new SmtpEmailProvider({
  host: process.env.SMTP_HOST,
  port: 587,
  credentials: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
})

BymaxNotificationModule.forRoot({
  email: {
    provider: process.env.NODE_ENV === 'production' ? relay : mailpit,
    defaultFrom: 'no-reply@acme.com'
  }
})
```

| Option                                                    | Default                                | Notes                                                                        |
| --------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `host`                                                    | —                                      | Required. Without it `isConfigured()` is `false` and `send()` throws.        |
| `port`                                                    | `587`                                  | Submission port.                                                             |
| `secure`                                                  | `true` iff port 465                    | Implicit TLS from the first byte.                                            |
| `requireTls`                                              | `true` unless implicit TLS or loopback | Makes the STARTTLS upgrade mandatory. See the TLS note below.                |
| `credentials`                                             | — (open relay)                         | `{ user, pass }`. Supplying it declares the deployment logs in.              |
| `tls`                                                     | —                                      | `rejectUnauthorized` / `servername` / `ca`, for a relay behind a private CA. |
| `connectionTimeout` / `greetingTimeout` / `socketTimeout` | `10s` / `10s` / `20s`                  | Bounded on purpose — Nodemailer's own defaults run into minutes.             |
| `sendTimeoutMs`                                           | `60000`                                | Bounds the whole `send()`, in ms. It may still be delivered; see below.      |

`sendTimeoutMs` is an integer from `1` to `2147483647`. The timeouts above bound a phase or an idle socket, so a relay that keeps trickling bytes could hold a send past all of them; this bounds the whole call. A send that exceeds it fails with `EMAIL_SEND_FAILED` and the code `ETIMEDOUT`. Nodemailer cannot abort a send in flight: the message may still be delivered, and the connection is left for `socketTimeout` to reap.

> **Note**
> `isConfigured()` answers on the real configuration, not on "a transport object exists". Omitting `credentials` marks the relay as open and is fine; supplying them half-loaded — an `SMTP_PASS` that never made it into the environment — reports **not configured** and fails the send closed, rather than silently attempting an anonymous delivery a permissive relay might accept.

> **Warning**
> **STARTTLS is mandatory by default for any non-loopback host.** On a connection that does not start out encrypted, whether TLS happens at all is decided by the _plaintext_ EHLO banner: an attacker with network position strips the `250-STARTTLS` line, the transport never upgrades, and the credentials and the message body — which carries the OTP code — cross the network in the clear. So `requireTls` defaults to `true` unless the host is `localhost` / `127.0.0.1` / `::1` or `secure` is already on. If your relay genuinely cannot upgrade, opt out explicitly with `requireTls: false`; a Mailpit or MailHog container reached by its compose service name rather than over loopback is the common case.

Three further behaviours worth knowing:

- The returned `messageId` is the RFC-5322 `Message-ID` with its angle brackets, so an audit entry correlates with the header the recipient received.
- `tags` are not forwarded, because SMTP has no tag facility — they still reach the audit log through `EmailService`.
- A line break in `from`, `replyTo`, a recipient, or a custom header name/value is **rejected before the send**. Nodemailer already neutralizes those, so this is defence in depth — but header injection is the one place where trusting a peer dependency's current behaviour would be the whole security boundary. The subject is deliberately exempt: a stray trailing newline from a template is plausible there, and Nodemailer folds it away.
