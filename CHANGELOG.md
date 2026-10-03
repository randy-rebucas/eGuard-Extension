# Changelog

All notable changes to the eGuard browser extension. Versions match `apps/extension/package.json` and the store
uploads in `release/`.

## Unreleased

Fixes from the 2026-10-03 audit. No new permissions and no new data collected.

### Security

- **"Continue" on a Warn-first site opened far more than that site.** The temporary allow rule used
  `requestDomains`, which also matches every subdomain, at the top allow priority. Continue on `http://com/` (a host
  no list mentions, so it only warns) opened every .com site for 30 minutes, blocked sites and categories included;
  Continue on `school.example` opened a blocked `games.school.example`. The rule now matches that exact host only
  (any port and path), and a Continue ends as soon as the policy no longer just warns about the site (a parent blocks
  it, focus hours start). (`apps/extension/src/background/enforcement.ts`)
- **A stored policy that failed verification removed every rule.** The extension discarded it (correct) and then
  installed an empty rule set, so protection was off until a genuine policy arrived. That made the documented key
  rotation (ship the new key first) switch protection off on every browser. The rules from the last verified policy
  now stay in place, and the popup says they aren't verified, until a genuine policy arrives.
  (`apps/extension/src/background/service.ts`)
- **Key rotation.** `VITE_POLICY_PUBLIC_KEY` now takes several keys separated by commas; a policy signed by any of
  them verifies. (`packages/policy-engine/src/signature.ts`, `apps/extension/src/config/env.ts`)
- **Withdrawn site access went unnoticed.** Chrome/Edge "Site access" and Firefox's add-on Permissions tab can take
  away the host permissions, which silently turns off SafeSearch and sync. A seventh health check, `site_access`,
  catches it (popup shows Needs attention), and the worker re-checks as soon as permissions change.
- **SafeSearch was easy to get around.** Bing image/video/news search and DuckDuckGo's HTML and Lite versions now get
  SafeSearch too. Google searches on other country domains (google.co.uk, google.de, …), where eGuard has no host
  access to add SafeSearch, are blocked while SafeSearch is on, and the block page points to google.com.

### Fixed

- **A single new category or "other websites" mode from the server would have stopped every policy update.**
  Category keys and the mode are now open-ended. An unknown category's sites are blocked like any other (the block
  page calls it "other"); an unknown mode is enforced as BLOCK. (`packages/schemas/src/policy.ts`)
- **Domain names were lower-cased and trimmed before the signature check**, so a policy with `Example.com` failed
  verification. Domains are now taken exactly as signed (and must already be normalised).
- **Any 401 from `/token` disconnected the browser and removed every rule**, including a 401 from a server fault.
  The extension now forgets the connection at once only for `code: "installation_revoked"` or `"token_reused"`; a
  bare 401 must persist for 10 minutes first. Protection stays on meanwhile. **Needs ~/eguard to send those codes**,
  or removal takes effect about 10 minutes later than before. (`packages/api-client/src/token-manager.ts`)
- **A blocked site inside an allowed one opened.** Allowed `example.com` with blocked `games.example.com` left
  `games.example.com` open. The more specific rule now wins; an allowed site still beats a blocked category.
- Rule updates and block counts no longer race each other (overlapping updates could fail with a duplicate rule id,
  and counts could lose increments). Two pairing codes sent at once pair only once.
- The block page now explains blocked addresses up to 64 KB long (was 4 KB).

### Docs

- README, ARCHITECTURE, SECURITY, API docs and the Browser Extension API reference updated: test counts, the
  `policy-engine` package, the duplicated threat-model row, 401 codes, key rotation, `site_access`.

## 0.1.2 — 2026-10-03

Reliability release that brings the extension fully in line with the
[Browser Extension API v1](browser-extension-api.md). No new permissions, no new data collected: the manifest is
identical to 0.1.1 apart from the version.

### What's new (store listing text)

> - When a parent approves a website, it now opens on its own. No need to press "Check again".
> - eGuard checks for new family settings as soon as the browser starts.
> - A brief network hiccup can no longer disconnect this browser from eGuard.
> - If a parent removes this browser, the setup page opens so it can be connected again.

### Fixed

- **A lost token refresh could disconnect the browser.** When the response to `POST /token` was lost (timeout,
  network drop, 5xx), the extension waited for the next 5-minute sync to try again. By then the server's 2-minute
  replay window had closed, so it treated the retry as a copied token, disconnected the browser and alerted the
  family ("Browser disconnected for security"). The refresh is now retried right away (after 2 s, then 8 s; worst
  case about 50 s). `401` and `429` are never retried.
  (`packages/api-client/src/token-manager.ts`)
- **An additive server change would have stopped all policy updates.** Policies were verified after Zod parsing,
  which strips unknown fields, so any new field from the server would fail every signature check. The extension would
  keep its last policy and parents would see "Browser protection changed". The policy schemas are now loose, so the
  signature is checked over exactly what was signed. Unknown fields are kept but never enforced.
  (`packages/schemas/src/policy.ts`)
- **The block page didn't notice a parent's answer.** It now checks access requests every 20 s while the tab is
  visible. When a request is `APPROVED`, it fetches the signed policy straight away and opens the site. A fresh
  approval was previously shown as "The time a parent allowed for this website has ended" until the next sync.
  (`apps/extension/src/blocked/Blocked.tsx`)
- **Daily block counts over 100,000** are capped at the server's limit, so the whole day isn't refused.
  (`apps/extension/src/background/service.ts`)

### Changed

- The policy syncs on browser start and after an update, not only on the 5-minute alarm.
- When the parent removes the browser (or eGuard disconnects it), the setup page opens, as the API's
  Disconnection flow specifies. (`apps/extension/src/background/index.ts`)

### Build

- Production build: API `https://www.eguard.family`, the same policy-signing public key as 0.1.1.
- Packages: `release/eguard-{chrome,edge,firefox}-0.1.2.zip`; source for AMO: `release/eguard-source-0.1.2.zip`.
- Unit tests (144, 3 new), typecheck, lint and format check pass. Playwright end-to-end tests and the manual
  production check from [RELEASE.md](docs/RELEASE.md#before-every-release) are still to run before upload.

### Notes for store reviewers

No change to permissions, host permissions, content security policy or Firefox `data_collection_permissions`. This
release changes only retry timing, schema leniency and block-page refresh behaviour.
