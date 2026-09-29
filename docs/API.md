# Browser API (`/api/browser/v1`) and backend changes

The contract between the extension and the eGuard backend (`~/eguard`). Zod schemas: [packages/schemas/src/api.ts](../packages/schemas/src/api.ts), [policy.ts](../packages/schemas/src/policy.ts).

**Implemented in `~/eguard`:** `POST /pair`, `POST /token`, `GET /policy` (signed), `POST/GET /access-requests`, and for parents `GET/DELETE /api/mobile/v1/browsers[/:id]`, browser codes from `POST /api/mobile/v1/children/:id/pairing-code`, `GET/PUT /api/mobile/v1/children/:id/browser-policy`, `GET /api/mobile/v1/children/:id/browser-access-requests` and `POST /api/mobile/v1/browser-access-requests/:id` (plus the **Browser** tab on the web child page). Server code: `src/lib/browser-service.ts`, `browser-policy.ts`, `browser-access.ts`, `category-lists.ts`, `src/app/api/browser/v1/*`; tests: `tests/api/browser*.test.ts`. `POST /health` and `POST /events` (Phase 5): `src/lib/browser-health.ts`, tests in `tests/api/browser-health.test.ts`.

Conventions match `/api/device/v1` and `/api/mobile/v1`: JSON, HTTPS, errors as `{ "error": "<parent-safe text>", "code": "<machine code>" }`, `X-eGuard-Client: chrome-extension | edge-extension | firefox-extension`.

## Authentication

| Credential    | Lifetime                                | Stored in the extension    | Stored on the server                           |
| ------------- | --------------------------------------- | -------------------------- | ---------------------------------------------- |
| Pairing code  | minutes, single use                     | never (typed once)         | `PairingCode` (existing)                       |
| Refresh token | until revoked; **rotates on every use** | `storage.local`            | SHA-256 hash on `BrowserInstallation`          |
| Access token  | 15 minutes; replaced on every refresh   | `storage.session` (memory) | SHA-256 hash + expiry on `BrowserInstallation` |

Tokens are 32 random bytes (base64url). Storing access tokens hashed, rather than signing them, needs no server secret and makes revocation immediate; the lookup is one indexed read, like device tokens.

- **Reuse detection:** the server also keeps the hash of the previous refresh token. If a rotated-out token is presented again more than **2 minutes** after the rotation, someone copied it: the installation is disconnected (`revokedAt`, all hashes cleared), the family gets an `ACTION_REQUIRED` alert "Browser disconnected for security", and `AuditLog browser.token.reuse_detected` is written. Within 2 minutes it is treated as a retry after a lost response and gets fresh tokens (the window is measured from the original rotation, so retries can't extend it).
- **Removal:** a parent removes the browser (password required) → the row is deleted → its tokens return 401 → the extension forgets its connection on its next check.
- Every authenticated request resolves **installation → child → family** from the token alone. The extension never sends a child, family or device id that the server trusts; a browser can't ask for another family's policy because there's no parameter to ask with.

## Endpoints

### `POST /pair` (public, rate-limited per IP like `/api/device/v1/pair`)

```json
{
  "code": "824917",
  "browser": "Chrome",
  "browserVersion": "153.0.0.0",
  "extensionVersion": "0.1.0",
  "platform": "mac"
}
```

`201`:

```json
{
  "installationId": "bi_…",
  "familyName": "Cruz family",
  "childName": "Mia",
  "deviceName": "Mia's MacBook",
  "accessToken": "…",
  "accessTokenExpiresAt": "2026-09-29T10:15:00Z",
  "refreshToken": "…"
}
```

`400 invalid_code` (unknown, used, expired or malformed) · `400 wrong_code_kind` (a phone-app code; `/api/device/v1/pair` likewise refuses browser codes) · `409 device_limit` · `429 rate_limited` (shares the per-address budget with device pairing). Claims the code atomically, gives it back if the plan is full, alerts the family "Browser connected" and writes `AuditLog browser.paired`.

Parents get a browser code with `POST /api/mobile/v1/children/:id/pairing-code` and body `{ "kind": "BROWSER", "deviceLabel": "Mia's MacBook" }` (no body = phone code, as before), or on the web Devices page under **Add a browser**. As with phone codes, only the newest code per child works, codes last 15 minutes, and connected browsers count toward the plan's device limit.

### `POST /token`

`{ "installationId", "refreshToken" }` → `200 { accessToken, accessTokenExpiresAt, refreshToken }` · `401` revoked/unknown/reused.

### `GET /policy` (Bearer)

`200 { "policy": BrowserProtectionPolicy, "signature": "<base64>", "keyId": "<16 hex>" }` · `401` for a removed browser · `503 signing_not_configured` if the server has no signing key (the extension keeps its last policy).

- `policy` is the child's current policy (created with age-based defaults the first time), with `installationId` set to the caller's and `schedule.timezone` set to the family's time zone.
- `signature` is **ECDSA P-256 with SHA-256**, raw `r‖s` (64 bytes, IEEE P1363, what WebCrypto produces and verifies), over the UTF-8 **canonical JSON** of `policy`: object keys sorted at every level, arrays in order, no whitespace. Both repos test the same canonicalisation vector. P-256 rather than Ed25519 because WebCrypto only gained Ed25519 in Chrome 137 and the extension supports Chrome 120+.
- `keyId` is the first 16 hex characters of SHA-256 of the public key (SPKI DER), for diagnostics and rotation.
- The extension verifies with the public key built in at build time (`VITE_POLICY_PUBLIC_KEY`), when the policy arrives **and every time it reads it from storage**. A policy that fails is refused (on arrival) or discarded and downloaded again (from storage); it is never enforced or shown. The private key is the server's `BROWSER_POLICY_SIGNING_KEY`; generate the pair with `node scripts/browser-policy-keys.mjs` in `~/eguard`. Rotating it means shipping an extension update with the new public key before switching the server.
- Not yet: `If-None-Match` → `304`. The body is small and the poll is every 5 minutes, so it waits for real load data.

### `POST /health` (Bearer)

The extension's own checks, each with a `CheckStatus`, the state the popup shows, and the policy version it enforces. Sent after pairing, whenever the result changes (checked every 5 minutes), at least hourly, and when someone presses **Run health check**:

```json
{
  "state": "NEEDS_ATTENTION",
  "policyVersion": 42,
  "checks": [
    { "id": "policy_signature", "status": "PASS" },
    { "id": "rules_installed", "status": "PASS" },
    { "id": "private_windows", "status": "WARNING" },
    { "id": "sync_fresh", "status": "PASS" },
    { "id": "safe_browsing", "status": "PASS" },
    { "id": "force_installed", "status": "NOT_CONFIGURED" }
  ]
}
```

`200 { ok: true, score, total }` (passing checks out of those that apply; `UNSUPPORTED` and `NOT_CONFIGURED` don't count) · `400 invalid_report` · `401` · `429` after 60 reports an hour. Unknown check ids are dropped, so a newer extension can add checks.

| Check              | PASS                                          | Otherwise                                                                                                                  |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `policy_signature` | a stored policy verifies                      | `ACTION_REQUIRED`: none yet, or the stored one was discarded                                                               |
| `rules_installed`  | the browser's rules read back exactly         | `ACTION_REQUIRED`; `NOT_CONFIGURED` before the first policy                                                                |
| `private_windows`  | allowed in private windows                    | `WARNING` (not allowed, with the browser's steps); `UNSUPPORTED` if the browser can't say                                  |
| `sync_fresh`       | synced in the last day, eGuard reachable      | `WARNING`                                                                                                                  |
| `safe_browsing`    | Chrome's Safe Browsing on                     | `ACTION_REQUIRED` (off and held by something else); `NOT_CONFIGURED` (family turned it off); `UNSUPPORTED` in Edge/Firefox |
| `force_installed`  | `management.getSelf().installType` is `admin` | `NOT_CONFIGURED` (can be removed; guidance names the browser policy); `UNSUPPORTED` if unknown                             |

The server stores each report (`BrowserHealthCheck`), sets `BrowserInstallation.protectionState` / `appliedPolicyVersion` / `lastHealthAt`, and raises or resolves `ATTENTION` alerts (category `PROTECTION`), each once while it lasts:

| resolveKey                   | Raised when                                                                                                                                                               | Resolved when                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `BROWSER_DRIFT:<id>`         | "Browser protection changed": `rules_installed` fails, or `policyVersion` is below the current one more than 15 minutes after the change (a change in flight isn't drift) | a report on the current version with rules in place |
| `BROWSER_PRIVATE:<id>`       | "Private windows aren't protected": `private_windows` is `WARNING`                                                                                                        | it passes                                           |
| `BROWSER_SAFE_BROWSING:<id>` | "Malware and phishing protection is off": `safe_browsing` is `ACTION_REQUIRED`                                                                                            | any other status                                    |
| `BROWSER_OFFLINE:<id>`       | "eGuard can't verify this browser" (category `DEVICES`): no contact for 24 hours (`OFFLINE_AFTER_MS`), raised by the maintenance job                                      | any authenticated request                           |

Removing the browser resolves all of them. The web app's alert button opens the child's Browser tab.

### `POST /access-requests`, `GET /access-requests` (Bearer)

`POST { "domain": "www.roblox.com", "reason": "School project" }` (the host the child tried; `reason` optional, up to 280 characters) → `201 { request }`, or `200` with the open request if one is already pending for that site. `400 invalid_domain` · `429` after 10 new requests an hour from one browser. Creates an `ATTENTION` alert "Website access request" (`resolveKey WEBREQ:<id>`, its action opens the child's Browser tab). `GET` returns this browser's last 20 requests: `{ requests: [{ id, domain, reason, status: PENDING|APPROVED|DENIED, duration, expiresAt, createdAt, decidedAt }] }`, which the block page uses for "waiting for a parent" / "a parent said no".

Parents answer with `POST /api/mobile/v1/browser-access-requests/:id` `{ "decision": "APPROVE", "duration": "15M" | "1H" | "TODAY" | "ALWAYS" }` or `{ "decision": "DENY" }` (or on the web Browser tab). `409 already_decided` for a second answer. Approval is a **new policy version**: `ALWAYS` adds the site to `allowedDomains` (and removes it from `blockedDomains`); the others add `{ domain, until }` to the policy's `temporaryAllows` (`TODAY` = midnight in the family's time zone). Expired entries are ignored by the extension and dropped on the next change. Audit: `browser.access.approved` / `browser.access.denied`.

**Policy fields added in Phase 4** (inside the signed policy): `temporaryAllows: [{ domain, until }]` (only unexpired ones are sent) and `categoryDomains: { <CATEGORY>: [domains] }` for the categories this family blocks. The lists come from `src/lib/category-lists.ts`, a small **starter set** of well-known sites per category, meant to be replaced by a maintained feed. Malware and phishing have no list; they're left to the browser's own protection (Safe Browsing / SmartScreen).

### `POST /events` (Bearer)

Aggregated counts only: `{ "date": "2026-09-28", "blocked": { "GAMING": 3, "ADULT": 1, "BLOCKED_SITE": 2 } }`. Keys are a category or a reason (`BLOCKED_SITE`, `UNKNOWN_SITE`, `FOCUS_HOURS`, pattern `^[A-Z][A-Z_]{1,31}$`, at most 24); no URLs, domains or timestamps finer than a day. `date` is the day in the family's time zone (the policy's `schedule.timezone`, else the browser's). The extension sends each finished day once; sending a day again replaces its counts. `200 { ok, date, categories }` · `400 invalid_report` · `400 invalid_date` (not a date, in the future beyond a day's slack, or older than 14 days; the extension drops such a day) · `429` after 30 an hour.

## Database changes

All of these are built (migrations `browser_installations`, `browser_policies`, `browser_access_requests`, `browser_health`); `~/eguard/prisma/schema.prisma` is authoritative and differs in details from the sketch below (for example `BrowserInstallation` also holds the access-token hash and `lastHealthAt`, and `BrowserHealthCheck` stores the reported `state`). They reuse `Family`, `Child`, `Alert`, `AuditLog` and `RateLimit`:

```prisma
enum PairingKind { DEVICE BROWSER }

// PairingCode gains: kind PairingKind @default(DEVICE), deviceLabel String?
// /api/device/v1/pair must reject BROWSER codes, and /api/browser/v1/pair DEVICE codes.

model BrowserInstallation {
  id                   String    @id @default(cuid())
  familyId             String
  family               Family    @relation(fields: [familyId], references: [id], onDelete: Cascade)
  childId              String
  child                Child     @relation(fields: [childId], references: [id], onDelete: Cascade)
  deviceLabel          String    // entered by the parent ("Mia's MacBook"); nothing read from the machine
  browser              String    // Chrome | Edge | Firefox | …
  browserVersion       String?
  extensionVersion     String
  platform             String    // runtime.getPlatformInfo().os: win | mac | linux | cros
  refreshTokenHash     String?   @unique
  prevRefreshTokenHash String?   @unique // reuse detection
  protectionState      String    @default("ACTION_REQUIRED") // ProtectionState
  appliedPolicyVersion Int?
  lastSeenAt           DateTime?
  revokedAt            DateTime?
  createdAt            DateTime  @default(now())

  healthChecks   BrowserHealthCheck[]
  accessRequests BrowserAccessRequest[]
  dailyEvents    BrowserEventDaily[]
  @@index([familyId])
  @@index([childId])
}

/// The family's web policy for one child, shared by all of that child's browsers.
model BrowserPolicy {
  id                 String   @id @default(cuid())
  childId            String   @unique
  child              Child    @relation(fields: [childId], references: [id], onDelete: Cascade)
  version            Int      @default(1)
  safeBrowsing       Boolean  @default(true)
  safeSearch         Boolean  @default(true)
  blockedCategories  String[]
  blockedDomains     String[]
  allowedDomains     String[]
  unknownSitesPolicy String   @default("ALLOW")
  schedule           Json?
  updatedBy          String
  updatedAt          DateTime @updatedAt
  versions           BrowserPolicyVersion[]
}

/// Immutable snapshot per version: audit trail and "what was in force when".
model BrowserPolicyVersion {
  id        String        @id @default(cuid())
  policyId  String
  policy    BrowserPolicy @relation(fields: [policyId], references: [id], onDelete: Cascade)
  version   Int
  snapshot  Json
  createdBy String
  createdAt DateTime      @default(now())
  @@unique([policyId, version])
}

model BrowserHealthCheck {
  id             String              @id @default(cuid())
  installationId String
  installation   BrowserInstallation @relation(fields: [installationId], references: [id], onDelete: Cascade)
  policyVersion  Int?
  checks         Json                // [{ id, status }]
  score          Int
  total          Int
  createdAt      DateTime            @default(now())
  @@index([installationId, createdAt])
}

model BrowserAccessRequest {
  id             String              @id @default(cuid())
  installationId String
  installation   BrowserInstallation @relation(fields: [installationId], references: [id], onDelete: Cascade)
  childId        String
  domain         String
  category       String?
  reason         String?
  status         String              @default("PENDING") // PENDING | APPROVED | DENIED | EXPIRED
  duration       String?             // 15M | 1H | TODAY | ALWAYS
  expiresAt      DateTime?
  decidedBy      String?
  decidedAt      DateTime?
  createdAt      DateTime            @default(now())
  @@index([childId, status])
}

/// Aggregated only: how many sites of a category were blocked on a day. Never a URL or domain.
model BrowserEventDaily {
  installationId String
  installation   BrowserInstallation @relation(fields: [installationId], references: [id], onDelete: Cascade)
  date           DateTime            @db.Date
  category       String
  blockedCount   Int
  @@id([installationId, date, category])
}
```

Browser alerts use the existing `PROTECTION` and `DEVICES` categories; a separate `WEB` category would be a mobile-API enum change to coordinate with the apps (Phase 6). The maintenance cron deletes `BrowserHealthCheck` and `BrowserEventDaily` rows older than `Family.retentionDays`.

## Authorization chain

Every browser endpoint: bearer → installation (not revoked) → child → family. Every parent endpoint that touches browsers: session → user → family membership → child belongs to family → installation belongs to child. Parent-side changes write `AuditLog`:

`browser.paired` · `browser.removed` · `browser.policy.updated (v42→v43)` · `browser.access.approved example.com (1h)` · `browser.access.denied example.com` · `browser.token.reuse_detected`.
