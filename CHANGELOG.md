# Changelog

All notable changes to `@bymax-one/nest-notification` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

Versioning is **not** strict [SemVer](https://semver.org/spec/v2.0.0.html) while this API is
pre-stable: breaking changes ship in minor and patch releases by explicit `@bymax-one` policy, so a
version number carries no compatibility information. The **Apply to a derived backend** note, on
the entries that carry one, is the compatibility contract — read it, not the number.

## [Unreleased]

## [1.4.23] - 2026-11-22

### Fixed

- **A store whose `recordFailure` answered anything but a whole number let the failure budget go unenforced.** An
  `undefined`, `NaN`, an object, `0`, `-1`, `true` or a string compared false against the ceiling, so after several
  wrong guesses and a re-issue the right code returned `valid: true`. The count must now be an integer of at least `1`,
  and any other answer is `OTP_STORAGE_FAILED`.
- **The same check for the other answers a store gives.** `tryAcquireCooldown` and `deleteIfCode` must resolve a boolean
  (a truthy string was read as a lock taken or a code removed), `consumeAttempt` must resolve one of its three statuses
  with an entry of the declared kinds (an unknown status fell through as success, then raised a raw `TypeError`), and
  `isConfigured()` of a store or an email provider must return a boolean. Each is refused instead of read.
- **`audit.maskRecipient` now covers the error text of a failed audit row.** The row of a failed delivery or send, and the
  row the audit interceptor writes for a handler's error, carried the store's, the provider's or the handler's own text,
  which can quote the address it refused. Every token of that text that holds an at-sign is replaced, whole, by what
  `audit.maskRecipient` answers for it, whoever the address belongs to and however it is spelled (`550 <bob@x.com>
unknown` keeps its brackets). The at-sign is `@`, fullwidth `\uff20`, small `\ufe6b`, or any escape of one of them: each token is decoded again and
  again until it stops changing, so `%2540`, `&amp;#64;`, `%25%34%30` and `%EF%BC%A0` are all found, and a token that still changes after the decoder's bound
  is masked. An answer of `audit.maskRecipient` that still holds an at-sign (the default mask hands the address back, and a mask that keeps the domain does too) is replaced by `[address]`. A token is
  a run of characters that are not ASCII white space and not one of `<>(),[]`, a quoted string counting as one piece
  (`"first last"@x.com`, escapes and all); every other space (no-break, zero-width) stays inside the token, so it cannot
  cut an address in two. Words that merely contain an at-sign are masked too, since a missed address is the worse
  mistake; a mask of yours that throws is answered with `[masked]`, and the failure it was called from is still
  reported. A recipient that is not an address (a phone number) is replaced where the OTP path wrote it exactly.
- **A failed send no longer carries the provider's error as its `cause`.** When the provider's text is published (the
  default), the `cause` of `EMAIL_SEND_FAILED` is a fresh `Error` that holds the provider's message with secrets removed and address tokens masked, and nothing else (no `code`: the provider's code is read for the status of the failure);
  the provider's own error and its nested chain are not kept. A send with `publishProviderText: false`, or one whose error
  chain is too large to examine, still carries no `cause` at all. The Resend and SMTP adapters copy the provider's `code` to the error they throw (and to the log line when the provider's text is published), and drop it when it holds a value declared secret (`auditRedactValues`, or `redactValues` on a provider's own send). Where the provider's text is published, their failure log line and thrown message mask
  address tokens the same way (`[address]`). Out of scope, with the reason: the at-sign spelled as a word or
  with spaces (`bob [at] x.com`, `bob (at) x.com`, `bob @ x.com`), which no mail system or SDK writes into an error and
  which cannot be told from prose without reading its meaning. The text is bounded before it is read, since its length
  is the provider's to choose; a token that starts inside the bound is read to its end and masked whole, and one that starts past it, or that ends near the end of what was read while more text follows, is left out, so the bound never publishes the front half of an address.
- **A key planted on `Object.prototype` no longer reaches an option or an input.** Every option, every input of
  `send()`, the OTP calls and `dispatch()`, the provider options and the TLS options were read by property access, which
  follows the prototype chain to the realm root, so code that ran first could set `Object.prototype.bcc` (a copy of every
  message), `maxAttempts`, `resendCooldownSeconds` or `codeSecret` (the limits and the key of the codes), `maskRecipient`,
  `host` or `apiKey` (a provider that is configured and points elsewhere), and any option the host left unset took the
  value. A value found only on the realm-root prototype is now absent; an own property, a property of a class of yours
  and a getter on its prototype still count. The options and the message
  handed to a provider have no prototype, so a key that is not set is absent for a custom provider too.
  The same holds for what the library hands to a mail transport, an SDK, a renderer or a store: the SMTP message and
  transport configuration (nodemailer reads keys this library never sets, and a planted key must not answer for them),
  the Resend payload, the default template renderer (its options,
  each template's `text`, and what it renders), the store wrapper (an operation the store does not have stays absent),
  the dispatch request and its OTP payload, and the error codes and credentials the adapters read. The reference
  adapters also read the message they are given by name, so a direct caller's plain object is covered. A `Proxy` around
  your options or input answers for itself, and the topmost prototype of a chain built by hand cannot be told from the
  realm root, so it is read as absent.
- **A guess that is not a string is refused before anything uses it.** `verify({ code: 271620 })` reached the
  digest, whose `TypeError` quotes the value it was given, and a `String` object compared as the code. A `code` that is
  not a string is now `INVALID_SCOPE_IDENTIFIER`, naming the field and never the value.
- **A provider's refusal of a message reaches the caller as a refusal.** Resend refuses a `contentDisposition` that
  disagrees with the `cid` before anything is sent; `send()` answered that as a 502 `EMAIL_SEND_FAILED` and a failed
  delivery. A provider's `INVALID_SCOPE_IDENTIFIER` now passes on as the library's own refusal, with the library's words
  (a provider can be yours, and its text is its own). No audit row is written for it: nothing was sent, as with any other
  refusal of the input.
- **A failed `verify()` leaves the way a failed `generate()` does,** with the guess removed from the error's chain and a
  value that is not an error flattened.
- **An OTP action or delivery channel the library does not know is refused.** An `action` such as `'verfy'` fell through
  to `generate` and sent a code nobody asked for; a `deliverVia` such as `'sms'` was read as `'manual'` and stored a code
  that was never delivered. Both raise `INVALID_SCOPE_IDENTIFIER`.
- **Options are checked for their kind.** `otp.consumeOnVerify`, `otp.strictPurposes` and `audit.swallowErrors` must be
  `true` or `false`: the string `'false'` was read as `true` (`swallowErrors: 'false'` swallowed audit failures that the
  host had asked to see). `audit.maskRecipient` must be a function. `otp.perPurpose: null` is refused, not read as an
  empty allowlist.
- **What a caller passes to `send()` is checked for its kind and read once.** `to`, `cc` and `bcc` are a string or a list
  of at most 1000 strings, `attachments`, `tags` and `auditRedactValues` are lists of at most 1000 entries of the right
  kind, an attachment's `content` is a string, a `Buffer` or a `Uint8Array` (a number gave `NaN > limit`, which is
  false, and passed the byte budget), and `publishProviderText` is a boolean (`'false'` was read as "publish the
  provider's text"). Each list is read into a copy before anything uses it. A `to: null` is now a refusal of the
  library (`rejected` for the observer), not a `TypeError` (`failed`).
- **The input of every entry point that takes a caller's object (generate, verify, consume, status, dispatch, send and template send) is read once, by name, before anything uses it.** A getter
  that answered `'verify'` to the action check and another word to the dispatch fell through to `generate` and sent an
  unrequested code, and a `deliverVia` read four times could be `'manual'` at the mailbox check and `'email'` at the
  delivery. A template send also used its raw `tags`, `to` and `auditRedactValues` before its input was read; it now
  reads first, so a list over the bound is refused before the renderer is asked.
- **An attachment carries `filename`, `content`, `contentType`, `cid` and `contentDisposition`, and nothing else.** An
  inline image is `cid` (1 to 128 printable ASCII characters, no space, quote or angle bracket) with
  `contentDisposition: 'inline'`; SMTP writes them as the `Content-ID` and the `Content-Disposition`, and Resend takes the
  `cid` as its content id and has no disposition field, so it refuses a `contentDisposition` that disagrees with the
  `cid` (inline without one, attachment with one) instead of dropping it. Any other field, enumerable or not, string or symbol (`encoding`, `headers`,
  `path`), on an attachment or a tag is refused, where a copy would drop it without a word. The kinds of
  `filename`, `contentType`, `cid` and `contentDisposition` are checked. The byte budget measures a `Buffer` or a
  `Uint8Array` through the typed array's own getter, so an own `length` or `byteLength` property cannot make it look
  empty.
- **A store that counted more attempts than the entry's ceiling, or a ceiling that is not a number, is `max_attempts`,** where the remainder was negative.
- **A failed delivery releases the cooldown and the entry, whichever step fails.** A `clearCooldown` that threw left the
  entry behind; both now run and the first failure is the one the caller sees.
- **The health indicator counts a `verify` it cannot read as present,** so the check runs and reports `down`, and the
  log copy of an error reads its `code` once.
- **The `Object.prototype` check could be blinded by a built-in replaced after the library was imported.** The check
  that makes the SMTP and Resend adapters refuse while the realm root holds a key that is not standard looked its
  built-ins up when it ran, so code that replaced one of them after the import, with a version that says the root is
  clean, made the check say so. It now calls only references taken when the library loaded, and walks with index loops.
  It also compares, by identity, the built-ins the library calls with the ones that were there when it loaded, the
  functions that a symbol names (`RegExp.prototype[Symbol.replace]`, `Map.prototype[Symbol.iterator]`,
  `Date.prototype[Symbol.toPrimitive]`) and the getters of the regular-expression flags and of `size` among them,
  and refuses while one has been replaced, so a polyfill or a patch that replaces one after the import stops the
  send with the same count-only refusal.
- **A replaced built-in no longer makes every OTP code predictable or accepts a wrong one.** The built-ins the library calls are read once, when the
  library loads, so a host, a test or a dependency that replaces one after the import (`crypto.randomInt = () => 0`, a
  `timingSafeEqual` that answers `true`, a `Buffer.from` that answers the same bytes for any text) changes nothing the
  library does. The `update` and `digest` of the objects `createHash` and `createHmac` return are read once too, and
  are in the comparison the realm check makes, so a `digest` replaced before a code is issued can no longer make a
  wrong code verify.
- **A template send, a dispatch of one and the OTP email path read `bcc`, `cc`, `attachments`, `text`, `from`,
  `fromName`, `replyTo`, `auditRedactValues` and `publishProviderText` off the realm root.** The input the template send
  hands on has no prototype and the renderer's answer is read by name, so a custom provider receives the options it was
  given, and a failure that echoes the code is still redacted and its text withheld.
- **A write made while the realm root is polluted refuses the send.** The adapter's own socket checks the root before
  it writes: a key planted after the checks that began the send, and before a byte left, destroys the connection and the
  send fails with the same count-only refusal, where it used to change the recipients or the body. It covers plain,
  implicit-TLS and STARTTLS connections: every connection is handed to Nodemailer as a stream that checks every write,
  and the TLS upgrade Nodemailer makes after STARTTLS writes its encrypted bytes through it, so `MAIL FROM`, `RCPT TO`
  and the body cannot leave while the root is polluted. Nodemailer is handed each recipient and each body part as an object with its own keys, and a
  failure of a send while the root is polluted is reported as that refusal.
- **A runtime without `__proto__` is a standard one, and a frozen root is not pollution.** `node --disable-proto=delete`
  no longer makes every adapter refuse, and `Object.freeze(Object.prototype)` after the import, or a standard key that
  only became read-only with the same value, is hardening and not a change; a changed value or enumerability still
  refuses.
- **The text bound of the address masker joins a quoted-printable soft break and a folded line before it looks for an
  address**, so `bo=` and a line break before `b@x.com`, or a quoted local part folded onto the next line, is one address
  and is masked whole. Blanks before a soft break, the white space that indents a fold and a bare carriage return as the
  line break are all read as part of the join. The join is made on the text that is returned, so ordinary text with a
  line break followed by blanks, or an equals sign, blanks and a line break, comes out joined too (`Hello\n  world`
  reads `Helloworld`, `total =\n 5` reads `total  5`).
- **`generate` and `verify` of the OTP service make the realm check the adapters make.** While `Object.prototype` holds a
  key that is not standard, or a built-in the check compares was replaced since the library loaded, they refuse with the
  same count-only `INVALID_SCOPE_IDENTIFIER`, when they start and again after the store call whose answer decides the
  next step (the cooldown, the attempt count, the consumption of the code), and a refusal after the cooldown was taken gives it back. A `Set.prototype.has` that answers `true` no longer registers a purpose,
  and a `Map.prototype.has` that answers `false` no longer lifts a lock. The
  refusal now ends "so the operation is refused" in place of "so nothing is sent". A host that patches a built-in late
  could already not send; it now cannot generate or verify either.
- **The refusal and every exception of the library are built from their own fields.** A `status`, a `message` or a body
  field planted on the realm root answers for none of them. A connection error of the adapter's own socket now carries
  Node's native code (`ECONNREFUSED`, `ETIMEDOUT`, ...) where Nodemailer used to wrap it as `ESOCKET`, and a certificate
  that is not trusted after STARTTLS reports the certificate's reason.
- **Stated limits.** A function planted under `pipe` ends the process inside Nodemailer's streams, and freezing
  `Object.prototype` at startup is the defence. Recipients that are not a bare mailbox (`Bob <bob@x.com>`) go to Nodemailer as the strings they were.
  Address masking leaves out the base64 of a whole address and the spelled-out forms (`bob at x`, `[at]`), and a quoted
  local part of more than 300 units is read as ordinary characters up to a space.
- **A name planted on `Object.prototype` no longer reaches the descriptors the library defines.** The copy of an
  error cause, the scrubbed copy of an error chain and the wrapped operations of a store were defined with a descriptor
  object that inherits from the realm root, so a planted `enumerable` made the copied `name` and `cause` enumerable and a
  planted `get` or `set` made the definition throw. Each descriptor has no prototype now.

### Documentation

- The README lists the answers the library requires of a store, the kinds of the boolean options and of the `send()`
  lists, the refusal of an unknown `action` and `deliverVia`, and the new server budget row.

#### Apply to a derived backend

The declaration changes against 1.4.22 are three. The parameter of `OtpService.generate()`, `consume()` and `getStatus()` is named `raw` where it was `input`: its type is the same, and a caller passes it by position, so nothing changes for a caller. `EmailAttachment` gains `cid?: string` and `contentDisposition?: 'attachment' | 'inline'`: both are new and optional, so an attachment written for 1.4.22 compiles and sends unchanged, and a consumer needs nothing from them. Private members were added, removed or renamed: they are not part of the contract, and no public or protected member was removed or changed in type. A configuration that was accepted before now fails when the module is built: a boolean option
given as a string, a `maskRecipient` that is not a function, a `perPurpose` of `null`. A custom `IOtpStorage` that
answered `tryAcquireCooldown`, `deleteIfCode` or `isConfigured` with something other than a boolean, `recordFailure`
with something other than an integer of at least `1`, or `consumeAttempt` with an unknown status or an entry of the
wrong kinds, now ends the call in `OTP_STORAGE_FAILED` (or `OTP_STORAGE_NOT_CONFIGURED` for `isConfigured()`); the
bundled stores answer correctly. A caller of `send()` that passed a list over 1000 entries, an attachment with a
non-text, non-binary `content` or with a field other than `filename`, `content`, `contentType`, `cid` and `contentDisposition`, or a string for a boolean now gets a refusal (`EMAIL_INVALID_RECIPIENT` for the
recipient fields, `INVALID_SCOPE_IDENTIFIER` for the rest). A dispatch with an unknown `action` or `deliverVia` now
raises `INVALID_SCOPE_IDENTIFIER` instead of sending or storing a code, and so does a `verify()` whose `code` is not a string, and a send, or building an adapter, in a process whose `Object.prototype` holds a non-standard key. A
provider of your own that read a key from the options object it is given, or an option from `Object.prototype`, finds
the object has no prototype: read the keys by name, as before, and do not call methods of `Object.prototype` on it.

## [1.4.22] - 2026-11-21

### Added

- **`OTP_STORAGE_FAILED` (`notification.otp_storage_failed`, 500).** A method of the OTP store that throws,
  rejects or cannot be read, and is not an outage, is answered with this code and no longer reaches the caller as the
  store's own object. An outage keeps `OTP_STORAGE_UNAVAILABLE` (503). The store's error is the `cause`, a log-safe
  copy, and its text is not in the message or the body. A method whose getter throws counts as present, so the call
  fails with the code each time, and a store whose `isConfigured()` throws is answered with `OTP_STORAGE_NOT_CONFIGURED`, its error the
  cause.

### Fixed

- **A send whose renderer rejected with a revoked or trapped proxy is reported.** The class check that sorts a send into
  `rejected` or `failed` ran unguarded, so the proxy's own error escaped and the send metric was not reported. The check
  now counts as "no" when it cannot run, and the send is reported as `failed`.
- **A provider whose `isConfigured()` throws is refused with `EMAIL_PROVIDER_NOT_CONFIGURED`.** The host's error was
  raised from `send()` and from start-up; it is now the cause of the refusal, which still fails start-up, and the health
  indicator reports `down` and says nothing of it.
- **The provider name is read once per failed send,** so a getter cannot answer the audit entry and the
  `EMAIL_SEND_FAILED` details differently.
- **The audit repository's `name`, a log copy's `name` and the storage name in the `OTP_FAILURES_NOT_CARRIED` line are
  read once and under a guard.** A getter that throws no longer fails the module's build for the repository, and the
  line no longer depends on which object it was handed.
- **The audit entry of a failed OTP delivery keeps the store's text.** It reads the store's own error, which is the
  cause of the answer, and not the answer's generic message.

### Documentation

- The README catalog lists `OTP_STORAGE_FAILED`; its status paragraph says a store failure that is not an outage
  answers with it, and the section on names says the options, `global.defaultLocale` among them, are read once while
  the module is built, so a getter that throws there fails the build with the host's own error.
- 1.4.21 said a storage failure reaches the caller as the object the store threw; from this release it is the cause of
  `OTP_STORAGE_FAILED`.
- The README's bundle budget row follows the new server and observability budgets.

#### Apply to a derived backend

`NOTIFICATION_ERROR_CODES` and `NOTIFICATION_ERROR_DEFINITIONS` gain `OTP_STORAGE_FAILED`; nothing else in a declaration
changes. A caller that catches what `generate()`, `verify()` or `consumeAttempt` throws and compared it with the error
its own store raised now receives a `NotificationException` with `code: 'notification.otp_storage_failed'`; read
`error.cause` for what the store threw, and map the code to the response you want (the default is 500). A store whose
failures are outages is unaffected, and so is one that throws the library's own errors. An email provider
or store whose `isConfigured()` throws now ends an accessor and start-up (and, for the provider, a send) in
`EMAIL_PROVIDER_NOT_CONFIGURED` or `OTP_STORAGE_NOT_CONFIGURED`, its error the cause.

## [1.4.21] - 2026-11-20

### Fixed

- **A class check on a value the host threw can no longer replace the library's own error.** Three checks ran
  `instanceof` on a failure supplied by host code outside a guard, and a hostile or revoked proxy throws from that
  check: the SMTP provider's transport-build failure (the host may supply its own transport), the OTP storage
  outage translation, and the tracing adapter's span status. The check now counts as "no" when it cannot run. The
  SMTP provider returns an `Error` carrying the scrubbed text, the storage failure reaches the caller as the object
  the store threw, and the span is ended and marked `unknown` while the operation's failure is rethrown unchanged.

- **A name read from the host is read under a guard, and it is cut and escaped wherever it is data.** A storage
  `name`, an email provider `name` or a class name whose getter throws no longer replaces the library's error or
  line with the host's: the name reads as `[unreadable]`, as does a value that is not a string. The storage name
  is read once, when the store is wrapped, and the same bounded text fills `providerName` in the audit entry and in
  the `OTP_STORAGE_UNAVAILABLE` details, which carried it raw and uncut. The email provider's `name` fills
  `providerName` of the audit entry and of the `EMAIL_SEND_FAILED` details the same way.

### Documentation

- The README names `[unreadable]` and states that the 200 is counted in code points of the name before escaping,
  so an escaped character counts once.
- The README's Traces section states that the failure is rethrown unchanged, with the span status `unknown` for an
  object whose class cannot be read.
- The README's bundle budget row moves from `40.26 KB` to `40.27 KB`, the server budget.

#### Apply to a derived backend

No declaration changes and no option changes. A host that never throws a proxy sees no difference.

## [1.4.20] - 2026-11-20

### Fixed

- **A name from the host no longer reaches a log line or an error unbounded and unescaped.** The storage's `name`
  (in the `consumeOnVerify` refusal and in the `OTP_FAILURES_NOT_CARRIED` line), `global.defaultLocale` (in the
  `OTP_TEMPLATE_NOT_RESOLVED` line) and the class name `forRootAsync` refuses to construct are cut at 200
  characters, marked with `…`, and have every control, format, line-separator and paragraph-separator
  character, and each lone surrogate, written as a visible `\uXXXX` sequence (`\u{XXXXX}` past U+FFFF). A name with a line feed could start a
  second log record; one with a bidi override could reorder the text.

### Documentation

- The README states how a configured name is written into a line, and its bundle budget row moves from `40.12 KB` to
  `40.26 KB` for the helper.

#### Apply to a derived backend

No declaration changes and no option changes. A host whose storage `name` or `global.defaultLocale` is an ordinary
short word sees no change in any line or error. A name longer than 200 characters or with an invisible character
is now written cut or escaped.

## [1.4.19] - 2026-11-20

### Fixed

- **A host logger that throws no longer fails the operation that logged.** Every library log line goes through one
  helper, and the helper now catches a synchronous throw of the host's logger, so a send, a verification, an
  audit-swallow warning or the module's start is not turned into an error by a broken log sink. The line is lost.
- **The entry puts `event` and `message` last.** The keys of a line that carries an error are now `err`, `event`,
  `message` (they were `event`, `message`, `err`). A line without an error is unchanged.

### Documentation

- The README's bundle budget row moves from `40.07 KB` to `40.12 KB` for the helper's `try`/`catch`.
- The README states the limit: Nest's `Logger` discards what the host logger returns, so a logger method that is
  `async` and rejects cannot be caught by the library. The rejection is unhandled and ends the Node process unless
  the application handles `unhandledRejection`. Keep the logger methods synchronous, or catch inside them.

#### Apply to a derived backend

No declaration changes and no option changes. A host that reads the keys of a log entry by position sees `err`
first; a host that reads them by name is unaffected. A host logger that threw used to surface the throw to the
caller of the operation; it no longer does.

## [1.4.18] - 2026-11-20

### Documentation

- The README says `IOtpStorage.clearCooldown` is also called after a successful `verify()` when
  `consumeOnVerify` is set, not only on a delivery failure and on `consume()`.
- The README states what the withheld SMTP line can still publish. A number that stands alone in the relay text,
  such as `port 587` or `tenant=250`, is read as a reply code when it is the only such token, because the grammar
  cannot tell it from one. Since 1.4.17 a real reply code beside a number glued to a word (`550 5.1.1 ... TEN456`)
  is recovered, so `deliveryStatus` and `details.status` appear where 1.4.16 gave only the enhanced code.
- The bundle budget row of the README moved from `40.03 KB` to `40.07 KB` in 1.4.17; this release records it.

#### Apply to a derived backend

No declaration changes, no option changes and no runtime change. `dist/` is identical to the 1.4.17 tarball.

## [1.4.17] - 2026-11-20

### Fixed

- **A word of the relay's error text no longer leaks a status code into the withheld SMTP line.** With
  `publishProviderText: false` the line reads the reply codes out of the relay's error text. Three digits that
  ended an identifier, such as the `456` of `tenant=TEN456`, were read as a reply code and written to the log
  line and the thrown error's `deliveryStatus`. A code now has to stand alone, not at the end or start of a
  word, so such text yields `[SMTP_SEND_FAILED] no reply code`. A real reply (`550 5.1.1 ...`, `550-5.1.1 ...`)
  is read as before.

### Documentation

- The README names the three required members it left out: `IOtpStorage.getCooldown` and `clearCooldown`, and
  `IEmailTemplateRenderer.hasTemplate`.
- The README states that a send which fails before the provider with an error that is not the library's own
  (a `TypeError` from `to: null`) counts as `failed`, and that `rejected` is only the library's own refusal.

#### Apply to a derived backend

No declaration changes and no option changes. The only runtime change is the stricter reply-code reading above;
a host that parses `deliveryStatus` from a relay whose reply code sits against a letter or digit (`x550`) now
sees no code instead of one.
Against the 1.4.16 tarball, `dist/` differs in the two reply-code patterns of the server entry (ESM and CJS) and nowhere else.

## [1.4.16] - 2026-11-18

### Added

- **Metrics, spans and a readiness check, in a new optional subpath.**
  `@bymax-one/nest-notification/observability` publishes `bymax_notification_messages_total`
  (`channel`, `outcome` of `sent`, `failed` or `rejected`), `bymax_notification_send_duration_seconds`
  (`channel`) and `bymax_notification_otp_total` (`event` of `issued`, `verified`, `failed` or `locked`)
  on the registry `@bymax-one/nest-core` serves; the spans `notification.send` and
  `notification.otp.verify`; and `NotificationHealthIndicator`, which reports `up` or `down` for the email
  channel and never sends a message. Register it with `NotificationObservabilityModule.register()`. It needs
  the optional peers `@bymax-one/nest-core`, `prom-client` and `@opentelemetry/api`; the main entry imports
  none of them, and without the module the services record nothing.
- **`SmtpEmailProvider.verify()`.** Connects, reads the greeting, upgrades to TLS and logs in, and sends
  nothing; a failure is answered in fixed words that carry nothing of the relay's text.
- **`INotificationObserver` and `BYMAX_NOTIFICATION_OBSERVER`.** The contract the services report to, and its
  token, for a host that wants its own metrics or tracing instead of the subpath's.

### Changed

- **Every operational log line carries an `event`.** The eleven lines the library writes (the module bootstrap,
  the plaintext-code, redis-namespace and unusable-channel warnings, the OTP storage and template warnings, the audit write
  failure, and the Resend, SMTP and no-op provider lines) are now written as `{ event, message }`, where
  `event` is one of the `NOTIFICATION_*` names in the README's "Log events" table and `message` is the
  library's own text, bracketed tag included. The three lines that report an error of a provider or of your
  template renderer (`NOTIFICATION_RESEND_SEND_FAILED`, `NOTIFICATION_SMTP_SEND_FAILED` and
  `NOTIFICATION_OTP_TEMPLATE_NOT_RESOLVED`) no longer put that error's text in `message`: it travels as an
  `Error` in the `err` field, escaped, and for Resend and SMTP scrubbed like the error your call gets, so an
  address a relay echoes is not part of a message. A spec holds every event to this with a sentinel.
- **The README names every export.** Each type, option shape and constant of the five entry points is in the
  README with its defaults, ranges and failure modes, and a spec fails when an export is not named there.
  It also corrects the statements the reference check found false: `global.redisNamespace` is resolved but
  not read by the bundled storages (`RedisOtpStorage` takes its own `namespace`), and the error-code count.

- **`global.redisNamespace` is deprecated and logs one startup warning.** The option was resolved and read by
  nothing: `RedisOtpStorage` is built by the host and takes its own `namespace`, so a host that set only the
  global one wrote under the default prefix and two apps sharing a Redis could collide. Setting it now logs
  `NOTIFICATION_REDIS_NAMESPACE_UNUSED` once per registration, with constant text and no value, whether or not
  it differs from the default. It is removed in v2.0.

### Fixed

- **The `tls` values are checked when the provider is built.** `rejectUnauthorized` must be a
  boolean; `servername`, `ciphers` and `passphrase` strings; `minVersion` and `maxVersion` one of
  `TLSv1`, `TLSv1.1`, `TLSv1.2` or `TLSv1.3`; `ca` and `cert` a string, a Buffer or an array of them;
  `key` and `pfx` the same, or an array that also holds Node's object carrying a passphrase
  (`{ pem, passphrase }` for a key, `{ buf, passphrase }` for a bundle; Node takes the object only
  inside an array, so a bare one is refused here and not at the first send); and `checkServerIdentity` a function. A value of the wrong type fails the build naming
  the key and the type, and never the value, so the transport's own error, which can quote what it was
  given, is not the one that reports it. In 1.4.15 a number as the `passphrase`, a `minVersion` of
  `TLSv1.4` and a string as `rejectUnauthorized` were accepted and reached the transport.
- **The `tls` passphrase is scrubbed from a transport error.** A transport error that quotes the
  options carried the passphrase, and one carried by a `key` or `pfx` entry, into the thrown message
  and the log line, as it did the user and the password before; they are now replaced like them. Measured with a stand-in transport that quotes its
  options: 1.4.15 threw a message holding the passphrase, and this release writes `[redacted]` in its place.

#### Apply to a derived backend

The declarations gain `INotificationObserver`, its event types (`NotificationSendEvent`,
`NotificationOtpEvent`, `NotificationSpanAttributes` and the name unions), `BYMAX_NOTIFICATION_OBSERVER`
and `SmtpEmailProvider.verify()`, and the package gains the `./observability` subpath with its own
declarations; the constructors of `EmailService` and `OtpService` take an optional last parameter, the
observer, which only matters if you build them by hand.
Nodemailer copies a message, its transport options, the credentials and the TLS options into ordinary objects
before it reads names this library never sets, so the SMTP adapter gives it an own key, set to your value or to
`undefined`, for every name it reads (a planted `envelope` sent the one-time code to another recipient while the
headers still named yours), and the Resend payload the same for the fields its SDK reads after spreading it. The lists
for a message, the transport options and the credentials come from the sources of the Nodemailer the
tests install, and a spec reads those sources and fails when a name is missing; the TLS list names what `tls.connect` reads.
Nodemailer's own internals read names from objects they create themselves, which no key this library hands over can shadow, so the SMTP and Resend adapters refuse while `Object.prototype` holds any string key outside the runtime's standard set, or a standard key that was overwritten, redefined or removed since the library loaded (`INVALID_SCOPE_IDENTIFIER`): when the adapter is built, when a send or the SMTP `verify()` starts, and again immediately before the transport's `sendMail` or `verify` or the SDK's `emails.send`, so a name planted after boot is refused before any I/O. The error reports a count of keys and never a key or a value. It is an allowlist and not a list of names, so a name a later Nodemailer reads is refused without a release. A host that extends `Object.prototype` cannot send through the library. The check cannot close a timing window, so the reads are closed too: the SMTP adapter opens the connection itself, from its own configuration, with options that have no prototype, and hands Nodemailer the open socket; it sets `disableFileAccess` and `disableUrlAccess`, since the adapter sends `content` only, so a `path`, `localAddress` or `href` planted by a concurrent request after a send has started neither moves the connection nor reads a file. The table of listeners of the socket the adapter opens has no prototype, so a string planted under any event name no longer throws in Node's emitter; the sockets and streams Nodemailer builds itself (the STARTTLS upgrade, a message) are its own, and a string planted under `pause` or `resume` after the check can still throw there. A standard key that was not what it must be at load (a native function that is not a Proxy, with its own name; `__proto__` an accessor of native functions) counts on every use. A `tls` key that reads as `undefined` is read as not set. An `IEmailProvider` of your own needs no change.
A log line is now an object where it was a string: with `@bymax-one/nest-logger` 1.4.23 or later `event` and
`message` are fields of the entry, so match on `event`; with the default Nest logger the line prints as the
object, and a custom logger that read the first argument as a string must read `message`. A match on the
provider's or renderer's own error text in the Resend, SMTP or OTP template-check lines must read `err.message`. The package still
ships no dependencies, and the three new peers are optional. `GlobalOptions.redisNamespace` is marked
`@deprecated`: it never reached `RedisOtpStorage`, so pass `namespace` to that constructor; the option is
removed in v2.0.

The declaration `SmtpTlsOptions.ca` widens from `string | string[]` to
`string | Buffer | ReadonlyArray<string | Buffer>`, the form Node takes and `cert`, `key` and `pfx`
already had, and the arrays of `key` and `pfx` also take Node's object entries; the entry types
`SmtpTlsKeyEntry` and `SmtpTlsPfxEntry` are exported; nothing else in the declarations changes. A `tls` value of the wrong type, which 1.4.15
handed to the transport, now fails when the provider is built, naming the key: fix the value.

## [1.4.15] - 2026-11-17

### Fixed

- **Options that are objects are read once, key by key, all the way down.** In 1.4.14 the SMTP
  `credentials` and `tls` stayed references to your objects: a getter on `credentials.user` was read
  at construction and again each time the provider looked at it. Each declared key of `credentials`
  and `tls` is now read once, when the provider is built, so a class with getters on its prototype
  works and a getter that answers differently later changes nothing. A key that reads as `undefined`
  or `null` is left out. `email.defaultTags` is copied the same way, tag by tag.
- **A `tls` setting is forwarded or refused, never dropped.** `tls` takes `rejectUnauthorized`,
  `servername`, `ca`, `minVersion`, `maxVersion`, `ciphers`, `checkServerIdentity`, `cert`, `key`,
  `passphrase` and `pfx`, and passes them to the transport as given; any other key fails the build
  naming it, and a symbol key is refused without its description. A setting dropped without a word would
  leave the connection weaker than the host asked for: with a `minVersion` of `TLSv1.3`
  against a relay that speaks only TLS 1.2, the send fails the handshake, as it does on 1.4.14.
- **A `null` is refused for `audit`, `credentials`, `secure` and `requireTls`.** In 1.4.14 each was
  read as omitted. Leaving out `audit` means no audit trail and leaving out `credentials` means a
  session without a login, so a `null` from a config lookup that found nothing started the module or
  the provider with that protection off; they now fail at startup naming the option, like the six
  options listed in the 1.4.14 note. `secure` and `requireTls` are refused because a `null` is not a
  valid value for them: left out, they are derived from the port and the host. An `undefined` is
  still read as omitted for all four.
- **Values of the wrong type are refused naming the option.** `options.global`, when set, must be an object (a `null` is read as not set); a
  `perPurpose` container that is a `Map`, a `Set`, a `Date` or another built-in is refused as such
  (a `Map` was refused as `perPurpose.size must be an object, got 1`, and a `Date` was accepted); the
  `codeType` of a `perPurpose` entry must be one of the supported types, where any value was accepted;
  and the constructors of `SmtpEmailProvider` and `ResendEmailProvider` refuse options that are not an
  object, where `null` raised a `TypeError` and a string or an array was accepted.
- **The `OTP_INVALID_LENGTH` error carries the option in its message.** `error.message` was the class
  name, so a log line that printed only the message did not say which option was wrong; the response
  already had the text, and the message now has it too.

#### Apply to a derived backend

The declaration `SmtpTlsOptions` gains the optional keys `minVersion`, `maxVersion`, `ciphers`,
`checkServerIdentity`, `cert`, `key`, `passphrase` and `pfx`, which the provider already forwarded
when a JavaScript caller set them; nothing else in the declarations changes. These now fail at startup, naming the option: `audit: null`; an `options.global`
that is not an object; a `perPurpose` container that is a built-in such as a `Map` or a `Date`; a
`perPurpose` entry `codeType` that is not `numeric`, `alpha` or `alphanumeric`; and, when the SMTP
provider is built, a `null` `secure`, `requireTls` or `credentials`. `SmtpEmailProvider` and
`ResendEmailProvider` refuse options that are not an object with `options must be an object`. A `null`
or `undefined` key of `tls` is left out, where it was handed to Nodemailer (`credentials` was never
handed on key by key: only `user` and `pass` reach it). A `tls` key outside `rejectUnauthorized`,
`servername`, `ca`, `minVersion`, `maxVersion`, `ciphers`, `checkServerIdentity`, `cert`, `key`,
`passphrase` and `pfx` fails when the provider is built, naming the key (a symbol key is refused
without its description), where 1.4.14 passed it on to the transport: a `secureProtocol` or
`secureOptions` that you set must be removed, or the key requested. Changing your
`credentials` or `tls` object after the provider is built, or your `email.defaultTags` array or one
of its tags after the module is built, no longer reaches it. A log or
a handler that read `error.message` of an `OTP_INVALID_LENGTH` error now sees the text of the option
that was wrong, in place of `Notification Exception`. The checks of `audit` and `global` run before
the channel checks, and that of `global.tenantIdResolver` before those of `email` and `otp`, so when
several options are wrong the first message you see can be a different one.

## [1.4.14] - 2026-11-17

### Fixed

- **A numeric option the library cannot act on is refused at startup, not honoured as `NaN`.**
  `otp.defaultMaxAttempts` of `NaN` passed the check and then never locked, so the brute-force bound
  was off; a `resendCooldownSeconds` of `NaN` never held a cooldown; a `defaultTtlSeconds` of `NaN`
  never expired a code; a `maxAttachmentBytes` of `NaN` removed the attachment guard. The attempts
  bound must now be an integer of at least `1`, the TTL a finite number above `0`, the cooldown and
  `maxAttachmentBytes` finite numbers of at least `0`, in the defaults and in every `perPurpose`
  entry. The message names the option and what it received: a number is shown, and a string or an
  object is named by kind (`a string`, `an object`) and never printed, because it may be a credential
  put in the wrong option.
- **`perPurpose` and the SMTP `port` are checked too.** A `perPurpose` `length` outside `1` to `32`
  was not checked in an entry (only `otp.defaultLength` was) and is now refused naming the option;
  the `perPurpose` container, when set, and each entry in it must be an object, so an array, a string
  and a number fail naming `otp.perPurpose`, and a `null` or `undefined` entry fails naming
  `otp.perPurpose.<purpose>`, where they passed silently or as a purpose called `0` (a `null` container
  is read as not set); and
  the SMTP `port` must be an integer from `1` to `65535`, where `NaN`, `0`, `70000` and `'587'` were
  accepted.
- **What is checked is what is kept.** The module copies the options once and validates and builds
  from the copy, and both providers copy theirs before checking them, so a getter that answered with a
  valid value and then an invalid one no longer got the invalid one into the service. The copy reads
  each declared option by property access, so a class that supplies its options from getters on the
  prototype keeps its values, and a `perPurpose` container that is a class with a getter for each
  purpose is read too; an option the library does not declare is not copied. `credentials` and `tls`
  stay references to your objects.
- **An unset `perPurpose` value no longer removes or breaks the attempts bound, the TTL or the cooldown.**
  Measured with the in-memory storage on 1.4.13, an entry with `maxAttempts: undefined` had no
  attempts bound (after eight wrong codes the right one still verified), `maxAttempts: null` made every
  verify fail with `max_attempts`, `ttlSeconds: undefined` left the code without an expiry (an
  `expiresAt` of `NaN`; a storage that derives a TTL from it was not measured), `ttlSeconds: null`
  expired the code at the moment of issue, and an unset `resendCooldownSeconds` removed the cooldown.
  An option that reads as `undefined` or `null` now takes its default, for every top-level option of
  the module and of both providers and for each option of a `perPurpose` entry; a `perPurpose` entry
  that is itself `null` or `undefined` is refused. Nested provider objects (`pool`, `tls`,
  `credentials`) are taken as given: a `null` `pool.maxConnections` or `pool.maxMessages` is refused
  and a `null` `tls.rejectUnauthorized` reaches Nodemailer. The exception to the default is the
  options whose default is the weaker security posture, listed in the note below, where a `null` is
  refused.
- **A count past the largest safe integer is refused.** `otp.defaultMaxAttempts`, each `perPurpose`
  `maxAttempts`, `email.maxRecipients` and the SMTP `pool` limits `maxConnections` and `maxMessages`
  accepted `2 ** 53`, `1e21` and `Number.MAX_VALUE`, which bound nothing. Each must now be an integer
  from `1` to `9007199254740991`.
- **Every SMTP timeout is checked when the provider is built.** `connectionTimeout`,
  `greetingTimeout` and `socketTimeout` were handed to Nodemailer unchecked: a `connectionTimeout`
  past `2147483647` made a send fail when the relay did not answer within about a millisecond, because
  the timer fired at once, a negative or fractional `greetingTimeout` failed a send against a relay
  that stalled, within a few milliseconds, and `NaN` or `0` left a phase unbounded. They now take the
  same integer from `1` to `2147483647` as `sendTimeoutMs`.
- **A provider of your own gets the `503` for a transient reply too.** `EmailService` read the
  reply number of an SMTP `4xx` only from the built-in providers' errors, so a provider that threw
  Nodemailer's error answered `502`. The service now reads a `responseCode` from `400` to `499` on
  the error or one of its causes. The rule is not specific to SMTP: a provider of your own that wraps
  an HTTP client and sets `responseCode` to `401`, `403`, `404` or `422` now answers `503`, where it
  answered `502`.

#### Apply to a derived backend

No declaration changes. An option that reads as `null` is now read as not set and takes its default,
as `undefined` does, in the module options and in the options of both providers. The exception is the options whose default is the weaker security
posture, `global.tenantIdResolver`, `otp.codeSecret`, `otp.strictPurposes`, `otp.consumeOnVerify`,
`audit.swallowErrors` and `audit.maskRecipient`: a `null` there is refused at startup, so a missing
secret, flag or resolver from a config lookup cannot start the module unkeyed, non-strict, unmasked,
with errors swallowed or trusting the tenant in the payload. A `tenantIdResolver` that is not a
function is refused too, and its check runs before the email and `otp` checks. Options that are not an object
(`undefined`, `null`, a string, an array) fail with `options must be an object`, where they failed with a `TypeError`. These now fail at startup,
naming the option: a numeric option that is `NaN`,
`Infinity`, a string, or a fraction where an integer is needed; a count past `9007199254740991`; a
`perPurpose` `length` outside `1` to `32`, which was not checked; a `perPurpose` container that is not an
object (an array, a string, a number) and an entry that is not an object (`null`, `undefined`, an array, a
string, a number); and, when the provider is built, an SMTP
`port` that is `NaN`, `0`, past `65535`, a fraction or a string such as `'587'`, or a timeout that is
out of range or not a number. Fix the value. The numeric checks of the `otp` defaults run before those of `codeSecret` and
`defaultCodeType`, and those of `perPurpose` after them, so when several options are wrong the first
message you see can be a different one. The module and both providers read the options once, by property access, into
a copy, so a class that supplies its options from getters works as a plain object does, and 1.4.13
kept no copy: changing your options object afterwards no longer reaches them, so a host that blanked `host` or `apiKey` on the object to reconfigure a provider (its
`isConfigured()` flipped) must build a new one. A provider of your own whose
error carries `responseCode` `401`, `403`, `404` or `422` now answers `503`; set the code you mean if
that is not what you want.

## [1.4.13] - 2026-11-17

### Fixed

- **An html or text part that is not a string is refused, not sent.** `EmailService.send`,
  `SmtpEmailProvider.send` and `ResendEmailProvider.send` read a Buffer, a typed array or an object
  (which Nodemailer treats as a content descriptor, a file `path` included) as content and sent it, and the removal of a body echoed in an error compares strings only, so a relay
  that quoted such a part back was not scrubbed. These now fail with `EMAIL_MISSING_BODY` (400),
  `details` naming the part (`html` or `text`) and `reason: 'not_a_string'`, before anything is audited
  or sent. An absent part (`undefined` or `null`) is accepted as before, so a text-only message still
  sends. A host that passed a Buffer as a part must pass a string.
- **`pool` refuses any sequence.** `SmtpEmailProvider` took a typed array, a Buffer, an
  `ArrayBuffer` or an object with a numeric `length` for the `pool` object and behaved as if `{}` had
  been given; it now fails with `pool must be an object`, as an array already did.

- **`EMAIL_SEND_FAILED` keeps its `503` when `auditRedactValues` is set.** With a value to remove
  from the error, the removal strips the error's own properties in place, the code among them, and
  the status was read afterwards: an outage, an SMTP `4xx` reply or a Resend `429` answered `502`.
  `EmailService` now reads the status from the failure as the provider raised it, before anything
  is removed from it.
- **A `pool` that throws when it is read is refused like any other value that is not an object.**
  A getter, a `Proxy` or a revoked `Proxy` given as the `pool` option failed with its own error; it
  now fails with `pool must be an object`. The limits are read once, when the provider is built, so
  a getter that answers differently later cannot change the transport.

### Changed

- **A relay or API that says "try later" is answered with `503`, not `502`.** `EMAIL_SEND_FAILED`
  already answered `503` when the provider could not be reached or timed out. It now also does when
  `SmtpEmailProvider` meets a `4xx` reply from the relay at any stage of the dialogue (a `421`, a
  `450`, a `451`, a `452`) and when `ResendEmailProvider` meets an HTTP `429`. An SMTP `5xx` reply
  and any other rejection are refused sends and keep `502`. The error code and body are unchanged, so a host
  that branches on `code` is unaffected; one that branches on the status now sees `503` for these.

#### Apply to a derived backend

No declaration changes. Two behaviours do. A send whose `html` or `text` is not a string, a Buffer or a
content descriptor that Nodemailer would have sent, now fails with `EMAIL_MISSING_BODY` (400): pass a
string. A host that branches on the HTTP status of `EMAIL_SEND_FAILED` sees `503`, not `502`, for an
SMTP `4xx` reply and a Resend `429`; a host that branches on `code` is unaffected.

## [1.4.12] - 2026-11-17

### Fixed

- **A send with no `html` part fails with its own error, not a `TypeError`.** When the transport or
  the API rejected such a send, the code that removes secrets and echoed content from the error read
  the missing part and threw a `TypeError` instead of the `SMTP send failed` or `Resend send failed`
  error. `SmtpEmailProvider`, `ResendEmailProvider` and `EmailService` now treat a missing part as
  nothing to echo against, and the declared values, the credentials and an echo of the text part are
  removed as before. Only a caller that bypasses the `html: string` type reached it.
- **`pool: []` is refused.** `SmtpEmailProvider` took an empty array for the `pool` object and
  behaved as if `{}` had been given; it now fails with the same `pool must be an object` as any
  other value that is not one.

## [1.4.11] - 2026-11-17

### Added

- **`SmtpEmailProvider` can pool its connections, and closes with the application.** The new
  option `pool` (`maxConnections` and `maxMessages`, each optional) turns Nodemailer's pooled mode
  on, a limit left out keeping Nodemailer's default; without it the transport is configured as
  before. The provider gains `close()`, which closes the transport it built (a send in flight on a
  pooled transport finishes, one waiting for a connection fails, and a later `send()` builds a new
  transport), and implements `onModuleDestroy`, so Nest closes it when the application closes. A
  close that throws is logged as `[SMTP_CLOSE_FAILED]` with no text from the relay and is not
  rethrown.

- **`otp.strictPurposes` refuses a purpose that nobody registered.** The limits of a recipient are
  kept per `(tenant, recipient, purpose)` and a purpose with no `perPurpose` entry uses the
  defaults, so a host that lets a caller choose the purpose lets the caller ask for a fresh
  cooldown and attempt counter each time. With `strictPurposes: true`, `OtpService` refuses at every
  operation, before any storage call, a purpose that is neither in
  `NOTIFICATION_PURPOSES` nor a key of `perPurpose`, with `notification.invalid_scope_identifier`
  (400) and the reason `not a registered purpose`, never the value. The option is a boolean
  checked when the module starts and is off by default.

### Documentation

- The README states how deep the audit metadata is kept, and a spec holds the number to the code.
- The README has a Production section: a bounded `ioredis` client and who closes it, the send
  timeouts, the shutdown, and storing codes as digests.

#### Apply to a derived backend

`OtpChannelOptions` gains the optional `strictPurposes`, off by default, so a backend that does
not set it needs no change; one that sets it registers each purpose it uses that is not one of
the canonical purposes as a key of `perPurpose` (an empty object keeps the defaults).

`SmtpEmailProviderOptions` gains the optional `pool`, the exported `SmtpPoolOptions` type is new,
and `SmtpEmailProvider` gains `close()` and `onModuleDestroy()`. A backend that builds the
provider without `pool` needs no change; one that sets it should let Nest close the application,
or call `close()` itself.

## [1.4.10] - 2026-11-16

### Fixed

- **A control character in a value no longer starts a second audit record.** An audit entry carries
  values a caller chose: a recipient, a user id, an error text, an email template name. The
  interceptor, `OtpService` and `EmailService` wrote them as they came, so a line feed in one of
  them started a record nobody wrote in any log or store that writes lines, and a bidirectional
  control could make a line read as another. The entry is now escaped once, where every writer's
  entry passes: every string of it, and every key and string value of its `metadata`, reaches
  `INotificationLogRepository.create` with the C0 and C1 controls, the Unicode line and paragraph
  separators and the bidirectional controls written as visible sequences (`\n`, `\r`, `\t`,
  `\uXXXX`); a key that escapes to the text of an earlier key takes a `#2`, `#3` suffix. Metadata that is nested too deep, a cycle and a value that is not a plain
  object, an array or a primitive arrive as a fixed marker. The `BYMAX_NOTIFICATION_LOG_REPOSITORY`
  token still resolves to the host's own repository.

- **A purpose is a short name, and anything else is refused.** `purpose` is part of every storage
  key, of the audit entry and of the template data, and nothing checked it: it could be empty,
  carry a newline that forges a log record, carry glob characters that make a key pattern
  unreliable, or be as long as the caller liked. A purpose is now 1 to 64 characters from
  `A-Z a-z 0-9 : _ -`, checked by every OTP operation and by both reference storages before a key
  is built. The refusal is `notification.invalid_scope_identifier` (400), names the boundary and
  the parameter and never the value. A `perPurpose` key outside that set stops the module at
  startup. The audit interceptor, which sees the payload before the service refuses it, leaves a
  purpose that is not a plain name out of the entry it writes. The README now says what the limits
  are scoped on and that purposes are the host's own.

- **One recipient, one key, whatever the spelling of its domain.** Two spellings of one mailbox's
  domain reached two keys, so each had its own resend cooldown and attempt counter. The domain of an
  email is now given the spelling a resolver gives it (UTS #46 mapping, non-transitional): fullwidth
  and ligature forms and the punycode form of an internationalized domain are one key, and a domain
  the mapping would change in any other way (an address literal, a host read as an address, text
  with URL syntax in it) keeps its own spelling, lower-cased. The local part
  gets no Unicode normalization, because two local parts that differ in a compatibility character are
  two mailboxes and one key for both would let a code mailed to one verify for the other; plus tags
  stay separate keys, which the README now says, with the advice to limit per user id. A recipient
  whose domain is not plain ASCII gets a different key, so a code issued before the upgrade is not
  found after it.

- **A control character in a relay's reply no longer starts a second log line.** The warning an
  SMTP or Resend send failure logs carries the reason the relay or the API gave, after the
  credentials and declared secrets are removed from it; the startup warning for a template
  renderer that throws carries the error's text. A line feed in that text started a record nobody
  wrote, and a bidirectional control could make a line read as another. These lines now write the
  same controls the audit entry does as visible sequences, after the removal, so a declared value
  that holds a line feed is still matched as written.

- **`InMemoryOtpStorage.size()` counts the failure counters.** The helper reported the entries and
  the cooldowns and not the failure counters, so a test asserting that nothing is left behind could
  not see a counter that leaked; it now returns `failures` as well.

- **Resolving a template placeholder no longer reads the whole data object.** `DefaultTemplateRenderer`
  copied every own enumerable property of the data into a new map to find one value, and a nested path
  did it for each segment. The work grew with the size of the object,
  and a getter on a property the template never names ran, so one that threw broke a render that did
  not ask for it. The renderer now reads only the property that is named, and only when it is an own
  enumerable one: the same keys resolve as before, and inherited and prototype keys stay out of reach.
  A getter on a named key now runs each time the placeholder is read, not once per render for a flat
  placeholder, so a getter whose value changes between reads can differ between occurrences.

#### Apply to a derived backend

A purpose is now 1 to 64 characters from `A-Z a-z 0-9 : _ -`. `OtpService.generate`, `resend`,
`verify`, `consume` and `getStatus`, and the keys of `RedisOtpStorage` and `InMemoryOtpStorage`,
refuse any other with `notification.invalid_scope_identifier` (HTTP 400), where a purpose with a
space, a dot, a slash, a non-ASCII character, an empty string or more than 64 characters used to
work. A host that used such a purpose renames it; a code issued under one before the upgrade
cannot be verified after it, which only matters for the minutes of its lifetime. The
`NOTIFICATION_PURPOSES` and any snake_case name are unaffected. A `perPurpose` key outside the
set now fails when the module starts. A custom `IOtpStorage` needs no change: the service checks
before it calls the store, and the purposes `./testing` generates for its cases now fit the
rule. The default message of `INVALID_SCOPE_IDENTIFIER` in
`NOTIFICATION_ERROR_DEFINITIONS` is a literal type in the declarations and now reads "A tenant,
recipient or purpose identifier is not valid" where it said "Tenant or recipient identifier does
not identify anybody", so a host that matched on the old text updates; matching on the `code`
is unaffected.

A custom `INotificationLogRepository` now receives entries in which a control character in any
string, or in a key or string value of `metadata`, arrives as a visible escape sequence, and a
subtree of `metadata` that is too deep, circular or not a plain value arrives as a marker; a host
whose values never contain one sees no difference. The module wraps the repository for the
interceptor, `OtpService` and `EmailService`; a host that builds one of them by hand with `new`
passes its own repository straight through and escapes in its `create`. No declaration changes.

`InMemoryOtpStorage.size()` returns a `failures` field, and the exported
`InMemoryStorageSize` type gains it as a required property: code that reads the result is
unaffected, code that builds a value of that type adds the field.

The log lines of the SMTP and Resend providers and of the template startup check now hold a
reason with control characters written as visible sequences; the error those providers throw
keeps its text as it came, so a host that logs it writes its own line and escapes it there.

## [1.4.9] - 2026-11-14

### Fixed

- **A backing service that is unavailable is answered with 503, not 500.** When the OTP store
  could not be reached, the error of the Redis client went straight to the HTTP layer as an
  unclassified 500, and a failed email send was always 502, whether the provider refused the message or
  could not be reached at all. `OtpService` now wraps its store, and a refused connection, a closed
  client, a timed-out command, an exhausted retry limit, a replica that cannot write or serve
  (`READONLY`, `LOADING`, `MASTERDOWN`), or a cluster that is down or asks for a retry
  (`CLUSTERDOWN`, `TRYAGAIN`) becomes
  `notification.otp_storage_unavailable` (503) with the original error as the log-safe `cause`;
  every other failure of a store, a defect included, passes through unchanged. A failed email send
  keeps `notification.email_send_failed` and answers 503 when the provider could not be reached or
  timed out (a refused connection, a DNS failure, a timeout, or Resend answering 5xx), 502 when it
  answered and refused. The reference providers carry the client's error code onto the error they
  throw, so the status is read from a code and not from the provider's words.

### Security

- **A Resend send no longer waits for as long as the platform allows.** `ResendEmailProvider` set no
  timeout of its own, so an endpoint that never answered, or sent headers and stalled the body,
  held the request for as long as the platform allowed. Every send now
  fails at `timeoutMs` (default `15000`, an integer from `1` to `2147483647`; a larger value would
  make Node abort at once), covering the request and the response body, with the fixed reason
  `Resend request timed out after <n> ms`. The SDK is given the abort signal and the call is also
  raced against it, so an older SDK that ignores the signal is bounded too. A timed-out send may
  still have been delivered; the library does not retry.

- **An SMTP failure no longer carries the credentials in their base64 form.** The provider removed
  the configured user and password from a relay's error text, but only as written. A relay or a
  client library that quotes the AUTH exchange shows `AUTH PLAIN <token>` or the two LOGIN lines in
  base64, which a literal match cannot see, so they reached the thrown message and the log line.
  The base64 forms of the user, of the password and of the AUTH PLAIN token (an empty authorization
  identity, the user, the password, as nodemailer sends it) are now removed from both, and from the
  error thrown while the transport is built. A short credential over-redacts a message, as it
  already did.

- **An SMTP send no longer waits for as long as a trickling relay allows.** The other timeouts
  each bound a phase or an idle socket, so a relay that kept sending bytes could hold a send past
  all of them. `SmtpEmailProvider` now bounds the whole call with `sendTimeoutMs` (default `60000`,
  an integer from `1` to `2147483647`) and fails with the code `ETIMEDOUT`, which the service
  answers with 503. The thrown text is `SMTP send failed: SMTP send timed out after <n> ms`, or the
  fixed `SMTP send failed` when the message body carries a credential. Nodemailer cannot abort a
  send in flight, so a timed-out send may still have been delivered. The connection is left open:
  `socketTimeout` reaps it once the relay goes idle, and a relay that keeps sending holds it until
  the relay ends the connection or the process exits. The library does not retry.

- **A failed send no longer blocks the event loop on a large or repeated body.** When a provider
  or relay rejected a send and quoted the message, the echo detector extended every occurrence of
  every window of the error text, which is quadratic in a repeated run, and paid that cost again for
  the plain-text body. The detector now finds the same excerpts in time linear in the error text and
  the body together, and returns the same excerpts. An error text longer than 64 KiB is scrubbed whole instead of examined piece by piece, because the detector's memory grows with it.
- **`sendTemplate()` refuses an oversized recipient list before it renders the template.**

- **`consumeOnVerify` accepts a code once.** `verify()` read the entry, compared it, and deleted it
  in separate steps, so several verifications of the right code running together each returned
  `valid: true`, and a host that creates a session or resets a password on `valid` acted once per
  winner. With `consumeOnVerify: true` the entry is now removed by
  one atomic compare-and-delete in the storage, `IOtpStorage.deleteIfCode`, and exactly one verification wins; the others return `not_found`. The method is given the
  stored value the service read, never the guess, and a code regenerated in between is left alone.
  With `consumeOnVerify: false` several verifications can still each return `valid: true` until the
  host calls `consume()`, which the README now states.

- **An OTP is delivered to exactly one mailbox.** The recipient string went to the transport as an
  address list, so `victim@x.com, attacker@evil.example` delivered the code to both, and a list of
  any length made the endpoint send from the host's domain to any number of addresses. With email
  delivery, `OtpService.generate()` and `resend()` now refuse, before a cooldown or a code exists,
  a recipient that is not one plain address (a list, a display name, an angle address, a comment, a
  quoted local part, an IP literal, whitespace or a control character inside it, or more than 254
  characters) with `notification.email_invalid_recipient`. The refusal never echoes the value.
  Internationalized addresses are accepted. Manual delivery is unchanged.
- **A message addresses at most `email.maxRecipients` mailboxes (default `50`).** `to`, `cc` and
  `bcc` count together, after a `,` or `;` splits a string, and a larger message is refused with
  `notification.email_invalid_recipient` before the provider is called.

#### Apply to a derived backend

`NOTIFICATION_ERROR_CODES` and `NOTIFICATION_ERROR_DEFINITIONS` gain `OTP_STORAGE_UNAVAILABLE`
(`notification.otp_storage_unavailable`, 503): a frontend that maps
every code adds it. A custom `IEmailProvider` that wants its unreachable or timed-out failures
answered with 503 sets a `code` such as `ECONNREFUSED`, `ETIMEDOUT` or `EUNAVAILABLE` on the error
it throws; without one the failure stays 502.

`ResendEmailProviderOptions` gains the optional `timeoutMs`. A backend that builds a
`ResendEmailProvider` needs no change; one that substitutes its own Resend client accepts a second
argument, `{ signal }`, on `emails.send` and may honour it.

`SmtpEmailProviderOptions` gains the optional `sendTimeoutMs`. A backend that builds an
`SmtpEmailProvider` needs no change. **A timed-out send, from `SmtpEmailProvider` and from
`ResendEmailProvider` alike, may still have been delivered**, so a job that retries a failed send
can deliver the same message twice. Make the job idempotent, or pass an idempotency key where the
provider accepts one. The library does not retry.

A custom `IOtpStorage` needs no change for the 503: `OtpService` wraps it, and a failure whose
error carries a network `code` the service recognises (`ECONNREFUSED` and `ETIMEDOUT` are two of
them), or whose text is one it recognises, is answered with 503, with the storage's own error as
the `cause`. A failure with any other code or text keeps passing through as before.

`IOtpStorage` gains the optional `deleteIfCode(tenantId, recipient, purpose, expectedStored)`, and
the service constructor throws when `otp.consumeOnVerify` is `true` and the storage lacks it: a
derived backend with a custom storage implements it (an atomic delete that fires only while the
stored code equals `expectedStored`, returning whether it removed the entry) or sets
`consumeOnVerify` to `false`. The `./testing` contract covers it. The bundled `InMemoryOtpStorage` and
`RedisOtpStorage` implement it, so a backend that uses them needs no change. A storage that
implements it gives `consumeOnVerify: true` exactly one winning verification; with
`consumeOnVerify` left `false` the storage needs no change.

`EmailChannelOptions` gains the optional `maxRecipients`, and `ResolvedEmailOptions` gains the
required `maxRecipients`. A backend that builds resolved options by hand adds `maxRecipients: 50`.
A caller that sent one message to more than 50 recipients, or whose OTP recipient was not one plain
address, now receives `email_invalid_recipient`; raise `maxRecipients` for a legitimate fan-out.

## [1.4.8] - 2026-11-12

### Documentation

- The README is shorter and says only what a consumer needs. It drops a sentence of project
  history and guidance about another library's provider, defines the `otp_code` template once,
  groups the email rows of the Configuration table, and gives Errors its own section with the
  provider-text guidance condensed. A new section lists what the library does not do.
- The `SmtpEmailProvider` option table, the TLS rationale and the header-injection guard moved to
  [`docs/smtp-provider.md`](https://github.com/bymaxone/nest-notification/blob/main/docs/smtp-provider.md);
  the README keeps a short section and the link.
- Wording fixes: audit failures are swallowed by default (`audit.swallowErrors`), not
  never; the OTP verify codes are reserved; and the Supply chain row no longer claims a scan on
  every push.
- A Tech Stack badge row sits between the Security Table and Testing & Quality.

`dist/` is unchanged from 1.4.7: no source, declaration or behaviour change.

## [1.4.7] - 2026-11-07

### Added

- **A swallowed audit failure now leaves a warning.** With the default `audit.swallowErrors: true`
  a failed audit write was dropped without a trace, so an audit outage, or a `tenantIdResolver`
  that returned a blank id, emptied the audit trail, including the entries that record a recipient
  reaching its attempt ceiling, while every send and verification kept succeeding. The OTP
  service, the email service and the audit interceptor each log
  `BYMAX_NOTIFICATION_AUDIT_WRITE_FAILED`, naming the channel and the failure's class or code only:
  a `notification.` code, otherwise the error's name and code, each
  only when it is a short token. The repository's error message is never printed, because it can
  quote the entry it rejected, whose recipient and user id are personal data, in any form; the cause
  is in the repository's own logs. A name or code your repository sets itself is printed when it is a short token, so do not put an identifier of the entry in one. No OTP code is ever written. At most one line is written per
  channel per minute; the next line says how many failures it stands for. What the caller receives
  is unchanged.

### Documentation

- The README now states the ordering behind `AUDIT_LOG_FAILED` when `audit.swallowErrors` is
  `false`: the audit write comes after the state change, so the error says only that the audit write
  failed and replaces the result the call would have returned. It can follow a stored, delivered or
  accepted code, or the recording of a refusal, so the outcome cannot be inferred from it. When the
  email channel's own audit of a send fails, `generate()` also releases the stored code and the
  resend cooldown.

## [1.4.6] - 2026-11-01

### Fixed

- **The missing-template startup warning names the locale once for an `en` host.** With `en` as the
  default locale the line read "neither 'en' nor 'en'". It now reads "does not resolve for 'en'";
  every other default locale keeps "resolves for neither '<locale>' nor 'en'".
- **The `remedy` on `TEMPLATE_NOT_FOUND` for `otp_code` is true on every path.** It told the reader
  to pass `emailTemplate` to `generate()`, which a direct `sendTemplate('otp_code')` has no way to
  do. It now says where the option applies: the OTP email can use another template through the
  `emailTemplate` option of `generate()`.

## [1.4.5] - 2026-11-01

### Added

- **A startup warning for an OTP channel whose email template cannot be found.** The OTP email is
  rendered from the `otp_code` template and the default renderer ships none, so a host that enables
  OTP with an email channel and no such template booted cleanly and failed on the first
  `generate()`. When the OTP channel is on, the email provider is configured and the renderer has
  `otp_code` for neither the default locale nor `en`, one line,
  `BYMAX_NOTIFICATION_OTP_TEMPLATE_NOT_RESOLVED`, is logged at startup. It names the way out and
  the hosts it does not apply to: those that pass `emailTemplate` on every call, deliver manually,
  or load templates after startup. The check runs detached, so it never delays or fails boot, even
  for a renderer that throws, rejects or never answers (in the first two cases the line says the
  check could not run and why).

### Changed

- **`TEMPLATE_NOT_FOUND` for `otp_code` carries a `remedy`.** `details` gains `remedy`, naming the
  template, `DefaultTemplateRenderer` and the `emailTemplate` option. `template` and `locale` are
  unchanged, and the error for any other template is unchanged.

## [1.4.4] - 2026-11-01

Documentation only: `dist/` is byte-identical to 1.4.3.

### Fixed

- **The development Quick Start now runs.** Step 2 registered `NoOpEmailProvider` and
  `InMemoryOtpStorage` but no template renderer, and the OTP email is rendered from the `otp_code`
  template, which the default renderer does not ship. The module booted, and the first
  `generate()` threw `TEMPLATE_NOT_FOUND`. Step 2 now registers a `DefaultTemplateRenderer` with
  the same `otp_code::en` template as step 3, and says why it is needed.

### Tests

- The README development Quick Start is executed as written: the module and the service are
  compiled from the README text and run against a Nest testing graph, with a stand-in email
  provider. A second case fails if the `otp_code::en` template in steps 2 and 3 drifts apart.

## [1.4.3] - 2026-11-01

### ⚠️ Apply before upgrading

- **The address the OTP email is delivered to is now trimmed.** A caller that passed a recipient
  with surrounding whitespace used to have the provider receive it as typed; the provider now
  receives it without the whitespace, with its case unchanged. A test that asserts the `to` of
  the delivered message against an untrimmed fixture has to expect the trimmed value. The OTP
  state key is unchanged, so no live code or cooldown is lost.

### Fixed

- **The OTP email goes to the trimmed address.** The scope key was already trimmed and folded, but
  the provider still received the address as typed, so `" Jane.Doe@Example.COM "` reached it with
  its surrounding spaces. Delivery now trims the address and keeps its case (RFC 5321 §2.4); the
  key is unchanged.
- **A thrown value is described without throwing, and by shape.** A caught value was turned
  into text with `error instanceof Error ? error.message : String(error)`. That throws on a value
  with no prototype or a hostile `toString`, and it printed `[object Object]` (or `Error: …`) for
  an error from another realm and for a plain `{ message }` object, which many SDKs reject with.
  They now read a string `message`, fall back to `String()` inside a `try`, and finally to a fixed
  phrase. Redaction is applied exactly where it was.

## [1.4.2] - 2026-10-31

### Security

- **Two spellings of one mailbox are one OTP state.** `OtpService` keyed its state on the recipient
  byte for byte, so `Jane@Acme.com`, `jane@acme.com` and ` jane@acme.com` each had their own resend
  cooldown and their own attempt counter: with `defaultMaxAttempts: 3`, five spellings accepted 15
  wrong guesses and five codes could be minted back to back, and a user who typed another case than
  the one the code was issued for was told it did not exist. The service now keys on the recipient
  with surrounding whitespace trimmed and an email address (a value containing `@`) lower-cased, in
  all five methods and in the audit entry. The message is still delivered to the address exactly as
  supplied, because RFC 5321 §2.4 requires a sender to preserve the local-part's case; only the key
  is folded. A recipient that is not an email is only trimmed.
- **`EmailService` refuses a tenant that identifies nobody.** `send` and `sendTemplate` accepted an
  empty or whitespace-only `tenantId` and recorded any string in the audit entry verbatim. They now
  refuse it with `notification.invalid_scope_identifier`, as `OtpService` already did.
- **A control character in a tenant is refused in both services, and in a recipient by `OtpService`.** A newline in an
  identifier reaches the consumer's audit sink and log lines verbatim and forges a second record;
  no legitimate identifier contains one. The refusal never echoes the value.
- **An OTP code can be stored as a keyed digest instead of in plaintext.** `OtpEntry.code` held the
  code itself, so anyone able to read Redis saw every live code. The new optional
  `otp.codeSecret` (a string of at least 32 UTF-8 bytes, validated at startup, kept with the
  application and not in the store) makes `OtpService` store `hmac-sha256:v1:<hex>`, an HMAC-SHA-256
  of the code, and compare a guess in constant time. It is defence in depth: NIST SP 800-63B-4
  requires hashing for look-up secrets and a separately stored key for password verifiers, and
  says nothing about an out-of-band code. A plain hash would not do, since a six-digit code is
  recovered by trying a million values. Without the option nothing changes except one startup
  warning that codes are stored in plaintext. The delivered email still carries the plaintext
  code, the audit entry carries neither form, and the secret is not a property of the resolved
  options.
- **Failed verifications now survive a re-issue.** NIST SP 800-63B-4 §3.1.3.2 says generating a new
  authentication secret "SHALL NOT reset the failed authentication count", yet every new code got a
  fresh `defaultMaxAttempts`: with 3 attempts, three wrong guesses, a re-issue after the cooldown
  and three more were all accepted, so the limit only bounded guesses per cooldown. A
  `(tenant, recipient, purpose)` now has a failure counter in the storage: every verification attempt against a
  live code adds one and restarts its lifetime to the purpose's code lifetime, `verify()` counts each attempt before
  comparing the code and refuses once the count passes the ceiling whichever code is live, and a successful verification or `consume()` clears it.
  `RedisOtpStorage` keeps it under `{namespace}:otp_fail:{purpose}:{hash}` with one atomic script.
  A custom `IOtpStorage` opts in with three optional methods, `getFailures`, `recordFailure` and
  `clearFailures`; one without them behaves as before and the module logs one
  `BYMAX_NOTIFICATION_OTP_FAILURES_NOT_CARRIED` warning at startup. The executable contract in
  `./testing` checks the three methods when they are present and passes trivially when they are
  absent.
- **New error code `notification.otp_manual_delivery_unavailable`** (400; 24 codes, up from 23).
  `generate()` never returns the code, so a manual delivery reads it back from the store, and a
  store that holds a digest has nothing to hand over. With `otp.codeSecret` set, a manual
  delivery (`deliverVia: 'manual'`, or the default when no email channel is configured) is refused
  before the cooldown is taken or anything is stored, instead of succeeding with a code nobody can
  deliver.

### ⚠️ Apply before upgrading

- **`otp.codeSecret` is opt-in and loses no live code.** An entry stored in plaintext before the
  secret was set still verifies until it expires. Changing the secret, removing it, or
  downgrading below this version leaves the stored digests unverifiable (`invalid_code`): those
  codes must be requested again. A custom `IOtpStorage` is unaffected, since `OtpEntry.code` is an
  opaque string. Set the secret from a secret store, not from the place the Redis credentials come
  from, or a reader of Redis gets both.
- **A recipient at the failure ceiling stays locked out until the counter lapses.** With a
  storage that carries failures (the bundled ones), a recipient at the ceiling gets
  `{ valid: false, reason: 'max_attempts' }` for any code, a freshly issued one included, until the
  counter has not been touched for the purpose's code lifetime. Someone who sends wrong
  guesses for another person's address can keep that address locked out; rate-limit the OTP
  endpoints by IP in your controller, as the security checklist says.
- **If you implement `IOtpStorage` yourself,** add `getFailures`, `recordFailure` and `clearFailures`
  and re-run the contract from `@bymax-one/nest-notification/testing`. Until you do, a re-issued
  code gets a fresh attempt budget and the startup warning says so. Redis users: the new key
  `{namespace}:otp_fail:*` is created on the first wrong guess; nothing is migrated.
- **One extra storage write in `verify()`.** The stored failure count is the only thing that
  outlives a code, so `verify()` increments it before comparing the code, while a code is live (one atomic script on Redis)
  and refuses once the number passes the ceiling; a code is issued with its own full attempt count and
  the lockout ends exactly when the counter lapses. Storages without the failure methods skip the
  write. A refused verification now reports `max_attempts` where it used to report `not_found` after
  the code was spent.
- **`otp.codeSecret` and manual delivery do not combine.** Where a flow delivers the code itself
  (`deliverVia: 'manual'`, or no email channel), leave the secret unset or move that flow to email
  delivery; a development setup that reads the code from the store keeps `codeSecret` unset.
- **A module with the OTP channel and no `otp.codeSecret` logs one warning at startup** (from
  `forRoot` and `forRootAsync`). Set the option, or filter the log line
  `BYMAX_NOTIFICATION_PLAINTEXT_OTP_CODES` if plaintext storage is a decision you have made.
- **A live OTP issued to a recipient with uppercase letters or surrounding whitespace is re-keyed.**
  The code was stored under the old key, so verifying it after the upgrade reports `not_found`
  until the user asks for a new code. The window is the code's TTL (10 minutes by default).
- **`getEmail()`, `getOtp()` and `dispatch` refuse a configured-but-unusable channel with 501.** Code
  that branched on `notification.email_provider_not_configured` (500) from a `dispatch` or from a
  send made through `getEmail()` now sees `notification.channel_disabled` (501) there; a send made
  on an injected `EmailService` still raises the former.
- **The fourteen unused optional peers are gone from `package.json`.** If a tool of yours reads this
  package's peer list to decide what to install (a template, a bootstrap script), install the SDK
  of the adapter you write yourself: `handlebars` for a Handlebars renderer, `@sendgrid/mail` for
  a SendGrid provider, and so on. The package no longer lists them.
- **A caller that passed a blank `tenantId` to `EmailService` now gets a 400.** Pass the tenant the
  email belongs to.

### Changed

- **`RedisLike` accepts an ioredis client as the documentation shows.** `set` was declared as a
  variadic `(key, value, ...args)`, which no overload of ioredis 6's `set` satisfies, so
  `new RedisOtpStorage({ redisClient: new Redis(url) })`, the production example in the README, did
  not compile under `strict`. It now declares the two forms the storage calls: the cooldown lock
  (`EX`, seconds, `NX`) and the in-place rewrite that keeps the expiry (`KEEPTTL`, `XX`). A client
  or double you wrote with a variadic `set` still satisfies it. Nothing changes at runtime.
- **A channel that is configured but unusable is refused the way `getEnabledChannels()` omits it.**
  When the email provider or the OTP storage reports `isConfigured() === false` (a Resend client
  without its key, an SMTP relay without a host), `getEnabledChannels()` already left the channel
  out, yet `getEmail()` and `getOtp()` still returned the service and the first send failed later.
  They now throw `notification.channel_disabled` (501) with `details.reason`
  (`provider_not_configured` or `storage_not_configured`), and a `dispatch` to that channel is
  refused the same way. The module also logs one `BYMAX_NOTIFICATION_CHANNEL_NOT_USABLE` warning
  per such channel at startup, from `forRoot` and `forRootAsync`. Failing the boot instead is not
  done: an application that starts without its secrets (a preview, a CI job) keeps starting.
- **Fourteen optional peer dependencies the package never loads are removed.** `package.json`
  declared `@sendgrid/mail`, `@aws-sdk/client-ses`, `@aws-sdk/client-sns`,
  `@aws-sdk/client-dynamodb`, `mailgun.js`, `twilio`, `firebase-admin`, `handlebars`,
  `@react-email/render`, `mjml`, `class-validator`, `class-transformer`, `express` and
  `@types/express` as optional peers, but no source file imports any of them: they were the
  libraries the documentation's adapter examples use. What remains is what the package loads:
  `@nestjs/common`, `@nestjs/core`, `reflect-metadata` and `rxjs` (required), `ioredis`, `resend`,
  `nodemailer` and `react` (optional). Removing an optional peer cannot break an installation; it
  stops advertising a range for packages the library has no code for, and it stops a scan of your
  dependency tree from attributing their advisories to this package. An adapter you write for one
  of those providers keeps depending on its SDK in your application.

### Documentation

- **README: three statements corrected against the code.** The subpath diagram drew `react`
  depending on `shared`; `react` imports only `react`, and `server` is the subpath that builds on
  `shared`. The Architecture section said an unconfigured channel is a startup error; it is not —
  `getEnabledChannels()` lists the wired channels, and `getEmail()` / `getOtp()` throw
  `CHANNEL_DISABLED` for one that is not. The SMTP `requireTls` default now reads "`true` unless
  implicit TLS or loopback", which is what the provider does on port 465.
- **README: the multi-tenant snippet imports what it calls.** The `tenantIdResolver` example called
  `BymaxNotificationModule.forRoot` after importing only a type, so pasted as written it did not
  compile.
- **README: every error code, who raises it, and which are reserved.** A table lists every code with
  its HTTP status and the component that throws it. The codes the library never throws are marked
  reserved: the four OTP verify outcomes (`verify()` returns the reason instead),
  `email_invalid_recipient` (the recipient is not validated), and the SMS and push codes.
- **README: the options and members that were only in the technical specification.**
  `consumeOnVerify`, `defaultFromName`, `defaultReplyTo` and `defaultTags` join the Configuration
  table; the `DefaultTemplateRenderer` options, the `EmailService.send` and `OtpService.generate`
  inputs, the `useOtpInput` and `useOtpCountdown` options, the injection tokens,
  `InMemoryOtpStorage.size()` and the `otpStorageContract` usage example are documented.

### Tests

- **The README's option-default tables are held to the code.** Two specs parse the Configuration
  table and the SMTP option table and assert every stated default, every "required" marker, the
  OTP length range and the SMTP port, TLS and timeout rules against the resolved options and the
  transport the provider builds, so a drifted cell fails the suite instead of reaching npm.
- **`check:published` compiles every README snippet against the built types.** It now runs the
  TypeScript API, so a parse error in one snippet no longer hides the semantic errors in the
  others; compiles snippets that do not import the package too; and types the names
  the prose introduces in `scripts/readme-prelude.d.ts`, so a wrong method, option or destructured
  field is an error instead of a call through `any`.
- **The error table and the renderer options are held to the code.** One spec compares the README
  error table with the catalog and with the source: a code is reserved exactly when no file
  constructs a `NotificationException` with it. Another builds a `DefaultTemplateRenderer` without
  each option and checks the documented default.
- **`RedisOtpStorage` is exercised against a real Redis on every pull request.** A `Real Redis e2e`
  job starts `redis:8-alpine` with testcontainers and runs the executable `otpStorageContract`,
  200 concurrent `recordFailure` calls, the hashed `otp_fail` key with its lifetime, and the
  `OtpService` flows (lockout across a re-issue, parallel guesses, a success clearing the counter).
  The unit suite keeps its in-process double; `pnpm test:e2e:redis` runs the same suite locally with
  Docker.
- **A test guess cannot equal a generated code.** Specs that guessed `000000` against a code the
  service had just generated failed about once in a million runs; they now guess `ABCDEF`, which
  no numeric code can equal.

## [1.4.1] - 2026-10-30

### Security

- **Peer ranges raised past published advisories.** `nodemailer` `^9.0.1` → `^10.1.4` (13
  advisories, the highest severity "high", fixed from 10.1.4) and `handlebars` `^4.7.9` →
  `^4.7.10` (3 advisories, the highest "critical", fixed in 4.7.10). A declared peer range states
  which versions this package supports, so the floor no longer admits a version with a known
  advisory. See the note below for what a `nodemailer` 9 consumer has to do.
- **`OtpService` refuses a blank scope before it reaches the storage.** `generate`, `resend`,
  `verify`, `consume` and `getStatus` now throw `NotificationException` with code
  `INVALID_SCOPE_IDENTIFIER` when `tenantId` or `recipient` is empty, whitespace-only or not a
  string. `details` carries `{ boundary: 'OtpService', parameter, reason }` and never the value.
  When the OTP channel is not configured, `generate`, `resend`, `verify` and `consume` still throw
  `OTP_STORAGE_NOT_CONFIGURED` first; `getStatus` has no such check and validates the scope first.
  - **Reference storages** (`InMemoryOtpStorage`, `RedisOtpStorage`): no change, they already
    threw through `hashTenantRecipient`.
  - **A custom `IOtpStorage` that accepted a blank tenant or recipient:** those calls now throw
    instead of reaching the adapter. Before, such an adapter could share one scope between every
    caller that sent a blank value.
- **`otpStorageContract` checks the tenant/recipient boundary with a second delimiter.** The
  entry-key and cooldown-key cases now also use a pair that collides when the key is built by
  joining the raw values around `::`. A storage that did so passed the contract before and now
  fails it.

### ⚠️ Apply before upgrading

- **A consumer on `nodemailer` 9.** The optional peer range of `nodemailer` moves from `^9.0.1` to `^10.1.4`, so a consumer on
  `nodemailer` 9 has to upgrade to 10.1.4 or later. The only breaking change between the two
  majors is that `nodemailer` 10 requires Node.js 20 or newer ([its changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md),
  10.0.0); this package already requires Node.js 24. `SmtpEmailProvider` works with both the ESM and
  CommonJS builds of `nodemailer` 10. No 9.x release fixes these advisories: 9.1.1 is the last 9.x and
  still falls inside the vulnerable range of nine of them.
- **A consumer that brings `handlebars`.** The optional peer range moves from `^4.7.9` to
  `^4.7.10`, so a consumer that uses `handlebars` for a template renderer has to be on 4.7.10 or
  later. This package never imports `handlebars` itself; the range states which versions are
  supported when you provide it.
- **A consumer with a custom `IOtpStorage`.** `OtpService` now refuses a blank, whitespace-only or
  non-string `tenantId` or `recipient` with `INVALID_SCOPE_IDENTIFIER` before it calls your
  storage. If your callers can pass such a value, validate it before the call, because those calls
  used to reach the adapter. The reference storages already refused them.

### Changed

- **The published `dist/` changes in this release; it is not a documentation-only release.**
  `OtpService` gains the scope validation above, `otpStorageContract` gains the second boundary
  pair, and the declaration files carry new doc comments on `NotificationAuditInterceptor` and on
  `GlobalOptions.tenantIdResolver`, plus the export-statement form described next.
- **Bundler `tsup` 9.** The published JavaScript (`.mjs` and `.cjs`, every subpath) is byte-identical
  to what `tsup` 8 produced from the same source. The declaration files (`.d.ts`, `.d.cts`) differ
  only in how the export list is written: values in one `export { }`, types in a separate
  `export type { }`. Nothing about the exported names or their types changes.
- Development and CI tooling only, with no effect on the published package: pnpm override floors
  raised; the dev dependency group refreshed; `osv-scanner.toml` time-boxes the advisory
  (`deepmerge`) that has no patched release.

### Documentation

- **What the audit interceptor does with a tenant id that identifies nobody (behaviour since 1.4.0).**
  `NotificationAuditInterceptor` refuses a tenant id that is not a string, is empty, or is
  whitespace-only, on every path that produces it: the value `tenantIdResolver` returns, the
  payload's `tenantId` when no resolver is configured, and the payload's `tenantId` when a resolver
  is configured but there is no HTTP request. The 1.4.0 entry only named an empty value from the
  resolver. The refusal does not reach the caller: with `audit.swallowErrors: true` (the default) it
  is swallowed and no audit entry is written; with `false` it surfaces as `AUDIT_LOG_FAILED` with a
  sanitized copy of the refusal as its `cause`. A payload whose `tenantId` is not a string is
  ignored instead: the argument is not recognised as a dispatch, so there is no entry and no error.
- **README corrections a consumer reads.**
  - `NoOpEmailProvider` logs a masked recipient only, never the subject or the body. The README
    said it logged the subject and the recipient.
  - The module is described as running on Resend or SMTP out of the box, or on any provider you
    implement. The README named SendGrid as if it were bundled.
  - The package has four subpaths, including `./testing`. One README line said three.
  - The multi-tenant example is a header-based resolver, not a JWT claim, and the README now says
    what the audit interceptor does with a tenant id that identifies nobody.
  - The bundle-budget table lists the `testing` budget. The fixed test count and the stale
    error-code count in the exports table (it said 22) are gone.
  - Vulnerability reporting points to GitHub Private Vulnerability Reporting, with email as the
    fallback.
- Documents that are not part of the package (SECURITY, CONTRIBUTING, CLAUDE.md, AGENTS.md, the
  specification and guides under `docs/`) were brought in line with the code as well.

## [1.4.0] - 2026-09-04

> ### ⚠️ Read before deploying — the version number does not warn you
>
> **Every OTP storage key changes in this release, and nothing in the type system will tell
> you.** It compiles, the suite passes, and on deploy every OTP and resend cooldown still in
> flight becomes unreachable. An operator reading `fix(otp)` and a minor version bump will not
> infer that every code in flight stops working — this paragraph is the only warning there is.
>
> **Scope, so this reads as accurate rather than alarming.** The defect it fixes is a
> cross-tenant key collision that is real in the library and **unreachable in today's only
> consumer**: `bymax-one` resolves tenants through a host-label guard that rejects both an empty
> label and a colon, so it provably never emits an identity that could collide. A backend
> resolving tenants from a database column, a JWT claim or an admin-entered field inherits none
> of that protection.
>
> What to do about it is in [Apply to a derived backend](#-apply-to-a-derived-backend) below.

### Security

- **Storage keys no longer collapse two different `(tenantId, recipient)` pairs onto one key.**
  The key was `sha256(`${tenantId}:${recipient}`)` — the two fields joined around a delimiter,
  which does not encode where the boundary falls. `('acme:bob', 'x')` and `('acme', 'bob:x')`
  produced the same input string and therefore the same key, so under a consumer whose tenant
  ids or recipient ids can contain a colon, one tenant's `verify` could consume another tenant's
  OTP. Each component is now hashed to a fixed length before the two are joined:
  `sha256(sha256(tenantId):sha256(recipient))`.

  This was never a weakness in SHA-256, and the documentation said otherwise — `README.md` and
  `CLAUDE.md` claimed cross-tenant collision was "computationally infeasible (SHA-256 preimage
  resistance)". Preimage resistance is irrelevant to it: the two pairs were the same input, and
  every digest property held perfectly while they collided. Those claims are corrected.

  `InMemoryOtpStorage` composed its map key the same way, with `::`, and had the same defect.

- **New error code `notification.invalid_scope_identifier`** (23 codes, up from 22). The refusal
  below is a `NotificationException` rather than a bare `Error`: it reaches a consumer through
  every `IOtpStorage` method, and this library's contract is that a consumer branches on `code`.
  A raw throw surfaced as an untyped 500 carrying an internal message, where the condition is a
  400 the caller can act on. `details` names the boundary, the parameter and the reason — never
  the value, which is serialized into the response and is exactly what must not be echoed back.

- **A component that identifies nothing is refused rather than hashed** — empty, whitespace-only,
  or not a string at all. An empty component put every caller that omitted it into one shared
  namespace, the same isolation failure reached from the other side. Whitespace produced a
  distinct key and therefore no collision, but named no tenant. The `typeof` check is there
  because the declared `string` is a contract this library states and a consumer may not honour:
  a `null` claim or a numeric database id type-checks at their call site and previously failed
  inside `createHash` with a message naming crypto's `data` argument instead of this rule.

- **`NotificationAuditInterceptor` refuses an empty tenant id from `tenantIdResolver`.** An empty
  scope does not identify a tenant, and recording it filed the event under a scope shared with
  every other empty result. The refusal is subject to `audit.swallowErrors` like any other audit
  failure: the entry is skipped rather than written wrong.

### ⚠️ Apply to a derived backend

**Every OTP storage key changes with this release, and nothing in the type system will tell you.**
It compiles, the suite passes, and on deploy every OTP and resend cooldown still in flight becomes
unreachable — the old keys are never read again. Consequences to plan for:

- Users mid-verification get `OTP_NOT_FOUND` and must request a new code.
- Resend cooldowns reset, so a user who was throttled can request again immediately.
- Stale entries expire on their own TTL; nothing needs to be purged, but nothing is migrated
  either. There is no dual-read path, deliberately: reading the old construction back would mean
  keeping the colliding key alive.

Deploy when a short window of "request your code again" is acceptable, or drain OTP traffic first.

**If you implement `IOtpStorage` yourself,** re-run the contract from `@bymax-one/nest-notification/testing`.
It has two new cases — `keeps the tenant and recipient boundary when composing a key` and the same
for a cooldown key — which fail any implementation that concatenates the two fields around a
delimiter. **Both are needed:** the entry key and the cooldown key are composed separately, so a
storage that fixes one and not the other passes every case that exercises only the first. 21 cases,
up from 19. A survey
of the sibling libraries found 108 composite key constructions and 2 that encode their components,
so this defect is the default rather than the exception.

### Fixed

- `loadOptionalPeer` attaches the caught error as `cause` on the "package is not installed" path
  as well, so a resolution failure names the specifier the runtime actually rejected.

## [1.3.1] - 2026-08-18

### Documentation

Code is unchanged: the built `dist/` is byte-identical to 1.3.0, verified by unpacking the
published tarball and diffing it against a fresh build. This release exists because the README
ships inside the package and one of its security claims described the behaviour of 1.2.2.

- **Corrected: what the OTP path writes to its audit entry.** The README said OTP delivery
  "declares the code via `auditRedactValues`, and `EmailService` redacts it from the entry's
  `errorMessage`". That was true until 1.3.0, which made the OTP path set
  `publishProviderText: false` — so the entry now records the fixed label
  `[provider text withheld]` plus the structured reply codes, and the provider's own words never
  reach it. The declaration remains, as precision for the paths that do publish text.
- **`publishProviderText` is now documented rather than mentioned in passing.** It appeared once,
  inside a paragraph about the ceiling of redaction, despite being the feature 1.3.0 is named
  after. It has its own section: what the failure carries, the structured fields it publishes, a
  worked example, and the three properties worth knowing before relying on it — the codes are
  independent of the secret, ambiguity resolves to silence, and a code colliding with a declared
  value is dropped.
- **Documented: the two surfaces name the reply codes differently.** The audit entry carries
  `deliveryStatus` / `deliveryEnhancedStatus`; the exception's `details` carries `status` /
  `enhanced`. The README said they were "the same pair", which would have sent a consumer looking
  for keys that are not there — and it contradicted the worked example three lines below it. Both
  shapes are now named, and the example shows the audit entry alongside the exception. (The
  inconsistency itself is API surface shipped in 1.3.0; unifying the names would be a breaking
  change, so it stays a 1.4.0 question rather than something a patch quietly alters.)
- Internal docs caught up with the fourth subpath: the subpath tables in `CLAUDE.md` and
  `docs/technical_specification.md` listed three, and `AGENTS.md` described neither the storage
  contract nor the withholding flag. None of these ship, so they did not force this release; they
  are here because the sweep that found the README claim found them too.

## [1.3.0] - 2026-08-17

### Added

- **`publishProviderText: false` — a send may now refuse to surface anything the provider wrote.**
  The 1.2.2 note documented the ceiling of value redaction: it removes the shapes it can predict,
  and a relay quoting the body in another transfer encoding defeats every declared value. This is
  the control that does not have that ceiling. With the flag set on `EmailService.send` (or
  forwarded to a provider as `EmailSendOptions.publishProviderText`), a delivery failure carries no
  provider-authored byte — no `cause`, and no provider message in the audit entry, whose
  `errorMessage` becomes the fixed label `[provider text withheld]`.

  What it publishes instead is what a **fixed grammar** can express: the basic SMTP reply code and,
  when present, the RFC 3463 enhanced code, as structured fields (`deliveryStatus` /
  `deliveryEnhancedStatus` on the audit entry, and the exception's `details`). The safety property
  is that this output is **independent of the secret** — the same reply publishes `550 5.7.1`
  whether the code was `550571`, `123456`, or absent — not that its alphabet differs from a code's,
  which is false for a numeric secret. Ambiguity resolves to silence: a text carrying two different
  replies publishes neither, so a cause chain cannot have `424` and `242` read as one value.

  The default is unchanged (`true`): ordinary mail keeps full diagnosability, because for a receipt
  or a marketing send the provider's message is often the only diagnosis available. The flag is
  **per send**, never global — one setting cannot serve an OTP path and a marketing path in the
  same application. `EmailSendTemplateInput` carries it too, and **the built-in OTP delivery sets
  it to `false`**: an OTP body is a credential by definition, so that path no longer publishes what
  the provider wrote. The bundled `SmtpEmailProvider` attaches the reply codes to the error it
  throws, so the service can publish them without parsing a message that is a fixed label by then.

- **`@bymax-one/nest-notification/testing` — an executable contract for `IOtpStorage`.**
  `otpStorageContract(factory)` returns 19 cases that a consumer runs against their own storage in
  whatever runner they use; the package depends on none. The obligations it covers cannot be checked
  by a type — `consumeAttempt` and `tryAcquireCooldown` must be **atomic**, the TTL must be applied
  (including across `update`, which must neither reset an expiry nor resurrect a lapsed entry), and
  both the entry keys and the cooldown keys must be scoped by `(tenantId, recipient, purpose)` —
  each of the three dimensions checked separately for both key kinds — and a violation type-checks, passes a casual smoke test, and silently lets the
  brute-force ceiling be bypassed under concurrency or one tenant read another's code. The two
  atomicity cases run 25 concurrent calls and fail when more than the ceiling gets through. Each
  case is itself pinned by a test that points it at a storage violating exactly that obligation —
  one per operand where the check is composite — so the contract is proven to have teeth rather
  than merely to run. Each run scopes its keys with a random prefix, so suites executing in
  parallel against one backend cannot see each other's state as a violation.

### Changed

- The audit entry gained two optional fields, `deliveryStatus` and `deliveryEnhancedStatus`.
  Adding optional fields is not breaking for an `INotificationLogRepository` implementation.
- `collectErrorChainMessages` joins the internal redaction helpers alongside `collectErrorChainText`:
  reply-code extraction reads messages only, because a stack trace is dense with three-digit line
  numbers and feeding those to a reply-code grammar makes almost every text ambiguous. Found by a
  test, not by review.

### Fixed

- A test-only flake that would have read as a security regression: the audit-entry assertions
  compared a generated six-digit code against a payload containing the 13-digit `timestamp`, which
  holds eight overlapping six-digit windows — roughly one spurious "the code is in the audit entry"
  failure per 10^5 runs. The machine-generated timestamp provably cannot BE the code, so it is
  excluded from the comparison while every field the library writes stays in it.

## [1.2.2] - 2026-08-15

### Documentation

Code is unchanged: the built `dist/` is byte-identical to 1.2.1, verified by unpacking the
published tarball and diffing it against a fresh build. This release exists because the 1.2.1
security note ships inside the package, and two of its statements were wrong in the direction that
makes a reader feel safer than they are.

- **Corrected: where the declaration belongs.** The 1.2.1 note said `@bymax-one/nest-auth` never
  calls `EmailService` itself, so the declaration belonged to "the consumer's own adapter". That
  is false for the shipped wiring. Measured in the published `@bymax-one/nest-auth@1.4.3` bundle:
  `DefaultAuthEmailProvider` is exported, sends through an `AuthEmailSink` whose own typings name
  `EmailService.send` as the intended implementation, and `auditRedactValues` appears **zero**
  times in the bundle. So wherever that bundled provider is the one bound — the wiring `nest-auth`
  intends and the template uses — the call site is inside `nest-auth` rather than in consumer code,
  and a derived backend that then binds a real SMTP or Resend provider inherits the exposed path
  with **no call site of its own to declare at**. The remedy for that population sits in
  `DefaultAuthEmailProvider`, which is the only place that knows both the code it rendered and the
  call it is about to make. A consumer that implements `nest-auth`'s email port itself does own its
  call site, and for that one the original advice held. Credit: the `bymax-one` template seat measured it from the
  consumer's vantage point; `nest-auth` confirmed it against their own bundle.

- **Corrected: declared values are not a sufficient control.** The note called declaration "the
  precise control" and the README called it "the only precise control". Both overstate it. A relay
  quotes what it _transmitted_, not what it was handed, and a MIME body travels raw,
  quoted-printable or base64. Measured through `EmailService.send` on this exact build: with the
  code declared in `auditRedactValues`, an error quoting the **base64** of the body is returned
  completely unredacted, and decoding the surviving text yields the OTP in cleartext. The declared
  value cannot match (`123456` does not occur in `MTIzNDU2`) and echo detection cannot match
  either, because it compares the error against the _rendered_ body it holds, not against the
  encoding the relay chose. This is the ceiling of value-list redaction, not a defect in either
  guard: **no list of values closes an encoding gap.**

  What the guards are, accurately: defence in depth that removes the shapes they can predict.
  Treat provider error text reaching a log as the thing to control, and declared values as
  precision on top of that — not as the barrier.

- **Corrected: the README asserted and refuted the same guarantee.** The feature list said "Codes
  are never logged … not into an error message" and the security section promised "every
  occurrence of the code is scrubbed", while the paragraph added by this same patch documents an
  encoded echo surviving both guards. The unconditional claims came first, which is the half a
  skimming reader takes away. They now say what they actually cover: text **this library authors**,
  and every **literal** occurrence — with a pointer to the ceiling for text a provider authors.
  Found by applying a rule a consuming team derived after finding the identical drift in their own
  changelog: a claim written to explain and a claim written to instruct drift apart inside one
  author's head, because the explanation optimises for the point and the instruction for the cases.
  Grep the narrative against the instructions whenever one document carries both. A second sweep
  caught two more of the same shape — the security table's "Code Exposure" row and the
  code-lifetime paragraph — which is the argument for sweeping by claim rather than by the wording
  that happened to appear in the first one found.

- The residual risk this leaves is tracked for a behaviour change rather than another note, and
  the shape of that change is open. What the measurements above establish is the direction: value
  redaction is a **blacklist** — it must predict the form the secret takes, and it loses to any
  form it did not predict. Publishing only what a fixed grammar can express — the SMTP basic
  status and, when present, the RFC 3463 enhanced code — is a **whitelist**, and the property that
  makes it safe is that its output is **independent of the secret**, not that its alphabet differs
  from the secret's. The distinction is testable in three lines: the same relay reply publishes
  `550 5.7.1` whether the code was `550571`, `123456` or absent entirely, so an observer learns
  nothing about it. Punctuation-stripping `550 5.7.1` does yield `550571`, the shape of a live
  six-digit code — a coincidence rather than a disclosure, but one with a real operational cost,
  because a log rule alerting on digit runs fires on every such reply. Publishing the codes as
  structured fields rather than interpolated into a message string keeps that cost from arising.
  What stays genuinely open is how much diagnosis a general channel needs: for auth mail the
  provider's prose is never diagnostic, which is why `@bymax-one/nest-auth` publishes none of it,
  while for the same installation's receipts and marketing a `550` content rejection and a `550`
  blocklisted sender call for opposite actions. Nothing here is decided.

## [1.2.1] - 2026-08-15

### Fixed

- **A provider error that echoes the message body no longer carries the body's secrets into the
  attached `cause`.** Measured by a consumer on published 1.2.0 with a server-side control: a
  policy relay quoting the rejected content in its `550` put a live OTP into the ERROR-level log
  entry, in `err.cause.message` and `err.cause.stack` — a path 1.2.0 created by attaching the
  cause, upgrading a pre-existing `warn`-level leak. The 1.2.0 scrub only ran where THIS library
  issues the code (`OtpService`); a consumer-issued code sent through `EmailService.send` (e.g.
  `@bymax-one/nest-auth`'s OTP flows) was outside it.

  Three layers now close the delivery path:
  - `EmailService` scrubs the outgoing `cause` (not just the audit `errorMessage`) with the
    caller's declared `auditRedactValues`, on `EMAIL_SEND_FAILED` and `TEMPLATE_RENDER_FAILED`.
  - **Echo detection** (`collectEchoedExcerpts`): any run of 16+ characters of the rendered
    body found inside the provider error is treated as an echo and redacted — this is what makes
    the UNDECLARED case fail safe for the measured scenario, since the library knows the body it
    just handed to the provider even when it does not know which part is secret. Limits, stated
    plainly: matching is raw and literal (a re-encoded echo is missed) and a bare secret quoted
    without surrounding content is shorter than the window and is not caught. Declared values add
    precision where the shape is predictable — but they are NOT a sufficient control either; see
    the 1.2.2 entry for the measurement that shows an encoded echo defeating both.
  - Declared values travel to the provider as `EmailSendOptions.redactValues`, and
    `SmtpEmailProvider` scrubs them plus detected body echoes from its `warn` line and thrown
    message — closing the pre-existing `warn`-level half of the same leak.

  **Boundary that this release does NOT close, so the note cannot read as "done":** declaring a
  consumer-issued secret in `auditRedactValues` removes it only where it appears in the raw,
  literal shape it was declared in — it is not coverage of the secret as such — and a bare code
  echoed WITHOUT surrounding body content is below the echo guard's 16-character window.
  <!-- The two claims this paragraph originally made about WHERE that declaration belongs, and
  about declaration being a sufficient control, were both wrong. See 1.2.2 for the correction and
  the measurements. -->

  **See the 1.2.2 entry above before relying on this paragraph.**

- **Overlapping secrets can no longer leave a fragment behind after redaction.** `redactValues`
  used to replace value-by-value over its own output, so `['123', '1234']` over `1234` emitted
  `[redacted]4` — one digit of a live secret surviving — and two values overlapping without
  nesting (`['1234', '2345']` over `12345`) leaked a fragment under EVERY replacement order.
  Occurrences are now located against the original text and overlapping or nested matches merge
  into a single marker before anything is replaced; a value can also no longer match inside a
  marker inserted for an earlier one. Every scrub path (audit `errorMessage`, outgoing `cause`,
  SMTP credential/echo redaction) inherits the fix. Credit: the defect class was measured by a
  consuming team's review of their own scrub of the same shape.

- **Echo discovery reads the whole error chain, both bundled providers scrub, and matching is
  no longer quadratic.** Review findings on the patch itself: discovery previously read only the
  top-level `error.message`, so a wrapper with a generic outer message and the echoed body in a
  nested `cause` (or a stack) chose the raw-cause path — it now feeds on message and stack at
  every link (`collectErrorChainText`, guarded reads, cycle-safe). `ResendEmailProvider` applies
  the same declared-value/body-echo scrub (plus its API key) to its warn line and thrown message,
  matching `SmtpEmailProvider` — on BOTH failure shapes the SDK can produce, the resolved
  `{ error }` result and a rejected promise (a transport/fetch failure quoting the request body
  previously bypassed the scrub entirely and threw raw). Echo matching extends anchored occurrences character-by-character
  instead of re-searching a growing substring per character, so a relay echoing a large body can
  no longer stall the event loop. And `SmtpEmailProvider` no longer redacts its credentials
  BEFORE detecting echoes: a quoted body containing the password split the echoed run into halves
  below the detection window, so everything after the password — the OTP included — reached the
  log line; detection now runs on the raw message with every value replaced in one pass.

- **`NotificationException` no longer exposes the constructor's `options` argument to
  serializers.** NestJS's `HttpException` keeps `options` as an enumerable own property, so
  structured log output showed `"options":{"cause":{}}` beside the real `cause` — a duplicate
  reference to the same sanitized copy (no additional secret exposure, but a second surface to
  audit). The property is now non-enumerable; deliberate reads still work.

## [1.2.0] - 2026-08-14

### Added

- **`NotificationException` now carries the underlying error as the native `Error.cause`.** A failed
  dispatch used to log _what_ failed and never _why_: `EMAIL_SEND_FAILED` discarded the provider's
  error, so a `connect ECONNREFUSED` existed only in a separate `warn` line — recoverable by
  request-id correlation, and entirely absent for a deployment logging at `error`. Since dispatch is
  fire-and-forget, the log is the only surface where the reason can appear at all. Reported by a
  consumer with a live reproduction (SMTP pointed at a closed port), and verified against this
  release the same way: the reason now sits nested inside the same serialized `err` object, with no
  change on the logging side — cause-walking serializers (e.g. pino's `err`) pick it up natively.

  The third constructor parameter accepts an options bag,
  `new NotificationException(key, details, { status?, message?, cause? })`, mirroring how
  `HttpException` itself evolved; the positional `(key, details, status, message)` form keeps
  working unchanged. All five sites that previously discarded the underlying error now attach it:
  `EMAIL_SEND_FAILED`, `TEMPLATE_RENDER_FAILED`, and the three `AUDIT_LOG_FAILED` throw sites.
  `NotificationExceptionOptions` is exported from the server subpath.

  The cause is stored as a **log-safe copy**, not the raw object: `name`, `message`, `stack`, and
  the nested `cause` chain survive (depth-bounded); every other property is dropped. Provider/SDK
  errors routinely retain the request payload in extra properties (an axios-style `config.data`),
  and for an OTP email that payload contains the code — attaching the raw object would have handed
  a cause-walking serializer exactly what the never-log-codes rule exists to keep out of logs.
  Non-Error object causes are flattened to their `String()` form for the same reason; primitives
  pass through. One nuance, inherited from Nest and documented on the option: `HttpException`
  installs only a _truthy_ cause, so a falsy cause is silently ignored.

### Fixed

- **`AUDIT_LOG_FAILED` no longer leaks internal error text into the HTTP response.** The three
  audit-failure sites stuffed the caught error's message into `details.cause` — and `details` is
  serialized into the response body, so storage/audit internals reached the HTTP client on a 502
  whenever `audit.swallowErrors` was `false`. The error now rides only on `Error.cause` (never
  serialized into the response) and those responses carry `details: null`. The security gate was
  extended to match: tests serialize thrown exceptions recursively — message, stack, response body,
  and every nested cause — and assert the plaintext OTP code appears at no depth.

- **A delivery error that echoes the plaintext code is scrubbed before it leaves `OtpService`.**
  The renderer receives the code inside its template `data` and the provider receives it inside
  the rendered body, so either may echo it in a thrown error's message or stack. On a failed OTP
  delivery the service now replaces every occurrence of the code with `[redacted]` — in the audit
  entry's `errorMessage` and across the rethrown error chain (message and stack at every link) —
  at the one layer that knows the secret. The scrub also covers `name` (serializers emit it like
  `message`), deletes payload-bearing own enumerable properties from arbitrary errors (a storage
  may reject with `Object.assign(new Error(...), { entry })` — and the entry carries the code —
  while a `NotificationException` keeps its contract properties, safe by construction), and
  flattens a non-`Error` `cause` link — a primitive string tail carries the secret verbatim and
  an object tail can carry it in a property, and neither can be walked as an Error.
  Traversal is identity-based (`WeakSet`), so a cyclic chain terminates and no depth limit leaves
  an unscrubbed tail; writes go through `Reflect.set`, so a frozen foreign error degrades to
  best-effort instead of throwing. Any non-`Error` rejection — a string, or an object a custom
  storage may reject with that retains the entry — is flattened to a redacted string, since a raw
  object could carry the code in its properties.

- **`EmailService` redacts declared secrets from its own failed-audit entry.** The email `failed`
  audit entry records the provider's message, which is written before `OtpService` can scrub the
  rethrown chain — so a provider that echoes the rendered body leaked the code into that one
  entry. `EmailSendInput`/`EmailSendTemplateInput` gain `auditRedactValues`: secret values the
  caller declares (only the caller knows them) that are replaced with `[redacted]` in the entry's
  `errorMessage`. OTP delivery passes `[code]` automatically; a real-path regression (real
  `EmailService`, echoing provider) asserts both audit entries and the rethrown chain are
  code-free.

## [1.1.2] - 2026-08-14

### Fixed

- **A failed optional-peer import no longer always blames a missing package.** `SmtpEmailProvider`
  and `ResendEmailProvider` both wrapped their lazy `import()` in a bare `catch` that mapped _every_
  failure to `` `<pkg>` package is not installed. Run `pnpm add <pkg>` ``. That is worse than no
  message: it names a fix that cannot work, so a consumer reinstalls a package that is already in
  `node_modules` and starts doubting their dependency tree.

  The case that actually bites, reported by a consumer and reproduced against the published 1.1.1
  tarball: a Jest suite running **without `--experimental-vm-modules`** cannot service a dynamic
  `import()` at all and fails with `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` while the package
  is installed. Every consumer unit test reaching `send()` hit the wrong diagnosis.

  Now the install instruction requires two things: a module-resolution code —
  `ERR_MODULE_NOT_FOUND` (dynamic import) or `MODULE_NOT_FOUND` (the CommonJS `require` form) — **and**
  a message naming that exact specifier. The code alone is not enough: an _installed_ peer whose own
  evaluation fails because one of **its** dependencies is missing rejects with the very same codes,
  verified on Node 24 with a fixture package, and blaming the top-level peer there would be the same
  bug one level down. The specifier check degrades safely — when it cannot confirm the name, the
  honest message is used, so the worst case is a lost hint rather than a confident wrong claim.

  Anything else is surfaced as ``Failed to load `<pkg>`: <the real message>`` with the original error
  kept as `cause`. The loading logic now lives once in an internal `loadOptionalPeer` helper, so the
  two adapters cannot drift.

  **Apply to a derived backend:** none. If a unit suite needs to exercise a code path that reaches
  `send()`, run Jest with `--experimental-vm-modules` — that is the supported way to service a
  dynamic `import()` under Jest, and the error now says so instead of misdirecting.

## [1.1.1] - 2026-08-14

### Added

- **`SmtpEmailProvider` — a bundled `IEmailProvider` speaking SMTP through Nodemailer.** Until now
  the library shipped an adapter for one vendor's HTTP API (Resend) but none for the protocol every
  relay, Postfix, corporate gateway and SES SMTP endpoint understands — and none for the mail-capture
  servers (Mailpit, MailHog) that are the only way a consumer can exercise its email flows end to
  end. Every consumer was therefore hand-writing the same adapter. `nodemailer` was already declared
  as an optional peer dependency and marked external in the build; only the implementation was
  missing.

  ```typescript
  import { SmtpEmailProvider } from '@bymax-one/nest-notification'

  // Local capture server — open relay, plaintext.
  new SmtpEmailProvider({ host: 'localhost', port: 1025, secure: false })

  // Authenticated production relay — STARTTLS already mandatory by default.
  new SmtpEmailProvider({
    host: process.env.SMTP_HOST,
    port: 587,
    credentials: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  })
  ```

  Behaviour worth knowing before adopting:

  - **STARTTLS is mandatory by default for any non-loopback host.** On a connection that does not
    start out encrypted, whether TLS happens at all is decided by the _plaintext_ EHLO banner: an
    attacker with network position strips the `250-STARTTLS` line, the transport never upgrades,
    and the credentials plus the OTP-bearing body cross the network in the clear. `requireTls`
    therefore defaults to `true` unless the host is `localhost` / `127.0.0.1` / `::1`, or `secure`
    is already on. **A capture server reached by a compose service name rather than over loopback
    needs an explicit `requireTls: false`** — it will fail closed otherwise, which is the intended
    direction.
  - **A line break in `from`, `replyTo`, a recipient, or a custom header name/value is rejected
    before the send.** Nodemailer already neutralizes these, so this is defence in depth. The
    subject is exempt: a stray trailing newline from a template is plausible there.
  - **`isConfigured()` answers on real configuration.** A host is required; credentials are required
    only when a `credentials` object was supplied at all, which is how a deployment declares that it
    logs in. An open capture server is configured; a relay whose `SMTP_PASS` failed to load is not,
    and the send fails closed rather than silently going out anonymously.
  - **The option is `credentials`, not `auth`** — this is a notification library, not an
    authentication one. Nodemailer's own wire key stays `auth` inside the adapter.
  - **Nodemailer is loaded lazily** on the first `send()`, so a consumer on another transport never
    installs it. Concurrent first sends share one initialization; a failed init is retried.
  - **No startup `verify()`** — a briefly unreachable relay must not stop the application booting.
  - **Timeouts are bounded** at `10s` connection / `10s` greeting / `20s` socket, because
    Nodemailer's own defaults run into minutes and would pin a request path.
  - **The `messageId` is the RFC-5322 `Message-ID`**, angle brackets included, so an audit entry
    correlates with the header the recipient received.
  - **A base64 string attachment is tagged `encoding: 'base64'`.** `EmailAttachment.content` is
    documented as a `Buffer` **or** a base64 string; untagged, Nodemailer would deliver the base64
    text as the literal file contents.
  - **`tags` are not forwarded** — SMTP has no tag facility. They still reach the audit log.
  - **Neither credential is ever exposed**: both live in an ECMAScript private field (so
    `JSON.stringify`, object spread and `util.inspect` cannot reach them) and both are scrubbed out
    of any transport error before it is logged or re-thrown into the audit entry. The **user** is
    scrubbed too, because it is not always a public login — an SES SMTP username is itself generated
    secret material. Matching is literal, so a very short credential over-redacts the message; that
    is the deliberate direction, since the other failure mode is persisting a secret.

  **Apply to a derived backend:** none required — this is additive. To adopt, `pnpm add nodemailer`
  and swap the hand-written adapter for `SmtpEmailProvider`.

### Changed

- `docs/technical_specification.md` §5.1.5 is no longer an "example adapter" sketch: it documents the
  shipped provider, its options, and the reasoning behind each design decision that had a plausible
  alternative. The sketch's `isConfigured(): return Boolean(this.transporter)` was always `true` and
  is explicitly not what the implementation does.

## [1.1.0] - 2026-08-11

### Changed

- **BREAKING: `ioredis` peer dependency moved to `^6.0.0`** (was `^5.0.0`; the ranges are
  disjoint, so an ioredis 5 consumer no longer satisfies the contract). This lets a consumer that
  also installs `@bymax-one/nest-queue@1.2.0` (which peers `ioredis ^6.0.0`) resolve a single
  ioredis version instead of two. `RedisOtpStorage` never imports `ioredis`: it depends on the
  locally declared structural `RedisLike` surface, so no runtime path changed. ioredis 6 keeps
  `replyMapping: "legacy"` by default, so the reply shapes the Lua/TTL paths rely on are
  unchanged. **Apply to a derived backend:** none — this is a library peer range; a consumer on
  ioredis 5 must move to ioredis 6 to satisfy the new peer.
- **Stryker mutation gate raised to 100%.** `thresholds.break`, `thresholds.high`, and
  `thresholds.low` in `stryker.config.json` are now all `100`, so any surviving (non-equivalent)
  mutant fails the run rather than being tolerated above 95%. The score was already 100% with no
  survivors; this makes the standard the gate.

## [1.0.6] - 2026-08-10

Remediation of a local audit's development-log privacy finding (merged in #55). No API changed.

### Fixed

- **The no-op email provider no longer logs the recipient in clear, the subject, or the body.** The
  development provider now logs only a first-initial mask of each recipient (`m***@example.com`).
  The subject is dropped entirely: it is rendered from a consumer template that can interpolate an
  OTP code, so logging it could persist a real code in a developer's log, violating the
  never-log-codes invariant.

## [1.0.5] - 2026-08-08

**Documentation only.** `dist/` is byte-identical to `1.0.4`; no source file changed.

### Fixed

- **The README understated the mutation score.** The badge and
  `docs/mutation_testing_results.md` both record **100%** with no survivors, measured in the
  2026-08-06 re-run — but the prose bullet beside them still said **98.17%**, and cited "857
  of 873 viable seeded faults killed" from the pass before it. The badge and the report were
  updated and the sentence between them was not, so the npm page has been claiming less than
  the package delivers.
- The `[Unreleased]` compare link still pointed at `v1.0.3` after `1.0.4` shipped.

## [1.0.4] - 2026-08-06

**Published-artifact change, not a behavioural one.** `dist/` differs from `1.0.3` — this
bundler preserves comments and the source gained mutation-suppression notes — but no runtime
path changed. Measured by building both revisions and diffing the output.

### Documentation

- The mutation badge said **98%**; the measured score is **100.00%**.

### Tests

- OTP expiry is `now + ttlSeconds * 1000` and only its order of magnitude was checked. Dividing
  instead of multiplying would expire a 300-second code 0.3 milliseconds after minting it, and
  every failure would read as a delivery problem rather than an arithmetic one.
- A dotted template path stops at the first non-object. Without that guard `{{ name.0 }}` renders
  the first letter of the string, and the same slip against `{{ token.0 }}` would put the first
  character of a secret in an email.

## [1.0.3] - 2026-08-05

### Fixed

- **`NotificationService` never received its channel services, and said the channels were
  disabled.** Both constructor parameters carried `@Optional()` and no `@Inject`. Nest
  reads three separate metadata keys here — `self:paramtypes` from `@Inject()`,
  `design:paramtypes` from TypeScript, and `optional:paramtypes` from `@Optional()` — and
  the third only says a dependency may be missing; it carries no token. The published
  bundle is built by tsup/esbuild, which documents that it cannot emit `design:paramtypes`,
  so neither key that names a dependency was present and both parameters resolved to
  `undefined`.

  With both channels configured, the module logged `Initialized with channels: email, otp`
  while `getEnabledChannels()` returned `[]` and `dispatch()` threw `CHANNEL_DISABLED` —
  an error that blamed a configuration that was correct. Both parameters now carry
  `@Inject`, keeping `@Optional()`, which is the shape `@nestjs/jwt` uses for the same
  situation.

### Changed

- `emitDecoratorMetadata` is `false` in `tsconfig.json`. It was `true`, which was never
  true of the artifact — tsup printed this on every build of this package:

  ```
  You have emitDecoratorMetadata enabled but @swc/core was not installed, skipping swc plugin
  ```

  The source now compiles the way the bundle is built, so a parameter that depends on
  reflected types fails where it is cheap to see rather than in a consumer's process.

## [1.0.2] - 2026-08-04

### Security

- The Resend API key and the Redis client are no longer disclosed when the provider or
  the OTP storage that holds them is serialized. `ResendEmailProvider` kept its adapter
  options — which carry `apiKey` — and `RedisOtpStorage` kept its client in TypeScript
  `private` properties, which are erased at runtime and leave enumerable own properties.
  `JSON.stringify`, object spread and `util.inspect` therefore emitted the API key in
  plaintext, and reached `options.password` on the ioredis instance. Both move to
  ECMAScript private fields. That matters because these are registered providers: a
  structured logger rendering its arguments, or an error reporter capturing the scope of
  a throw, walks them without being asked to.

Reading on purpose is unchanged and no public type or export moved.

## [1.0.1] - 2026-08-01

### Security

- **`@nestjs/common` peer floor raised to `^11.0.16`.** The declared `^11.0.0`
  admitted 11.0.0–11.0.15, which carry
  [GHSA-cj7v-w2c7-cp7c](https://github.com/advisories/GHSA-cj7v-w2c7-cp7c) —
  remote code execution via the `Content-Type` header, first patched in 11.0.16.

  `@nestjs/core` already sat at `^11.1.18` and needed no change. This gap is worth
  recording precisely: the ranges here were audited and clean when `1.0.0` was cut,
  and stopped being clean when the advisory was published, with no commit and no
  alert in between. Dependabot does not catch it — it looks at what is _installed_
  in this repository, never at what the package _declares it supports_.

- **`handlebars` peer floor raised to `^4.7.9`.** The declared `^4.7.7` admitted
  4.7.7 and 4.7.8, which carry eight advisories, the worst of them **critical**:
  [GHSA-2w6w-674q-4c4q](https://github.com/advisories/GHSA-2w6w-674q-4c4q)
  (JavaScript injection via AST type confusion), alongside four further injection
  and denial-of-service findings, all first patched in 4.7.9.

  `handlebars` is an _optional_ peer — the library never imports it, and the
  Handlebars renderer is an adapter example under `docs/templates/`. Optional
  does not make the range harmless: it is still the version this package tells
  anyone who opts in that it supports, and a consumer wiring that renderer
  resolves it against exactly this floor.

  Found by the scheduled `peer-advisory-drift` check on its first run, not by
  the manual sweep that raised the NestJS floor — that sweep went looking for
  NestJS specifically and never asked the question of the other eleven peers.

  Shipped as a patch, which is where a security fix belongs.

## [1.0.0] - 2026-07-30

First public release. Email + OTP channels, multi-tenant by design, pluggable
providers and storage, zero runtime dependencies, and never an `@prisma/client`
import.

### Added

- **`BymaxNotificationModule`** — dynamic NestJS 11 module with `forRoot` and
  `forRootAsync` (`useFactory`). Conditional provider registration: only the channels
  you configure are wired into the container; configuring an unconfigured channel throws
  at startup.
- **Email channel** — `EmailService` plus the `IEmailProvider` contract. Bundled
  `ResendEmailProvider` (Resend) and `NoOpEmailProvider` (dev/test — logs subject and
  recipient only, never the body). Attachment size guard (`maxAttachmentBytes`, default
  10 MiB).
- **OTP channel** — `OtpService` (`generate` / `verify` / `consume` / status) plus the
  `IOtpStorage` contract. Codes via `node:crypto.randomInt` (numeric / alpha /
  alphanumeric, built character-by-character to preserve leading zeros and avoid integer
  overflow); verification via `crypto.timingSafeEqual`. **Atomic** attempt counting
  (`consumeAttempt`) and resend cooldown (`tryAcquireCooldown`, `SET NX EX`) so
  `maxAttempts` and anti-resend cannot be bypassed under concurrency.
- **Reference storages** — `RedisOtpStorage` (keys hashed `sha256(tenantId:recipient)`,
  Lua-atomic primitives) and `InMemoryOtpStorage` (single-threaded atomicity for dev/test).
- **Templating** — `IEmailTemplateRenderer` plus the bundled `DefaultTemplateRenderer`
  (`{{var}}` interpolation with automatic HTML escaping in the HTML body; subject and
  plaintext left raw). `CANONICAL_EMAIL_TEMPLATES` constant for stable template names.
- **Multi-tenant** — every operation scoped by `tenantId`; SHA-256 store keys;
  `tenantIdResolver` (anti-spoofing) read by the audit interceptor as the trusted source.
- **Audit log** — opt-in `INotificationLogRepository` (fire-and-forget,
  `swallowErrors: true` by default; optional `maskRecipient`) and a
  `NotificationAuditInterceptor` for HTTP-level `sent` / `failed` entries. OTP codes are
  never written to any audit entry.
- **`NotificationService`** — uniform dispatch façade over the configured channels.
- **`NotificationException`** + a 22-entry error catalog (`NOTIFICATION_ERROR_DEFINITIONS`)
  with stable codes and HTTP statuses; response shape `{ error: { code, message, details } }`.
- **`./shared` subpath** — zero-dependency types and constants (`NOTIFICATION_ERROR_CODES`,
  `DEFAULT_TTLS`, `OtpPurpose`, `NotificationChannel`) importable in any environment.
- **`./react` subpath** — `useOtpInput` (multi-slot input with paste, Backspace, and
  Arrow navigation) and `useOtpCountdown` (expiry countdown) hooks. UX/state only — no
  HTTP client, no Node builtins.
- **Adapter examples** — Handlebars, MJML, and React Email renderers
  (`docs/templates/`); a Prisma `INotificationLogRepository` and schema fragment
  (`docs/schemas/`). Not imported by the library.
- **Supply chain** — published with npm provenance (OIDC); CodeQL `security-extended`,
  OpenSSF Scorecard, and a `check:no-prisma` CI gate.

### Not implemented

The interfaces below ship so you can plan your dispatch code paths against them,
but the services behind them do not exist yet and configuring those channels is
rejected at startup rather than failing on the first send.

- **SMS channel** — `ISmsProvider` is declared; configuring the `sms` channel throws.
- **Push channel** — `IPushProvider` is declared on the same terms; configuring the
  `push` channel throws.
- **`forRootAsync` `useClass` / `useExisting`** — only `useFactory` is wired.
- **Multi-provider failover and routing.**

[1.0.4]: https://github.com/bymaxone/nest-notification/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/bymaxone/nest-notification/compare/v1.0.2...v1.0.3
[Unreleased]: https://github.com/bymaxone/nest-notification/compare/v1.4.23...HEAD
[1.4.23]: https://github.com/bymaxone/nest-notification/compare/v1.4.22...v1.4.23
[1.4.22]: https://github.com/bymaxone/nest-notification/compare/v1.4.21...v1.4.22
[1.4.21]: https://github.com/bymaxone/nest-notification/compare/v1.4.20...v1.4.21
[1.4.20]: https://github.com/bymaxone/nest-notification/compare/v1.4.19...v1.4.20
[1.4.19]: https://github.com/bymaxone/nest-notification/compare/v1.4.18...v1.4.19
[1.4.18]: https://github.com/bymaxone/nest-notification/compare/v1.4.17...v1.4.18
[1.4.17]: https://github.com/bymaxone/nest-notification/compare/v1.4.16...v1.4.17
[1.4.16]: https://github.com/bymaxone/nest-notification/compare/v1.4.15...v1.4.16
[1.4.15]: https://github.com/bymaxone/nest-notification/compare/v1.4.14...v1.4.15
[1.4.14]: https://github.com/bymaxone/nest-notification/compare/v1.4.13...v1.4.14
[1.4.13]: https://github.com/bymaxone/nest-notification/compare/v1.4.12...v1.4.13
[1.4.12]: https://github.com/bymaxone/nest-notification/compare/v1.4.11...v1.4.12
[1.4.11]: https://github.com/bymaxone/nest-notification/compare/v1.4.10...v1.4.11
[1.4.10]: https://github.com/bymaxone/nest-notification/compare/v1.4.9...v1.4.10
[1.4.9]: https://github.com/bymaxone/nest-notification/compare/v1.4.8...v1.4.9
[1.4.8]: https://github.com/bymaxone/nest-notification/compare/v1.4.7...v1.4.8
[1.4.7]: https://github.com/bymaxone/nest-notification/compare/v1.4.6...v1.4.7
[1.4.6]: https://github.com/bymaxone/nest-notification/compare/v1.4.5...v1.4.6
[1.4.5]: https://github.com/bymaxone/nest-notification/compare/v1.4.4...v1.4.5
[1.4.4]: https://github.com/bymaxone/nest-notification/compare/v1.4.3...v1.4.4
[1.4.3]: https://github.com/bymaxone/nest-notification/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/bymaxone/nest-notification/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/bymaxone/nest-notification/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/bymaxone/nest-notification/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/bymaxone/nest-notification/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/bymaxone/nest-notification/compare/v1.2.2...v1.3.0
[1.2.2]: https://github.com/bymaxone/nest-notification/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/bymaxone/nest-notification/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/bymaxone/nest-notification/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/bymaxone/nest-notification/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/bymaxone/nest-notification/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/bymaxone/nest-notification/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/bymaxone/nest-notification/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/bymaxone/nest-notification/compare/v1.0.4...v1.0.5
[1.0.2]: https://github.com/bymaxone/nest-notification/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/bymaxone/nest-notification/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/bymaxone/nest-notification/releases/tag/v1.0.0
