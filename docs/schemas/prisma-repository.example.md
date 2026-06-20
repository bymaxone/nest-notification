# Prisma `INotificationLogRepository` example

> **Reference only.** This file lives in `docs/` — it is **not** shipped in the
> package and is **not** imported by the library. `@bymax-one/nest-notification`
> never imports `@prisma/client`; the audit log is written exclusively through the
> `INotificationLogRepository` interface, which **you** implement in your app.

## 1. Add the schema

Copy the `NotificationLog` model from [`notification-log.prisma`](./notification-log.prisma)
into your application's `schema.prisma`, then run:

```bash
prisma migrate dev --name add_notification_log
```

## 2. Implement the repository

The repository is **consumer code**. It depends on your `PrismaService` (or
`PrismaClient`) — both of which stay in your application, never in the library.

```typescript
import { Injectable } from '@nestjs/common'
import type {
  INotificationLogRepository,
  NotificationLogEntry
} from '@bymax-one/nest-notification'

// CONSUMER CODE — your application's PrismaService.
import { PrismaService } from '../prisma/prisma.service'

/**
 * Persists notification audit entries with Prisma.
 *
 * The library calls `create` fire-and-forget (gated by `audit.swallowErrors`),
 * so keep it cheap and side-effect-free beyond the insert.
 */
@Injectable()
export class PrismaNotificationLogRepository implements INotificationLogRepository {
  readonly name = 'prisma'

  constructor(private readonly prisma: PrismaService) {}

  async create(entry: NotificationLogEntry): Promise<void> {
    await this.prisma.notificationLog.create({
      data: {
        timestamp: new Date(entry.timestamp),
        tenantId: entry.tenantId,
        channel: entry.channel,
        verb: entry.verb,
        recipient: entry.recipient,
        purpose: entry.purpose ?? null,
        providerName: entry.providerName,
        messageId: entry.messageId ?? null,
        errorMessage: entry.errorMessage ?? null,
        userId: entry.userId ?? null,
        metadata: entry.metadata ?? undefined
      }
    })
  }
}
```

## 3. Wire it into the module

Pass an **instance** so Prisma's runtime dependency is satisfied (the module wires
a ready instance with `useValue`):

```typescript
BymaxNotificationModule.forRootAsync({
  inject: [PrismaService],
  useFactory: (prisma: PrismaService) => ({
    otp: { storage: new RedisOtpStorage({ redisClient }) },
    audit: {
      repository: new PrismaNotificationLogRepository(prisma),
      // PII minimization before the row is written.
      maskRecipient: (recipient) => recipient.replace(/(.).+(@.*)/, '$1***$2')
    }
  })
})
```

## Security notes

- **No OTP codes.** Generated codes never reach `NotificationLogEntry`; do not add
  columns that would invite logging them.
- **`errorMessage` is message-only.** Never persist a stack trace — it can leak PII
  and internal structure.
- **Mask before persistence.** Configure `audit.maskRecipient` so the `recipient`
  column stores a minimized value when your compliance posture requires it.
