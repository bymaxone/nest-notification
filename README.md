# @bymax-one/nest-notification

Multi-channel notification library for NestJS — email, OTP, SMS, push — with
pluggable providers and storage, multi-tenant by design, and **zero runtime
dependencies**.

> **v0.1 scope:** Email + OTP. SMS and Push interfaces are declared but their
> services land in v0.2. See `docs/technical_specification.md` for the full design.

```bash
pnpm add @bymax-one/nest-notification
```

```typescript
import { BymaxNotificationModule } from '@bymax-one/nest-notification'

@Module({
  imports: [
    BymaxNotificationModule.forRoot({
      email: { provider: new ResendEmailProvider({ apiKey }), defaultFrom: 'noreply@acme.com' },
      otp: { storage: new RedisOtpStorage({ redisClient }) }
    })
  ]
})
export class AppModule {}
```

<!-- The full usage guide (channels, templating, error catalog, React hooks) is
finalized in the release phase. The section below is authoritative for the
multi-tenant security model. -->

## Multi-tenant Security

This library is multi-tenant by design. Every operation is scoped by `tenantId`,
and three mechanisms keep tenants isolated and recipient data private.

### 1. SHA-256 storage keys (privacy + isolation)

OTP entries and resend cooldowns are stored under a key derived from
`sha256(tenantId:recipient)` — never the plaintext recipient or tenant id:

```
notification:otp:email_verification:7f3d8c91…  (64 hex chars)
```

- **Privacy.** An operator with `KEYS notification:otp:*` access to Redis — or
  anyone holding a leaked backup — cannot enumerate which emails/phones have a
  pending OTP. The recipient never appears in a key.
- **Isolation.** Two tenants sharing the same recipient produce different keys, so
  a cross-tenant collision is computationally infeasible (SHA-256 preimage
  resistance). One tenant's OTP, cooldown, and verification can never touch
  another's.

The trade-off — opaque keys you cannot read back to a recipient — is intentional:
keys are an index, not a data source. The recipient lives only inside the
TTL-bound value, and (optionally masked) in the audit log.

### 2. `tenantIdResolver` (anti-spoofing)

When you expose notification endpoints over HTTP, a caller could forge another
tenant's id in the request body — e.g. POST `{ "tenantId": "tenant_a", … }` from
`tenant_b` to verify someone else's OTP. To close this, configure a
`tenantIdResolver` that reads the tenant from a **trusted** source (a verified JWT
claim, a subdomain, a gateway-checked header):

```typescript
import type { NotificationRequest } from '@bymax-one/nest-notification'

BymaxNotificationModule.forRoot({
  global: {
    // Subdomain-based: `acme.app.com` -> `acme`.
    tenantIdResolver: (req: NotificationRequest) => req.hostname?.split('.')[0] ?? 'default'
  },
  // …channels
})

// JWT-claim based (the request is augmented by your auth middleware):
const tenantIdResolver = (req: NotificationRequest): string =>
  String(req.headers['x-tenant-id'] ?? 'default')
```

`NotificationRequest` is a minimal, framework-agnostic request shape (Express and
Fastify compatible). When a resolver is set, the opt-in
`NotificationAuditInterceptor` uses it as the **source of truth** for the audited
tenant id — any `tenantId` in the payload becomes a mere suggestion that the
resolver overrides.

> The resolver governs what the audit interceptor trusts. Service methods still
> take an explicit `tenantId`: resolve the tenant in your controller and pass it
> down — there is no hidden override of a method argument.

### 3. Least-privilege logging (codes are never logged)

OTP codes are a bearer secret. The library **never** writes a code to any sink:

- Not to the audit log — an audit entry is
  `{ verb, tenantId, recipient, purpose, providerName, … }`, never `code`.
- Not to a console/logger line, and not inside an `errorMessage` (which carries the
  message only — never a stack trace).

Codes exist only inside Redis (with a TTL) and in process memory for the duration
of the request. Configure `audit.maskRecipient` to minimize the recipient before
it is persisted (e.g. `jane@acme.com` → `j***@acme.com`). A regression test asserts
the invariant directly: `JSON.stringify(auditEntry).includes(code) === false`.

## License

MIT © Bymax One
