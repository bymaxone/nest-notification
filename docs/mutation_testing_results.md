# Mutation Testing Results

`@bymax-one/nest-notification` is verified with mutation testing using
[Stryker](https://stryker-mutator.io/). Line coverage proves a line *executed* during a
test; mutation testing proves a test *would fail* if that line were wrong. Stryker seeds
small faults into the source — flipped booleans, removed guards, mangled string literals,
swapped operators — and measures how many the suite detects. Every number below comes from
a recorded Stryker run; nothing is estimated.

> **Run date:** 2026-06-21 · **Stryker:** 9.x · **Runner:** jest, `coverageAnalysis: perTest`,
> concurrency 4. Reports: `reports/mutation/mutation.html` and `reports/mutation/mutation.json`.

---

## Headline

| Metric | Value |
|---|---|
| **Mutation score (over viable mutants)** | **98.17%** |
| Killed | 855 |
| Timeout (killed by infinite-loop detection) | 2 |
| Survived | 16 |
| Ignored (documented equivalents, `// Stryker disable`) | 16 |
| Excluded as non-viable (CompileError under strict TS) | 537 |
| Total mutants generated | 1426 |

The score is computed over the **873 viable mutants** (`killed + timeout + survived`).
`break: 95` passes — `pnpm mutation` exits `0`. Stryker's TypeScript checker excludes 537
mutants as `CompileError`: under `strict` mode many mutations (e.g. dropping a `null` guard)
produce code that would not compile, so they can never represent a real, shippable fault —
they are correctly removed from the score.

Every one of the 16 surviving mutants is **provably equivalent** — no test can distinguish
it from the original. They are documented individually in
[§ Surviving mutants](#surviving-mutants--every-survivor-is-a-provable-equivalent) below.

### Critical paths — 100%

The security-critical paths are at **100%** with no surviving mutant of any kind:

| File | Killed | Survived | Score |
|---|---:|---:|---:|
| `utils/code-generator.ts` | 32 | 0 | 100% |
| `utils/timing-safe-compare.ts` | 5 | 0 | 100% |
| `utils/hash.ts` | 2 | 0 | 100% |
| `providers/redis-otp.storage.ts` | 27 | 0 | 100% |
| `services/otp.service.ts` | 67 | 0 | 100% |

### Per-area

| Area | Killed+Timeout | Survived | Notes |
|---|---:|---:|---|
| `server/errors` | 2 | 0 | 100% |
| `server/utils` | 78 | 1 | `cooldown-helpers` unreachable-operand equivalent |
| `server/interceptors` | 47 | 0 | shape-guard `typeof`/`null` discrimination pinned |
| `server/config` | 109 | 0 | optional-spread omission + non-string-`defaultFrom` pinned |
| `server/providers` | 161 | 1 | `default-template-renderer` typeof-subsumed equivalent |
| `server/services` | 237 | 1 | `email.service` `Buffer.byteLength`-vs-`length` equivalent |
| `server` (module) | 78 | 0 | bootstrap-log channel list + async error fragments pinned |
| `react` | 144 | 13 | single-char regex anchors + redundant guards (all equivalent) |

---

## The hardening pass

The pass took the score from **92.82%** to **98.17%** through real test-strengthening — every
gain is a new assertion that pins the exact behaviour of a mutation point, never a weakened
gate, never a lowered threshold. **42 surviving mutants were killed** by new or strengthened
tests and **5** were annotated inline as provable equivalents (the surviving 63 from the prior
run, less the 16 documented equivalents below). Highlights:

- **`useOtpInput` (React)** — alpha-charset rejection of digits; Backspace on a *filled* slot
  at index > 0; the paste-sanitize replacement literal (asserted in alphanumeric mode where an
  injected marker would surface its letters); over-long-paste truncation pinned via the
  last-slot focus call; an argument-sensitive `clipboardData.getData('text')` mock; and four
  React-hook **dependency-array** kills via re-render/stale-closure tests (`[complete]`,
  `[refs]`, `[autoSubmit]`, `reset`'s `[length, focus, setValues]`).
- **`email.service`** — a multi-byte (`'😀'`) string attachment measured by UTF-8 byte length;
  exact error-`details` objects for `EMAIL_SEND_FAILED` / `EMAIL_ATTACHMENTS_TOO_LARGE` /
  `TEMPLATE_NOT_FOUND` / `TEMPLATE_RENDER_FAILED`; requested-locale-wins template resolution;
  and an inner-`send()` spy proving absent optional fields are never injected as `undefined`
  keys (kills all five `sendTemplate` optional-spread mutants at the inner-input boundary).
- **`bymax-notification.module`** — bootstrap-log assertions pinning the exact `channels:
  email, otp` join (separator + empty-seed) and email-only / otp-only channel lists; and the
  `forRootAsync` error messages pinned fragment-by-fragment.
- **`default-template-renderer`** — whitespace-inside-braces interpolation (`{{ name }}`);
  the default `['en']` fallback chain; the requested-locale dedup in the not-found `tried=`
  list; rejection of a string-index nested path; and rejection of a callable (function)
  template carrying string `subject`/`html`.
- **`validate-options` / `resolved-options` / `notification-audit.interceptor`** — a non-string
  `defaultFrom` pinned to the exact message; `'key' in obj` absence checks for omitted optional
  email fields; and a function-arg carrying dispatch-shaped props rejected by the `typeof value
  !== 'object'` guard.

---

## Surviving mutants — every survivor is a provable equivalent

All 16 survivors are genuinely equivalent: **no test can distinguish the mutant from the
original**. Each is listed below with its proof. Where the mutator could be suppressed inline
without collateral, it already is (see § Inline-annotated equivalents). The survivors below are
**not** inline-suppressed for a specific reason: each shares its exact token/operator with a
*killed* sibling mutant on the same line, so a line-level `// Stryker disable` would also ignore
a mutant that a real test kills — which is forbidden (it would un-credit a passing test). They
are therefore documented here instead, which is the honest accounting.

| # | File · line | Mutator | Mutation | Why no test can kill it |
|---|---|---|---|---|
| 1–6 | `react/useOtpInput.ts` L50/L52/L54 | Regex | `^`/`$` anchor removal on the per-character class (`/^[A-Za-z]$/`, `/^[A-Za-z0-9]$/`, `/^[0-9]$/`) | `isValidChar` only ever receives a **single character** (`applyChange` returns early for length > 1; `filterValid` iterates one code point at a time), and for a one-character string `^X$ ≡ X ≡ ^X ≡ X$`. The anchors cannot change any reachable result. |
| 7 | `react/useOtpInput.ts` L65 | ConditionalExpression | `type === 'numeric'` → `false` in `normalizeChar` (always `char.toUpperCase()`) | When `type === 'numeric'` the character is always a digit (validated upstream), and `'0'…'9'.toUpperCase()` is the identity — so always-uppercasing yields identical output. |
| 8 | `react/useOtpInput.ts` L121 | ConditionalExpression | `rawValue.length > 1` → `false` (removes the multi-char early return) | The very next guard `!isValidChar(rawValue)` rejects every multi-character string anyway (single-char anchored match), so removing the length early-return changes no observable outcome. |
| 9 | `react/useOtpInput.ts` L138 | ConditionalExpression | `index > 0` → `true` in the Backspace guard | The guard only matters at `index === 0`; there `replaceAt(values, -1, '')` returns an identical-content array and `focus(-1)` is a no-op (`focusSlot` returns for `index < 0`), so the branch is observationally inert. |
| 10 | `react/useOtpInput.ts` L138 | EqualityOperator | `index > 0` → `index >= 0` (same Backspace guard) | Differs only at `index === 0`, where (as above) the executed branch is a pair of no-ops — identical to skipping it. |
| 11 | `react/useOtpInput.ts` L154 | Regex | `/[\s-]+/g` → `/[\s-]/g` (drops the `+` quantifier) | A global replace of each whitespace/dash with `''` removes the same characters whether matched one-at-a-time or in runs; the resulting string is byte-identical. |
| 12 | `react/useOtpInput.ts` L203 | ConditionalExpression | `prev.length === length ? prev : resize(...)` → `false` (always resize) | The effect runs only on mount and on `length` change; when `prev.length === length` (mount), `resizeValues(prev, length)` returns an array with **identical content** — the only difference is referential, invisible to any value assertion. |
| 13 | `react/useOtpCountdown.ts` L43 | ConditionalExpression | `totalSeconds <= 0` → `false` in `formatTime` (skips the early `'00:00'`) | `totalSeconds` is the clamped (`>= 0`) remaining count, so the only live case is exactly `0`; the fall-through then pads `0h/0m/0s` to `'00:00'` — identical to the early return. (Its `BlockStatement` and `EqualityOperator` siblings are inline-suppressed; the `ConditionalExpression → false` shares the line with a *killed* `→ true` sibling, so it is documented here.) |
| 14 | `server/utils/cooldown-helpers.ts` L84 | ConditionalExpression | `seconds > 0 \|\| parts.length === 0` → `seconds > 0` (drops the 2nd operand) | Past the `<= 0` early return, `totalSeconds >= 1`; whenever `seconds === 0` (so the 2nd operand would be evaluated) there must be an `h`/`m` part, making `parts.length === 0` always `false` at that point — the operand is unreachable as the deciding factor. |
| 15 | `server/providers/default-template-renderer.ts` L175 | ConditionalExpression | `current === undefined` → `false` in `resolveNested` (drops the undefined check) | The sibling `typeof current !== 'object'` operand is `true` for `undefined` (`typeof undefined === 'undefined'`), so it already returns; `A \|\| undefined-check \|\| typeof-check` and `A \|\| false \|\| typeof-check` are equal for every input. |
| 16 | `server/services/email.service.ts` L182 | ConditionalExpression | `typeof content === 'string'` → `true` (always `Buffer.byteLength(content)`) | The only non-string `content` type is `Buffer` (per `EmailAttachment`), and `Buffer.byteLength(buf) === buf.length` — so always taking the byte-length branch yields the identical size for both arms. |

### Inline-annotated equivalents

These equivalents **can** be suppressed inline without collateral (their mutator has no killed
sibling on the line), and are marked `// Stryker disable next-line <Mutator>: <proof>`:

- `react/useOtpInput.ts` — `BlockStatement` on the `rawValue.length > 1` guard body (same proof
  as survivor #8); `BooleanLiteral` on the `sanitizeOnPaste = true` default (`filterValid`
  already drops `[\s-]`, so sanitize-on vs -off yield identical slots).
- `react/useOtpCountdown.ts` — `EqualityOperator,BlockStatement` on the `formatTime` `<= 0`
  guard (the early return and the emptied-block fall-through both pad to `'00:00'`).
- `server/services/notification.service.ts` — `StringLiteral` on the `'generate'` action default
  (never compared with `===`; any non-`verify`/`consume` value routes identically to generate).
- `server/bymax-notification.module.ts` — `BooleanLiteral` on the async `OtpService` →
  `EmailService` `{ optional: true }` (the `EmailService` token is always registered in async
  mode as a factory resolving to `undefined`, so `optional: false` injects `undefined` rather
  than throwing — the flag is observationally inert).
- Pre-existing (carried from the prior pass): the Redis cooldown `ttl > 0` vs `ttl >= 0`
  (`TTL` is never exactly `0`), the `RedisOtpStorage` Lua-script body (executed only on a real
  Redis server), and the `cooldownExpiresAt`/`formatCooldown` `<= 0` boundaries.

### Why the ceiling is 98.17% and not 100%

The honest ceiling here is **"all remaining survivors are provably equivalent"** — and it is
reached: all 16 survivors above are equivalent mutants. The residual gap to 100% is *not*
weak tests; it is the well-known fact that an equivalent mutant which shares an operator/token
with a non-equivalent (killable) sibling on the same source line cannot be inline-suppressed
without also un-crediting the test that kills the sibling. Closing it further would require
rewriting otherwise-correct source purely to reshape the mutant set, which is **not** done here
(it would be gaming). The score is raised honestly from 92.82% to 98.17%; every survivor is
accounted for above.
