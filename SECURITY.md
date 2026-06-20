# Security Policy

`@bymax-one/nest-notification` ships transactional notification primitives — one-time
passwords, multi-tenant key isolation, and an audit trail — that downstream applications
rely on for verification and account-security flows. We take vulnerability reports
seriously and triage them ahead of feature work.

## Supported versions

Security patches are issued for the most recent minor on the active `0.x` line. Older
lines stop receiving fixes when a new minor ships.

| Version | Status                              |
| ------- | ----------------------------------- |
| `0.1.x` | ✅ Active — receives security fixes |
| `< 0.1` | ❌ Pre-release — not supported      |

If you are stuck on an older line and need a backport, open a private advisory (see below)
and we will discuss feasibility on a case-by-case basis.

## Reporting a vulnerability

**Do not report security issues through public GitHub Issues, Discussions, or pull
requests.** Public reports give attackers a window between disclosure and patch deployment.

Use GitHub **Private Vulnerability Reporting**, which is enabled on this repository:

➡️ [Open a private security advisory](https://github.com/bymaxone/nest-notification/security/advisories/new)

If you cannot use the GitHub form (e.g., you do not have an account), email
**security@bymax.one** with `[security] @bymax-one/nest-notification` in the subject line.

### What to include

A useful report contains:

- A clear description of the vulnerability and its impact (CIA triad — confidentiality,
  integrity, availability)
- Step-by-step reproduction against the latest `0.1.x` release
- The affected subpath (`.`, `./shared`, `./react`)
- A suggested fix or mitigation, if you have one
- Whether you would like to be credited in the published advisory (and how — name, handle,
  affiliation)

### Response timeline

| Phase                                       | Target                                |
| ------------------------------------------- | ------------------------------------- |
| Acknowledgement of receipt                  | within **72 hours**                   |
| Initial assessment and severity rating      | within **7 days**                     |
| Coordinated fix for **Critical / High**     | within **90 days** of acknowledgement |
| Coordinated fix for **Medium / Low**        | best effort, tracked in advisory      |

We follow [coordinated vulnerability disclosure](https://en.wikipedia.org/wiki/Coordinated_vulnerability_disclosure)
and publish the advisory only after a fixed version is on npm, unless active exploitation
forces an earlier publication. Reporters are credited in the GitHub Security Advisory and
the CHANGELOG entry unless they request anonymity.

## In-scope vulnerabilities

The following classes are explicitly in scope:

- **OTP generation weaknesses** — predictable or biased codes, use of a non-CSPRNG, lost
  entropy, or leading-zero loss that shrinks the keyspace.
- **Timing attacks on code comparison** — any path where OTP verification short-circuits
  on a per-character basis instead of using a constant-time comparison.
- **Attempt / cooldown bypass** — circumventing `maxAttempts` or the resend cooldown via a
  race condition (non-atomic read-modify-write on the store).
- **Multi-tenant isolation breaks** — a path where one tenant's OTP, cooldown, or
  verification can touch another tenant's, or recipient enumeration from store keys.
- **Tenant spoofing** — forging another tenant's id (e.g. in a request body) to operate on
  their OTPs when a `tenantIdResolver` is configured.
- **Audit / log leakage** — an OTP code, full recipient, or stack trace reaching an audit
  entry, console line, or error message.
- **Supply-chain integrity** — compromised dependency, malicious typosquat, tampered
  release artifact, or a missing/invalid provenance attestation.
- **CodeQL `security-extended` alerts** — anything the automated scan surfaces in the
  Security tab.

## Out of scope

These are not vulnerabilities in `@bymax-one/nest-notification` itself:

- Issues only reproducible in pre-`0.1.0` versions.
- Vulnerabilities inside a **consumer-supplied** `IEmailProvider`, `IOtpStorage`,
  `IEmailTemplateRenderer`, or `INotificationLogRepository` implementation — those are the
  consumer's code.
- Misconfigurations in the **consuming application** (no `tenantIdResolver` on an
  HTTP-exposed endpoint, a weak/shared Redis instance, missing transport TLS) unless they
  reproduce with the documented default configuration.
- Issues in optional peer dependencies (`ioredis`, `resend`, `react`, …) when the upstream
  maintainer has already accepted them or when the dependency is not exercised by the
  library.
- Self-XSS, social engineering, or denial of service via legitimate authenticated load.
- Theoretical attacks without a practical demonstration (e.g., a SHA-256 preimage).

## Security best practices for consumers

- Configure a `tenantIdResolver` reading from a **trusted** source (verified JWT claim,
  subdomain, gateway-checked header) on any HTTP-exposed notification endpoint.
- Set `audit.maskRecipient` to minimize recipient PII before it is persisted.
- Pin the package to an exact version in production, verify the publish provenance
  (`npm audit signatures`), and subscribe to this repository's security advisories.
- Keep your OTP store (Redis) on a private network with authentication and TLS — the
  SHA-256 keys protect recipient privacy, but the values still carry live codes under TTL.

## Acknowledgements

We are grateful to the security community and to every reporter who takes the time to
investigate and disclose responsibly.
