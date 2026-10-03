# Changelog

All notable changes to the eGuard browser extension. Versions match `apps/extension/package.json` and the store
uploads in `release/`.

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
