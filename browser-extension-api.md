# eGuard Browser Extension API — v1

The API the eGuard browser extension calls from the child's computer. Parents manage browsers, policies and access
requests through the [Parent Mobile API](mobile-api.md#part-b-parent-api) (§P4.6 "Browser codes", §P4.12); this page covers only the
extension's side.

- **Base URL:** `https://www.eguard.family/api/browser/v1`
- **Format:** JSON in and out, UTF-8. Every response has `Cache-Control: no-store`.
- **Contract:** the Zod schemas in the extension repo (`eguard-browser/packages/schemas/src/api.ts` and `policy.ts`)
  are the wire contract. Its `docs/API.md` covers the design and database notes; this page is the endpoint reference.

---

## Contents

1. [Conventions](#1-conventions)
2. [Endpoints](#2-endpoints)
   - [Pair](#post-pair) · [Token](#post-token) · [Policy](#get-policy) · [Access requests](#access-requests) · [Health](#post-health) · [Events](#post-events)
3. [Flows](#3-flows)
4. [What parents see](#4-what-parents-see)
5. [Server setup](#5-server-setup)

---

## 1. Conventions

### Credentials

No parent credential ever reaches the child's browser. The extension holds an **installation**, created by pairing:

| Credential | Lifetime | Use |
|---|---|---|
| `installationId` | Until the parent removes the browser | Sent with the refresh token |
| `accessToken` | **15 minutes** (`accessTokenExpiresAt`) | `Authorization: Bearer <accessToken>` on every call except `/pair` and `/token` |
| `refreshToken` | Until it is used once | Exchanged at `POST /token` for a new access token **and a new refresh token** |

- Keep `installationId` and `refreshToken` in `storage.local`, and the access token in `storage.session` (memory
  only). Never use `storage.sync`: the credentials belong to this browser.
- Tokens are 32 random bytes, base64url (43 characters). The server stores only their SHA-256 hashes.
- The extension never sends a child, family or device ID: the server works out installation → child → family from
  the token alone.
- **Refresh tokens rotate on every use.** Save the new refresh token before you do anything else with the response.
- **Refresh one at a time.** If two refreshes run at once with the same token, only the last response stays valid.
  Wrap `POST /token` in a single-flight promise shared by the whole service worker.
- The server sends no CORS headers. The extension needs host permission for the API origin in its manifest
  (`"host_permissions": ["https://www.eguard.family/*"]`).

### Headers

| Header | When | Value |
|---|---|---|
| `Authorization` | every call except `/pair` and `/token` | `Bearer <accessToken>` |
| `Content-Type` | requests with a body | `application/json` |
| `X-eGuard-Client` | every call (recommended) | `chrome-extension`, `edge-extension` or `firefox-extension`. Not read by the server yet |

### Errors

Every error has the same shape. `error` is written for a person and is safe to show on the extension's pages.

```json
{ "error": "This browser is no longer connected to eGuard.", "code": "unauthorized" }
```

| Status | `code` | Meaning / what the extension should do |
|---|---|---|
| 400 | `invalid_code`, `wrong_code_kind` | Pairing: the code is wrong, used, expired, replaced, or is a phone-app code |
| 400 | `invalid_domain`, `invalid_report`, `invalid_date` | The body wasn't accepted. Don't retry the same body |
| 401 | `unauthorized` | Access token expired, or the browser was removed or disconnected. See [Handling 401](#handling-401) |
| 409 | `device_limit` | Pairing: the family's plan has no free device slots |
| 429 | `rate_limited` | Too many requests. Back off and try later |
| 503 | `signing_not_configured` | The server can't sign policies. Keep enforcing the last verified policy and retry later |
| 500 | `server_error` | Unexpected. Retry with backoff |

### Handling 401

A `401` from any authenticated endpoint means one of two things. Tell them apart by refreshing:

1. Call `POST /token` once (single-flight).
2. If it succeeds, repeat the original request with the new access token.
3. If `/token` also returns `401`, the browser is no longer connected: the parent removed it, or eGuard disconnected it
   because its refresh token was used from two places. Clear the stored credentials and show the setup page, which
   asks for a new code.

Before a call, you can refresh early when `accessTokenExpiresAt` is less than a minute away; that saves a round trip.

### Check-ins

Any authenticated request counts as a check-in (the server updates `lastSeenAt` at most once a minute), and so does
a successful `POST /token`. A browser that doesn't check in for **24 hours** raises an "eGuard can't verify this
browser" alert for the family. The next check-in resolves it.

### Data types

- **IDs** are opaque strings. Don't parse them.
- **Timestamps** are ISO-8601 UTC (`2026-09-29T06:04:18.000Z`).
- **Calendar days** (`/events`) are `YYYY-MM-DD` in the **family's** time zone, which the policy's `schedule.timezone`
  carries when focus hours are set.
- **Domains** are lowercase host names without a scheme, port, path or leading `*.` (`www.youtube.com`). **A rule for
  a domain also covers its subdomains**: `facebook.com` covers `m.facebook.com`.

---

## 2. Endpoints

### `POST /pair`

**No auth.** Exchanges the one-time code the parent got from "Add a browser" for an installation.

| Field | Type | Rules |
|---|---|---|
| `code` | string | 6–12 characters after removing spaces and dashes. Case doesn't matter: `abcd-2345` works |
| `browser` | string | 1–40 chars, e.g. `Chrome`, `Edge`. Shown to parents as "Chrome on Mia's MacBook" |
| `browserVersion` | string \| `null` | ≤ 40 chars |
| `extensionVersion` | string | 1–20 chars, e.g. `0.1.0` |
| `platform` | string | 1–40 chars, e.g. `mac`, `win`, `cros` (`chrome.runtime.getPlatformInfo().os`) |

```json
{ "code": "FJZM-7J7H", "browser": "Chrome", "browserVersion": "153.0.0.0", "extensionVersion": "0.1.0", "platform": "mac" }
```

Response `201`:

```json
{
  "installationId": "cmuk2a1b40003qz8x1c9e7h2d",
  "familyName": "Cruz Family",
  "childName": "Mia",
  "deviceName": "Mia's MacBook",
  "accessToken": "<43 chars>",
  "accessTokenExpiresAt": "2026-09-29T06:19:18.000Z",
  "refreshToken": "<43 chars>"
}
```

Show "Connected for Mia on Mia's MacBook" using `childName` and `deviceName` (the name the parent gave the computer).
Then fetch the policy straight away.

- Codes are 8 characters, single use, and valid for 15 minutes. Only the child's newest browser code works (a device code for the phone app can be live at the same time).
- A malformed body gets the same `400 invalid_code` as a wrong code, with no detail.
- `400 wrong_code_kind`: the parent typed a phone-app code. Show `error`, which tells them to choose "Add a browser".
- `409 device_limit`: the code isn't used up, so the parent can remove a device and then use the same code.
- `429 rate_limited`: more than 20 attempts in 15 minutes from one IP address. This limit is shared with phone pairing.
- Pairing adds a "Browser connected" alert for the family.

### `POST /token`

**No auth.** Rotates the refresh token and issues a new 15-minute access token.

```json
{ "installationId": "cmuk2a1b40003qz8x1c9e7h2d", "refreshToken": "<current refresh token>" }
```

Response `200`:

```json
{ "accessToken": "<43 chars>", "accessTokenExpiresAt": "2026-09-29T06:34:18.000Z", "refreshToken": "<43 chars>" }
```

The old refresh token and the old access token stop working.

**Replay detection.** The server remembers the previous refresh token:

| The extension sends | Result |
|---|---|
| The current refresh token | Normal rotation |
| The previous one, **within 2 minutes** of the rotation | Fresh tokens. Covers a lost response: the server rotated, but the extension never saw the reply. The 2 minutes count from the original rotation and aren't extended by retries |
| The previous one, **after 2 minutes** | Someone copied the token. The installation is **disconnected**, the family gets an `ACTION_REQUIRED` alert "Browser disconnected for security", and the response is `401` |
| Anything else, or a malformed body | `401` |

`429 rate_limited` after 30 requests in 15 minutes from one IP address.

### `GET /policy`

The child's browser policy, signed by eGuard. One policy per child, shared by all of that child's browsers.

Response `200`:

```json
{
  "policy": {
    "id": "cmuk29zq70001qz8xk3v1m0aa",
    "childId": "cmujeom2c0006ncgsd9tlg8pp",
    "installationId": "cmuk2a1b40003qz8x1c9e7h2d",
    "version": 4,
    "safeBrowsing": true,
    "safeSearch": true,
    "blockedCategories": ["ADULT", "DATING", "DRUGS", "GAMBLING", "HATE", "MALWARE", "PHISHING", "VIOLENCE", "WEAPONS"],
    "blockedDomains": ["example-games.com"],
    "allowedDomains": ["khanacademy.org"],
    "unknownSitesPolicy": "ALLOW",
    "schedule": { "enabled": true, "startTime": "21:00", "endTime": "06:00", "timezone": "Asia/Manila" },
    "temporaryAllows": [ { "domain": "roblox.com", "until": "2026-09-29T07:15:00.000Z" } ],
    "categoryDomains": {
      "ADULT": ["pornhub.com", "xvideos.com", "…"],
      "GAMBLING": ["bet365.com", "pokerstars.com", "…"],
      "DATING": ["tinder.com", "bumble.com", "…"]
    },
    "updatedAt": "2026-09-29T06:59:02.114Z"
  },
  "signature": "<base64, 64 bytes>",
  "keyId": "3f9a1c0d7e2b4a65"
}
```

| Field | Notes |
|---|---|
| `version` | Goes up by one on every change: the parent's edits, approved access requests. Report it in `/health` as `policyVersion` |
| `safeBrowsing` | Keep the browser's own malware and phishing protection on (Chrome Safe Browsing, Edge SmartScreen). `MALWARE` and `PHISHING` have no domain list; this setting covers them |
| `safeSearch` | Force SafeSearch on search engines |
| `blockedCategories` | Category keys (see below), sorted |
| `blockedDomains` / `allowedDomains` | Up to 500 each, sorted, never overlapping |
| `unknownSitesPolicy` | Sites on neither list: `ALLOW`, `WARN` (show a notice first) or `BLOCK` (only the allowed list opens) |
| `schedule?` | Focus hours: while `enabled` and the local time in `timezone` is between `startTime` and `endTime` (`HH:MM`, 24 h; may cross midnight), block everything not on the allowed list. `null` when the parent never set them |
| `temporaryAllows` | Sites a parent approved for a while (from an access request). The server lists only those still in force when it signs, so **the extension must also drop each one at `until`** |
| `categoryDomains` | Domain lists for the blocked categories only. Categories without a list are left out |

Category keys: `ADULT`, `GAMBLING`, `MALWARE`, `PHISHING`, `VIOLENCE`, `DRUGS`, `WEAPONS`, `HATE`, `DATING`,
`SOCIAL_MEDIA`, `GAMING`, `STREAMING`, `SHOPPING`, `DOWNLOADS`. The category lists are **starter lists** of well-known
sites, not a complete classifier; parents are told so.

**Verify before applying**, and again every time the policy is read back from storage. If a new policy fails, refuse
it and keep enforcing the last verified one. If the stored one fails, discard it and download it again. A policy that
fails is never enforced or shown. Also refuse a policy whose `installationId` isn't yours, or whose `version` is lower
than the one you already enforce: versions only move forward.

- Algorithm: ECDSA P-256 with SHA-256. `signature` is base64 of the raw `r‖s` form (64 bytes), which is what WebCrypto
  expects.
- Signed bytes: the UTF-8 **canonical JSON** of `policy`, meaning object keys sorted at every level (arrays keep their
  order) and no whitespace. That is `JSON.stringify` of the object with its keys sorted recursively.
- Public key: SPKI DER, base64, built into the extension as `VITE_POLICY_PUBLIC_KEY`.
- `keyId`: the first 16 hex characters of SHA-256 over that SPKI DER. Use it to pick the key during a key rotation.

```ts
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}

async function verifyPolicy(res: { policy: object; signature: string }, publicKeyB64: string) {
  const der = Uint8Array.from(atob(publicKeyB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("spki", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const sig = Uint8Array.from(atob(res.signature), (c) => c.charCodeAt(0));
  const data = new TextEncoder().encode(JSON.stringify(canonical(res.policy)));
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, data);
}
```

Poll every **5 minutes**. Parents are told that changes reach the browser within 5 minutes. The first read of a
child's policy creates age-based defaults (version 1). Errors: `401`, `503 signing_not_configured`. There is no
`If-None-Match` / `304` yet.

### Access requests

When the block page blocks a site, the child can ask a parent to open it.

#### `POST /access-requests`

| Field | Type | Rules |
|---|---|---|
| `domain` | string | 1–253 chars. A URL is fine: `https://www.roblox.com/games` is stored as `www.roblox.com` |
| `reason` | string \| `null`, optional | Up to 280 chars, shown to the parent |

Response: `{ "request": Request }`. The status is `201` for a new request, or `200` when the child already has an
open request for that site (from any of their browsers); that request is returned unchanged.

```json
{
  "request": {
    "id": "cmuk3b8e2000aqz8x4r7n1p0s",
    "domain": "www.roblox.com",
    "reason": "Class project with Leo",
    "status": "PENDING",
    "duration": null,
    "expiresAt": null,
    "createdAt": "2026-09-29T07:00:11.402Z",
    "decidedAt": null,
    "decidedBy": null
  }
}
```

- A new request raises an `ATTENTION` alert "Website access request" for the parents.
- `400 invalid_domain`: not a website address.
- `429 rate_limited`: 10 new requests per hour from this browser. Asking again for an open request doesn't count.

#### `GET /access-requests`

This browser's 20 most recent requests, newest first: `{ "requests": [ Request ] }`. The block page uses this to show
"Waiting for a parent", "Approved" or "Declined".

| Field | Notes |
|---|---|
| `status` | `PENDING`, `APPROVED` or `DENIED` |
| `duration?` | On approval: `15M`, `1H`, `TODAY` (until midnight in the family's time zone) or `ALWAYS` |
| `expiresAt?` | When a timed approval ends. `null` for `ALWAYS` and for denials |
| `decidedBy?` | The parent's name |

**An approval is not permission by itself.** It becomes a new policy version: timed approvals appear in
`temporaryAllows`, and `ALWAYS` moves the site to `allowedDomains` (and off `blockedDomains`). Unblock the site only
once the signed policy includes it. When a request shows `APPROVED`, fetch `/policy` right away instead of waiting for
the next poll; that is what the block page's "Check again" button should do.

### `POST /health`

The extension's own checks and the policy version it enforces. Send it after pairing, whenever the result changes
(checked every 5 minutes), at least once an hour, and when someone presses **Run health check**.

| Field | Type | Rules |
|---|---|---|
| `state` | enum | `PROTECTED`, `NEEDS_ATTENTION`, `ACTION_REQUIRED`, `SYNC_PAUSED`, `UNSUPPORTED` |
| `policyVersion` | int \| `null` | The version the extension is enforcing. `null` before the first verified policy |
| `checks` | array, up to 20 | `{ id, status }` |

Check statuses: `PASS`, `WARNING`, `ACTION_REQUIRED`, `UNSUPPORTED`, `NOT_CONFIGURED`.

| Check `id` | `PASS` when | Otherwise | Alert for the family |
|---|---|---|---|
| `policy_signature` | A stored policy verifies | `ACTION_REQUIRED`: none yet, or the stored one was discarded | none |
| `rules_installed` | The browser's rules read back exactly | `ACTION_REQUIRED`; `NOT_CONFIGURED` before the first policy | `WARNING` / `ACTION_REQUIRED` → "Browser protection changed" |
| `private_windows` | Allowed in private windows | `WARNING` (not allowed); `UNSUPPORTED` if the browser can't say | `WARNING` / `ACTION_REQUIRED` → "Private windows aren't protected". `PASS` resolves it |
| `sync_fresh` | Synced in the last day and eGuard reachable | `WARNING` | none |
| `safe_browsing` | Chrome's Safe Browsing is on | `ACTION_REQUIRED` (off, and held by something else); `NOT_CONFIGURED` (the family turned it off); `UNSUPPORTED` in Edge and Firefox | `ACTION_REQUIRED` → "Malware and phishing protection is off". Any other status resolves it |
| `force_installed` | `management.getSelf().installType` is `admin` | `NOT_CONFIGURED` (the child can remove it); `UNSUPPORTED` if unknown | none |

- Unknown ids are dropped, not refused, so a newer extension can send checks this server doesn't know yet. If an id
  appears twice, the first one counts.
- **Drift:** if `policyVersion` is older than the child's current version for more than **15 minutes** after the change,
  the family gets "Browser protection changed". It resolves when a report shows the current version and the rules in
  place.
- Each alert is raised once and resolved by a later report, so sending the same report again is safe.

```json
{
  "state": "PROTECTED",
  "policyVersion": 4,
  "checks": [
    { "id": "policy_signature", "status": "PASS" },
    { "id": "rules_installed", "status": "PASS" },
    { "id": "private_windows", "status": "WARNING" },
    { "id": "sync_fresh", "status": "PASS" },
    { "id": "safe_browsing", "status": "PASS" },
    { "id": "force_installed", "status": "UNSUPPORTED" }
  ]
}
```

Response: `{ "ok": true, "score": 4, "total": 5 }`. `UNSUPPORTED` and `NOT_CONFIGURED` checks don't count toward
`total`. Errors: `400 invalid_report`, `429 rate_limited` (over 60 reports an hour).

### `POST /events`

How many pages were blocked on one day, per reason. **Counts only**: never send a site, a URL or a time finer than a
day.

| Field | Type | Rules |
|---|---|---|
| `date` | `YYYY-MM-DD` | A day in the family's time zone, from 14 days ago to 1 day ahead |
| `blocked` | object | Up to 24 keys, each `^[A-Z][A-Z_]{1,31}$`: a category key, or a reason (`BLOCKED_SITE`, `UNKNOWN_SITE`, `FOCUS_HOURS`). Each value is an int 0–100,000 |

```json
{ "date": "2026-09-28", "blocked": { "GAMING": 3, "ADULT": 1, "BLOCKED_SITE": 2 } }
```

Response: `{ "ok": true, "date": "2026-09-28", "categories": 3 }` (the number of non-zero keys stored).

- Send each **finished** day once. Use the policy's `schedule.timezone` for the day boundary, or the browser's own
  time zone when there is no schedule.
- Sending a day again **replaces** its counts, so retrying after a lost response is safe.
- A browser that was offline can catch up on the last two weeks. Drop any day the server refuses with `invalid_date`.
- Errors: `400 invalid_report`, `400 invalid_date` (not a real date, or outside the window), `429 rate_limited` (over
  30 reports an hour).

---

## 3. Flows

### Setup

1. After install, open the setup page and ask for the code from the parent dashboard ("Add a browser").
2. `POST /pair`. Store `installationId`, `accessToken`, `accessTokenExpiresAt` and `refreshToken`.
3. `GET /policy`, verify it, and apply it.
4. `POST /health` with the new `policyVersion`.

### Sync (every 5 minutes, and on browser start)

1. `GET /policy`, refreshing the token first if needed (see [Handling 401](#handling-401)).
2. If `version` changed and the signature verifies, rebuild the rules.
3. Run the self-checks. `POST /health` if the result changed or the last report is an hour old.
4. For each finished day not yet sent, `POST /events`.

Re-apply the rules every minute from the stored policy, whether or not a sync succeeds: focus hours start and end, and
`temporaryAllows` run out.

**Offline.** A policy never expires on the device, so protection doesn't switch off because the network did. After
24 hours without a successful sync, the popup shows *Sync paused* (the policy stays active) and the parent sees "eGuard
can't verify this browser".

### Asking for a site

1. The block page offers "Ask a parent". `POST /access-requests` with the blocked site and an optional reason.
2. Show "Waiting for a parent". Refresh `GET /access-requests` while the page is open. It has no rate limit,
   but it doesn't need to run more often than every 15–30 seconds.
3. On `APPROVED`, `GET /policy` straight away, then reload the tab once the signed policy allows the site.
4. On `DENIED`, say so; the child can ask again later.

### Disconnection

When the parent removes the browser, or eGuard disconnects it after a replayed refresh token, both the access token
and `POST /token` return `401`. Forget the connection: clear the credentials and stored policy, remove the blocking
rules, stop reporting, and show the setup page. Revocation is the only thing that removes a policy; the extension
itself has no "disconnect" button.

---

## 4. What parents see

| The extension… | Parents get |
|---|---|
| pairs | INFO alert "Browser connected" |
| sends a refresh token that was rotated out more than 2 minutes earlier | ACTION_REQUIRED "Browser disconnected for security". The browser has to be added again |
| is silent for 24 hours | "eGuard can't verify this browser" (resolved by the next check-in) |
| reports an old `policyVersion` or broken rules | "Browser protection changed" |
| reports `private_windows` failing | "Private windows aren't protected" |
| reports `safe_browsing` `ACTION_REQUIRED` | "Malware and phishing protection is off" |
| sends an access request | "Website access request", with Approve / Decline |

Connected browsers count toward the plan's device limit, the same as phones.

---

## 5. Server setup

Policies are signed with `BROWSER_POLICY_SIGNING_KEY`. Generate a key pair with:

```sh
node scripts/browser-policy-keys.mjs
```

- `BROWSER_POLICY_SIGNING_KEY` (private, base64 PKCS#8 DER) goes in the server's environment. Without it,
  `GET /policy` returns `503 signing_not_configured`.
- `VITE_POLICY_PUBLIC_KEY` (public, base64 SPKI DER) goes in the extension build's `eguard-browser/.env`.
- To rotate the key, ship an extension update that trusts the new public key **before** switching the server; use
  `keyId` to tell the keys apart.
