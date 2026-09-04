---
name: Feature request
about: Propose a new feature or extension point
title: 'feat: '
labels: enhancement
---

## Problem

<!-- What are you trying to accomplish that the current API does not support? -->

## Proposed solution

<!-- API shape, subpath it belongs to (server / shared / react), and how it would compose with
existing primitives. If it needs persistence or an external service, say which interface it goes
behind — the library never imports an ORM or a provider SDK directly. -->

## Alternatives considered

<!-- Other approaches and why they fall short. -->

## Scope

- Affects subpath(s): server / shared / react
- Breaking change: yes / no
- Requires a new peer dependency: yes / no (it must be optional if so)

## Security / data considerations

<!-- If the feature touches OTP codes, storage keys, audit entries, or rate limiting, describe how
it preserves the invariants: codes never reach a log line or an audit entry, storage keys stay
sha256(sha256(tenantId):sha256(recipient)) with no recipient PII, the attempt counter and the resend cooldown stay
atomic in the storage layer, and all comparisons stay constant-time via node:crypto. -->
