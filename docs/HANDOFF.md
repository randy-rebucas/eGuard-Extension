# Handoff: where the eGuard browser extension stands

Snapshot: 2026-09-29, end of Phase 4. Read this first in a new session, then [ARCHITECTURE.md](ARCHITECTURE.md) for the design and [API.md](API.md) for the contract.

## Status

| Phase                | What                                                                                                                                                                                    | Status   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1 Foundation         | MV3 builds for Chrome/Edge/Firefox, worker, validated messaging + storage, popup, onboarding, options                                                                                   | Done     |
| 2 Pairing            | One-time browser codes, rotating refresh tokens with replay detection, "Add a browser", removal                                                                                         | Done     |
| 3 Policy             | Versioned per-child `BrowserPolicy`, parent editor (child page → Browser tab), ECDSA-signed `/policy`, `packages/policy-engine`                                                         | Done     |
| 4 Protection         | Real blocking (declarativeNetRequest), block page, Warn first/Continue, allowed-only, focus hours, SafeSearch, access requests + approval, starter category lists, private-window check | Done     |
| 5 Health             | Report health to the server, drift alerts, Safe Browsing check, force-install check, daily category counts                                                                              | **Next** |
| 6 Parent integration | Browser health in the dashboard and mobile API, capability terminology rename                                                                                                           | To do    |
| 7 Cross-browser      | Validate every capability in Chrome, Edge, Firefox; evaluate Safari                                                                                                                     | To do    |
| 8 Hardening          | Security/privacy review, performance, accessibility audit, packaging, store listings                                                                                                    | To do    |

Nothing is claimed that isn't verified: the popup says **Protected** only when the signed policy verifies, its rules read back from the browser intact, eGuard is allowed in private windows, and sync is recent.

## Where the code is

Two repositories, side by side:

- **`~/eguard-browser`** (this repo): the extension. `apps/extension` (worker in `src/background/`, pages in `src/popup`, `onboarding`, `options`, `blocked`), `packages/schemas` (contract), `packages/browser-adapter` (browser detection, storage, capability matrix), `packages/api-client` (HTTP + tokens), `packages/policy-engine` (signature check, matching, schedules, rule compiler), `tests/e2e`.
- **`~/eguard`**: the existing Next.js parent app and API. Browser work lives in `src/lib/browser-service.ts` (pairing, tokens), `browser-policy.ts` (policy, versions, signing), `browser-access.ts` (access requests), `category-lists.ts` (starter lists), `device-slots.ts`; routes in `src/app/api/browser/v1/*` and `src/app/api/mobile/v1/{browsers,browser-access-requests,children/[id]/browser-policy,children/[id]/browser-access-requests}`; UI in `src/components/browser-policy.tsx`, `BrowserCard` in `cards.tsx`, the child page's Browser tab and the Devices page. Tests: `tests/api/browser*.test.ts`. Migrations: `browser_installations`, `browser_policies`, `browser_access_requests`.

## Running everything locally

1. **Database and mail** (`~/eguard`): `docker compose up -d` gives Postgres on port **55433** (`eguard-db`) and Mailpit on 1025/8025.
2. **Signing keys:** already in place for development. The private key is in `~/eguard/.env.local` (gitignored, created for this work); the public key is `VITE_POLICY_PUBLIC_KEY` in `~/eguard-browser/.env`. To make a new pair: `node scripts/browser-policy-keys.mjs` in `~/eguard`, then update both files.
3. **Server for development and tests:** `~/eguard/.env` points email at a **real** provider. Never run the API tests against that. Start the server with process-only overrides instead (PowerShell):

   ```powershell
   $env:SMTP_URL="smtp://localhost:1025"; $env:RESEND_API_KEY=""; $env:CRON_SECRET="test-cron-secret"
   $env:RATE_LIMIT_IP_ALLOWLIST="::1,127.0.0.1,::ffff:127.0.0.1"
   npx next dev -p 3217
   ```

   Port 3100 is taken by another app; eGuard uses **3217**. Stop the dev server before `prisma migrate dev`, or client generation fails on a locked DLL.

4. **Extension:** in `~/eguard-browser`, `npm install`, then `npm run build` (dist/chrome, dist/edge, dist/firefox) or `npm run dev` (watch Chrome). Load `dist/chrome` unpacked, or `dist/firefox/manifest.json` as a temporary add-on.

## Tests

| Where                            | Command                                                                                                                    | Notes                                                                                                                                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Extension unit (117)             | `npm test`                                                                                                                 |                                                                                                                                                                                                                                                             |
| Extension E2E, mock backend (15) | `npm run test:e2e`                                                                                                         | Playwright's Chromium (branded Chrome 137+ ignores `--load-extension`). Test sites are `http://<name>.example:3299/` via `--host-resolver-rules`.                                                                                                           |
| Extension E2E, real server (1)   | `$env:EGUARD_API_URL="http://localhost:3217"; npx playwright test real-backend`                                            | Needs the server started as above. Pairs, edits policy, blocks, requests, approves, removes.                                                                                                                                                                |
| Design screenshots               | `$env:SCREENS_DIR="<folder>"; npx playwright test screens`                                                                 | Opt-in.                                                                                                                                                                                                                                                     |
| Server API (178)                 | `$env:API_BASE_URL="http://localhost:3217"; npx vitest run --config vitest.api.config.ts` in `~/eguard`                    | **5 failures are pre-existing and unrelated** (verification.test pairing codes ×3 + location, security "app usage on two devices"): those tests assume more devices/location than the Free plan allows. They fail identically on the code before this work. |
| Lint/types                       | `npm run lint`, `npm run typecheck` (both repos: `npx eslint`, `npx tsc --noEmit` in `~/eguard`, after `npx next typegen`) |                                                                                                                                                                                                                                                             |

## Gotchas

- `~/eguard` files mix CRLF and LF: multi-line search/replace from scripts silently misses. Use an editor or exact-match tooling.
- `docs/BROWSER-CAPABILITIES.md`'s table is generated (`node scripts/sync-capability-doc.ts`) and ignored by Prettier; a test compares it byte for byte.
- Signed payloads: never add Zod defaults/transforms that change policy values in `packages/schemas/src/policy.ts`; the signature is checked over the parsed object. `canonicalJson` must stay identical in both repos (both test the same vector).
- Next.js skips `.env.local` when `NODE_ENV=test`; `tests/api/browser-policy.test.ts` reads the key file itself.
- TypeScript is pinned to ~5.9 in this repo (typescript-eslint doesn't support TS 7 yet).
- The web app's `--ink-3` (#62769A) is 4.37:1 on its background, below WCAG AA; the extension uses #5A6E92. Not changed in `~/eguard`.

## Decisions still open (product owner)

1. **Category list source.** `~/eguard/src/lib/category-lists.ts` is a hand-picked starter set (about 10 sites per category; none for violence, drugs, weapons, hate, downloads; malware/phishing left to the browser). Options: open-licensed lists (e.g. UT1 Toulouse, CC-BY-SA), a commercial classification feed, or curated lists. Only that module changes; if lists grow past a few thousand domains, move them out of the policy into a separate signed, versioned download.
2. **Capability terms.** The web app/mobile API use `AVAILABLE`/`VERIFY_ONLY`; the spec wants `AUTOMATIC`/`VERIFICATION_ONLY` everywhere. Recommended: change labels now, wire values with a coordinated app release.
3. Already applied without explicit confirmation: browsers count toward the plan's device limit; a browser belongs to a child with a parent-typed computer name (not a `Device`).

## Next: Phase 5 (health), concrete tasks

1. **Server `POST /api/browser/v1/health`**: model `BrowserHealthCheck` (see API.md "Database changes"), store `{ policyVersion, checks: [{ id, status }] }`, keep `BrowserInstallation.appliedPolicyVersion` and `protectionState`. Raise/resolve alerts with `resolveKey` like `processReport` in `src/lib/engine.ts`: "Browser protection changed" (drift: applied version < current, or rules not verified), "eGuard can't verify this browser" after 24 h silence (reuse `OFFLINE_AFTER_MS`, add to the maintenance cron), private windows not allowed.
2. **Extension**: after each `enforce()`/health check, send the checks: `policy_signature`, `rules_installed`, `private_windows`, `sync_fresh`, `safe_browsing` (Chrome: add the `privacy` permission and read `chrome.privacy.services.safeBrowsingEnabled`; Edge/Firefox: `UNSUPPORTED` verification, guided text), `force_installed` (`management.getSelf().installType === "admin"`, no permission needed). Show a health list in the popup/options with per-check guidance (spec §13).
3. **Daily category counts** (`POST /api/browser/v1/events`, model `BrowserEventDaily`): count blocks per category per day in `storage.local`, send once a day, no domains. Update PRIVACY.md and the options page (they currently say nothing is counted).
4. Retention: delete old health rows and counts after `Family.retentionDays` in the maintenance job.

Then Phase 6: a browser health card on the child page and dashboard (spec §25), alerts in the notification centre, browsers in the mobile API's device views, and the terminology rename. Phase 7: `web-ext` runs for Firefox, manual Edge run, validate each matrix cell and set `validated: true` in `packages/browser-adapter/src/capabilities.ts`. Phase 8: see [RELEASE.md](RELEASE.md) (production signing keys, AMO `data_collection_permissions`, store permission justifications, bundle size: the shared UI chunk is ~325 KB).

## Starting a new session

Suggested first message: _"Continue the eGuard browser extension from ~/eguard-browser/docs/HANDOFF.md: start Phase 5 (health)."_
