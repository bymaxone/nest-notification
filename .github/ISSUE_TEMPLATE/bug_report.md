---
name: Bug report
about: Report a reproducible bug in @bymax-one/nest-notification
title: 'bug: '
labels: bug
---

## Summary

<!-- One-sentence description of the bug. -->

## Reproduction

<!-- Minimal steps or a repo link. Include the subpath you were using (server / shared / react). -->

1.
2.
3.

## Expected vs actual

- **Expected:**
- **Actual:**

## Environment

- Package version: `@bymax-one/nest-notification@`
- Node.js version: `node -v` →
- Package manager: pnpm / npm / yarn
- NestJS version:
- Channels configured: email / otp
- Email provider: Resend / `NoOpEmailProvider` / custom `IEmailProvider`
- OTP storage: `RedisOtpStorage` / `InMemoryOtpStorage` / custom `IOtpStorage`
- OS:

## Additional context

<!-- Relevant module configuration and error output. NEVER paste a real OTP code, a provider
API key, or a recipient's full address — redact them before pasting. -->

## Sensitive-data impact

- [ ] This bug leaks an OTP code (into a log line, an audit entry, or an error message), exposes recipient PII, or lets one tenant read or consume another tenant's codes.

> If **Yes**, please **STOP** and email `support@bymax.one` instead of opening a public issue — a leaked code, a cross-tenant read, or a bypass of the attempt / cooldown limits is a security report, not a public bug.
