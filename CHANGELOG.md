# Changelog

All notable changes to the eGuard browser extension. Versions match `apps/extension/package.json` and the store
uploads in `release/`.

## 0.1.4 (2026-10-14)

- **YouTube Restricted Mode.** The policy's new `youtubeRestrict` (`MODERATE` / `STRICT`) sets YouTube's own
  `YouTube-Restrict` request header on its page, embed and API hosts, above every allow rule. **New host permissions**
  for `*.youtube.com`, `*.youtube-nocookie.com`, `youtubei.googleapis.com` and `youtube.googleapis.com`: an update
  from a store waits until someone accepts them (Chrome and Edge turn the extension off meanwhile), and the parent
  sees "eGuard may be off in this browser" after a day. Force-installed copies get them without asking. Shown on the
  Options page. (`policy-engine/src/rules.ts`, `config/manifest.ts`)
- **Proxies & translators category.** `PROXY` gets its label and icon (older builds already blocked it, as "Other").
- **Store listing.** Firefox for Android is no longer listed (`gecko_android` removed: untested, and every text says
  "computer"). The child's typed request reason is declared as personal communications (Chrome form, Firefox
  `personalCommunications`).
- **An approved site opened a more specific blocked one.** Approving `example.com` also opened a separately blocked
  `games.example.com`. Approvals now rank like allowed sites: the more specific blocked site stays blocked.
  (`packages/policy-engine/src/evaluate.ts`, `rules.ts`)
- **Buttons a child can press over and over no longer hold back the parent.** eGuard now limits each browser's policy
  reads (120 per 15 minutes), health reports (60 an hour) and access-request reads (300 per 15 minutes). "Sync now",
  "Check again" and "Run health check" reach eGuard at most 60 times per 15 minutes (syncs) and 20 times an hour
  (forced reports), counted in session storage; past that, the checks still run here and a changed result is still
  reported. "Check again" after a parent's answer always syncs. Open block pages share one list of requests (15 s), and
  a refused read keeps the last answer, so a waiting request no longer flips back to "Ask a parent". (`service.ts`)
- **Fewer retries while offline, and the clock offset first.** When the 5-minute sync can't reach eGuard, the health
  report and daily counts wait instead of retrying the sign-in twice more. Every event waits for the saved clock offset,
  so a restart doesn't use the computer's clock for its first minute. (`service.ts`, `index.ts`)
- **Options page.** YouTube Moderate and Strict are described as on the dashboard. The capability list has a YouTube Restricted Mode row, and Safe Search says other engines'
  searches are blocked.
- **Versions and names stay current.** Health reports carry `extensionVersion` and `browserVersion`; the child,
  family and device names follow renames from the policy response's `names`.

### Security (2026-10-13 audit)

- **"Continue" on a warned search engine turned SafeSearch off.** With other websites on "Warn first", no SafeSearch
  redirect is compiled for an engine the policy only warns about, and Continue's allow rule then opened every search
  unfiltered. Continue now brings that engine's redirect with it (session rule, priority 110). (`enforcement.ts`)
- **A trailing dot got past SafeSearch.** `www.google.com./search` reached Google but matched no redirect. Searches on
  the enforced engines written with a trailing dot are blocked; blocked sites and categories already held (Chromium's
  `requestDomains` matches them, checked in e2e). (`policy-engine/src/search.ts`)
- **Other search engines ran unfiltered with SafeSearch on.** Searches on Yahoo, Brave, Yandex, Ecosia, Startpage and
  Qwant are blocked while SafeSearch is on (no new host permissions), as Google's country domains already were; Bing's
  country hosts (`cn.bing.com`) get SafeSearch. The block page names the engines the family's settings let the child
  use, or none.
- **An unsigned 401 could switch protection off.** `/token` answering `installation_revoked` (or any 401 for 10
  minutes) removed every rule, so a proxy with its own root certificate could unpair even a force-installed browser.
  The extension now disconnects only on eGuard's signed revocation (policy key); any other 401 keeps the rules on.
  Needs the server change that sends `revocation`. (`token-manager.ts`)
- **Moving the clock back stretched approvals, "Continue" and focus hours.** Time limits now use eGuard's clock (the
  `Date` header's offset, kept across restarts); token expiry too.
- **Rollback after a discarded policy.** The highest accepted policy version is kept apart from the stored policy, so
  an older signed policy is still refused after the stored one stops verifying.

### Fixed

- A refused policy (bad signature, older version) and a refused sign-in read "Protection active" and "Up to date".
  Any failed sync now shows Sync paused, titled by what failed. Rules not in place read Action required (nothing may be
  blocked), as the parent's card says.
- New category lists never reached a browser whose policy version hadn't changed: a same-version policy whose content
  differs is taken.
- The block page: category labels as the web dashboard's; "a parent allowed this before" no longer claims the time
  ended; a first-load error offers Go back and Try again; a request whose list didn't load no longer offers "Ask a
  parent" again. Focus-hours times read "9:00 PM" in the popup and options as on the block page.
- Options: "What your family's settings ask for" (the switches are the settings, Health says what's in place); level
  names "Allow / Warn first / Allowed only" as the dashboard; "off" when not connected; long names wrap.
- Onboarding: the dashboard's steps (name this computer, Get pairing code), an 8-character code, "within 15 minutes";
  the Verify step shows errors and "Check again" while something needs a parent.
- Sync paused shows "!" on the toolbar icon (it looked the same as Protected).
- `npm run build` refuses a non-production `.env` for `dist/` (the store packages) unless `--dev-env` is passed.

## 0.1.3 — 2026-10-03

Security release with the fixes from the 2026-10-03 audit. No new permissions and no new data collected: the manifest
is identical to 0.1.2 apart from the version.

### What's new (store listing text)

> - "Continue" on a website your family asked to be warned about now opens only that website.
> - SafeSearch now also covers Bing image, video and news search and DuckDuckGo's simple versions. Searches on other
>   Google country sites send you to google.com, where SafeSearch works.
> - eGuard tells you if its site access is turned off in the browser's settings.
> - Protection stays on through server hiccups and updates to eGuard's security keys.

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

### Build

- Production build: API `https://www.eguard.family`, the same policy-signing public key as 0.1.2.
- Packages: `release/eguard-{chrome,edge,firefox}-0.1.3.zip`; source for AMO: `release/eguard-source-0.1.3.zip`.
- Unit tests (162), Playwright end-to-end tests (15, Chromium), typecheck, lint and format check pass. The manual
  production check in Chrome, Edge and Firefox from [RELEASE.md](docs/RELEASE.md#before-every-release) is still to run
  before upload.

### Notes for store reviewers

No change to permissions, host permissions, content security policy or Firefox `data_collection_permissions`. The
extension now also reads whether its own host permissions are still granted (`permissions.contains`, which needs no
permission) to tell the parent when site access was turned off.

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
