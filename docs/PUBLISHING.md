# Publishing to the browser stores

How to put eGuard Browser Protection on the **Chrome Web Store**, **Microsoft Edge Add-ons** and **Firefox Add-ons (AMO)**, and how to ship updates. [RELEASE.md](RELEASE.md) is the per-release checklist; this page is the store side: accounts, packages, listing text, permission justifications, data disclosures and reviewer notes.

Text in the "Paste" blocks is written for the store form or for the public listing. Keep it in step with [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md#permissions): the stores compare the listing, the privacy policy and the code, and reject mismatches.

## 1. Before the first submission

These block a first submission. Tick them off in order.

| #   | Item                                                                                                                                                                                                                                                     | Owner           |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1   | Production server live at `https://www.eguard.family` with the `/api/browser/v1` endpoints ([API.md](API.md))                                                                                                                                            | Backend         |
| 2   | Production policy-signing key pair made (`node scripts/browser-policy-keys.mjs` in `~/eguard`). Private half in the server's `BROWSER_POLICY_SIGNING_KEY`, public half kept for `VITE_POLICY_PUBLIC_KEY`. **Never use the E2E or `npm run try` keys.**   | Backend         |
| 3   | Privacy policy published at `https://www.eguard.family/privacy`, covering the extension (source: [PRIVACY.md](PRIVACY.md))                                                                                                                               | Product / legal |
| 4   | Done: Firefox data-collection declaration in the manifest (see [§6.3](#63-firefox-data-collection-manifest)). AMO requires it for new extensions                                                                                                         | Engineering     |
| 5   | A **reviewer account**: a parent login on production with one child, and a way to hand reviewers a working pairing code (see [§7](#7-reviewer-notes)). Without it, reviewers can't get past onboarding and will reject the extension as "not functional" | Product         |
| 6   | Store images ready ([§4](#4-store-images))                                                                                                                                                                                                               | Design          |
| 7   | Version set in `apps/extension/package.json` (numbers only, e.g. `1.0.0`). Every upload needs a higher version than the last one in that store                                                                                                           | Engineering     |
| 8   | Everything in RELEASE.md's [Before every release](RELEASE.md#before-every-release) passes, including the manual check in Chrome, Edge and Firefox against production                                                                                     | Engineering     |

### Developer accounts

Register once per store, preferably under a shared company address rather than a personal one, with two-step verification on:

- **Chrome Web Store:** [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Google charges a one-time registration fee. Register as a **trader** (a business selling or offering a service), which shows the company's contact details on the listing, as EU rules require.
- **Microsoft Edge Add-ons:** [Microsoft Partner Center](https://partner.microsoft.com/dashboard/microsoftedge/overview), Edge program. Free.
- **Firefox:** [addons.mozilla.org Developer Hub](https://addons.mozilla.org/developers/) with a Mozilla account. Free.

Store fees and form fields change; check each dashboard at submission.

## 2. Build the store packages

Production builds refuse `http://` URLs and drop the environment suffix from the extension name. Run from the repo root in PowerShell:

```powershell
$env:VITE_ENVIRONMENT = "production"
$env:VITE_API_URL = "https://www.eguard.family"
$env:VITE_WEB_APP_URL = "https://www.eguard.family"
$env:VITE_POLICY_PUBLIC_KEY = "<production public key, base64 SPKI>"
npm ci
npm run lint; npm run typecheck; npm test; npm run test:e2e
npm run build
```

Zip the **contents** of each folder, so `manifest.json` sits at the root of the zip. Use `tar` (built into Windows 10+), not PowerShell's `Compress-Archive`, which writes backslashes into zip paths that AMO rejects:

```powershell
$v = (Get-Content apps/extension/package.json | ConvertFrom-Json).version
New-Item -ItemType Directory -Force release | Out-Null
foreach ($t in "chrome", "edge", "firefox") {
  # List the items rather than ".", so paths are "manifest.json", not "./manifest.json"
  tar -a -c -f "release/eguard-$t-$v.zip" -C "dist/$t" @(Get-ChildItem "dist/$t" -Name)
}
git archive --format=zip -o "release/eguard-source-$v.zip" HEAD   # for AMO's source review
```

On macOS or Linux: `(cd dist/chrome && zip -r ../../release/eguard-chrome-$v.zip .)`, and the same for each target.

Before uploading, unzip one package and check:

- `manifest.json` has `"name": "eGuard Browser Protection"` (no `(development)`) and the version you expect
- `host_permissions` has `https://www.eguard.family/*`, not `localhost` or `127.0.0.1`
- The Chrome package asks for `privacy` and the Edge and Firefox packages don't

Keep the zips and the commit hash together. Stores sometimes ask for the exact package or source again.

## 3. Listing text

Use the same text in all three stores. Adjust only where a form's limits require it.

**Name:** eGuard Browser Protection

**Summary** (Chrome allows 132 characters; this matches the manifest description):

```text
Simple digital protection for your family: safer browsing that eGuard keeps verified.
```

**Category:** the closest family-safety or privacy-and-security category each store offers.

**Description:**

```text
eGuard Browser Protection applies your family's web-protection settings in your child's browser, then keeps checking that they're still in place. It works with an eGuard family account: you choose the settings in the eGuard parent dashboard, and this extension applies them.

What it does
• Blocks the kinds of websites you choose, such as adult content, gambling or violence, and specific sites you add
• Turns on SafeSearch for Google, Bing and DuckDuckGo
• Focus hours: only the websites you allow open during the times you set
• Allowed-only mode for younger children
• A calm block page that explains why and lets your child ask you for access. You approve or say no from the dashboard
• Health checks: eGuard tells you when protection needs attention, for example if private windows aren't covered

What it doesn't do
• It doesn't keep a history of the websites your child visits
• It doesn't read pages, messages or emails, record keystrokes or passwords, or take screenshots
• It doesn't sell data or build advertising profiles

Websites are matched by the browser itself, on the device. eGuard only receives the protection status, health-check results, the number of pages blocked each day in each category (never which sites), and access requests your child chooses to send.

Getting started
1. Install the extension in your child's browser.
2. In the eGuard parent dashboard, open your child's page, then the Browser tab, and get a one-time pairing code.
3. Enter the code in the extension. Your password is never entered in your child's browser.

Settings can only be changed by a parent in the dashboard, not from the child's browser. For the strongest protection, allow eGuard in private windows. Schools and IT admins can force-install the extension so it can't be removed.

Privacy policy: https://www.eguard.family/privacy
```

**Support URL:** `https://www.eguard.family/support` (or the support email)
**Homepage URL:** `https://www.eguard.family`
**Privacy policy URL:** `https://www.eguard.family/privacy`

**Privacy policy text:** [store/privacy-policy.txt](store/privacy-policy.txt) is the extension's own policy. Paste it into AMO's "This add-on has a Privacy Policy" field, and publish the same text on the website. Update it, and its date, whenever the extension's data collection changes.
**Language:** English

## 4. Store images

| Image              | Chrome                                    | Edge                            | Firefox                             |
| ------------------ | ----------------------------------------- | ------------------------------- | ----------------------------------- |
| Icon               | 128×128 PNG (`public/icons/icon-128.png`) | 300×300 PNG (logo, re-exported) | Taken from the package              |
| Screenshots        | 1–5, 1280×800 or 640×400                  | 1–10, 1280×800 or 640×480       | Any size; 1280×800 works everywhere |
| Small promo tile   | 440×280 (required)                        | 440×280 (optional)              | —                                   |
| Marquee promo tile | 1400×560 (optional)                       | 1400×560 (optional)             | —                                   |

Suggested screenshots, in order:

1. The popup showing **Protection active**, next to a browser window
2. The block page (**This website is blocked**, with the Reason, Profile and Time cards)
3. The settings page, Web protection section (protection level and features)
4. The settings page, Website categories
5. The parent dashboard's Browser tab, where settings are changed

`STORE_SCREENS_DIR=<folder> npx playwright test store-screens` generates screenshots 1–4, a privacy screenshot and both promo tiles as JPEGs (no alpha channel): real extension screens captured against the mock server and set on eGuard-style canvases. Screenshot 5 (the parent dashboard) has to be captured from the web app. Regenerate the images whenever the extension's screens change. The mock data (child "Mia", "Cruz family") is fictional; use the same or other made-up names, never a real child's.

Chrome rejects screenshots with borders, heavy text or anything that looks like a browser warning. Keep one message per image.

## 5. Permission justifications

Chrome asks for one justification per permission; Edge and AMO reviewers read them in the notes. Each fits Chrome's 1,000-character field. [SECURITY.md](SECURITY.md#permissions) has the full reasoning.

**Single purpose** (Chrome):

```text
Apply and verify a family's web-protection settings in this browser: block the websites and categories a parent chose, enforce SafeSearch and focus hours, and report whether that protection is working.
```

**storage**

```text
Keeps the browser's connection to the family's eGuard account, the signed family policy and the time of the last sync, so protection survives browser restarts. The short-lived access token is kept in session (memory-only) storage. No pages visited, form data or typed text are stored.
```

**alarms**

```text
Manifest V3 background workers stop when idle. Alarms wake the worker to download the latest family policy every 5 minutes and to re-apply and re-check the blocking rules every minute, so focus hours start and end on time and a parent's approval expires when it should.
```

**declarativeNetRequest**

```text
Blocks the websites and categories the parent chose. The browser matches the rules itself, so the extension's code never sees the pages visited. The extension also reads its own rules back to confirm they are still installed exactly as the policy requires, and adds SafeSearch parameters on supported search engines.
```

**webNavigation**

```text
Only the onErrorOccurred event is used. When a blocking rule stops a page, the browser reports a failed load; the extension checks that failure against the family policy and, if eGuard blocked it, shows eGuard's explanatory block page instead of the browser's error page. This avoids requesting access to all websites. Addresses of failed or loaded pages are not stored or sent.
```

**privacy** (Chrome package only)

```text
Reads and holds Chrome's Safe Browsing setting (privacy.services.safeBrowsingEnabled) on while the family's policy asks for it, so malware and phishing protection can't be switched off in the child's browser. It is released when the policy no longer asks for it or the browser is disconnected. No other privacy setting is read or changed.
```

**Host permission: https://www.eguard.family/**

```text
The only server the extension talks to. Used for pairing with the family account, refreshing its access token, downloading the signed family policy, sending health-check results and daily blocked-page counts per category, and sending access requests the child chooses to make.
```

**Host permissions: google.com, google.com.ph, bing.com, duckduckgo.com**

```text
SafeSearch: redirect rules add the search engine's own safe-search parameter (safe=active, adlt=strict, kp=1) to searches on these sites. Search queries and results are not read.
```

**Remote code** (Chrome asks): **No**. All code ships in the package. The policy is signed data, not code.

### Install warnings

Users see these when installing. The description should explain them, as it does above:

- "Block content on any page" (`declarativeNetRequest`)
- "Read your browsing history" (Chrome's wording for `webNavigation`; eGuard keeps no history)
- "Read and change your data on" the search sites (SafeSearch)
- Chrome only: "Change your privacy-related settings" (`privacy`)

Adding a permission in a later version disables the extension for existing users until they accept the new warning. Avoid it, or plan for it. See SECURITY.md.

## 6. Data disclosures

What eGuard's servers receive, from [PRIVACY.md](PRIVACY.md#what-is-sent-to-eguards-servers):

| Data                                                     | When                          |
| -------------------------------------------------------- | ----------------------------- |
| Browser name and version, extension version, OS type     | Pairing, and on sync          |
| Protection state, policy version, health-check results   | On change, hourly, on request |
| Pages blocked per day per category (never which sites)   | Once a day, for finished days |
| An access request: one site address and the reason typed | Only when the child sends one |

Before submitting, product and legal must agree on how each row maps to the store categories below. The mapping below is a recommendation, not settled.

### 6.1 Chrome Web Store: Privacy practices tab

Recommended selections:

- **Web history:** yes. An access request contains the address of the site the child asks for, and the daily counts describe blocked browsing by category. Declaring it is the conservative reading; leaving it out risks rejection for under-disclosure.
- **Website content, user activity, personal communications, location, financial, health, authentication info, personally identifiable information:** no. The extension doesn't collect them. The installation credential is the extension's own, not the user's login.

Certify all three:

- Data is not sold or transferred to third parties outside the approved use cases
- Data is not used or transferred for purposes unrelated to the single purpose
- Data is not used or transferred to determine creditworthiness or for lending

### 6.2 Microsoft Edge Add-ons

Partner Center asks for the privacy policy URL and whether the extension collects personal information. Answer **yes**: access requests and pairing are tied to a family account. Link the same policy.

### 6.3 Firefox data-collection manifest

AMO rejects new extensions without `browser_specific_settings.gecko.data_collection_permissions` ("The \"data_collection_permissions\" property is missing"). It is declared in `apps/extension/src/config/manifest.ts` (`FIREFOX_DATA_COLLECTION`), checked by `apps/extension/src/config/config.test.ts`, and Firefox shows it at install:

```json
"gecko": {
  "id": "browser-extension@eguard.family",
  "strict_min_version": "140.0",
  "data_collection_permissions": { "required": ["browsingActivity"] }
},
"gecko_android": { "strict_min_version": "142.0" }
```

- **`browsingActivity`, required:** an access request sends the address of the site the child asks for, and the daily counts are blocked pages per category.
- **Not declared, `technicalAndInteraction`:** Firefox only allows it as optional, meaning the person could decline it. Browser and OS details and health-check results are how the service works (the parent's status and alerts), not usage telemetry, so they aren't declared under it. If product or legal read it the other way, health reporting has to become optional in Firefox (checked with `browser.permissions.contains({ data_collection: [...] })`).
- **Minimum versions:** Firefox reads this field from 140 on desktop and 142 on Android, so those are the minimums (`MIN_VERSION.firefox` in `packages/browser-adapter/src/detect.ts` feeds the manifest). 140 is an ESR release.

Check the package with Mozilla's validator before uploading: `npx addons-linter release/eguard-firefox-<version>.zip` must report 0 errors and 0 warnings. The "Function constructor is eval" and "Unsafe assignment to innerHTML" warnings, which AMO lists as possible grounds for rejection, came from Zod and React DOM. `apps/extension/scripts/amo-safe.ts` removes them at build time and fails a production build if either comes back (for example after a library upgrade).

## 7. Reviewer notes

Reviewers can't use the extension without pairing it to a family account. Give them a prepared account. Create a parent account on production for the store team only ("Store Review family", child "Test Child"), and keep its credentials in the team password manager.

Codes are single-use and short-lived. Either create a fresh code just before each submission and say how long it lasts, or give reviewers the parent login so they can make their own. The second way survives review delays. Change the password after each review.

Paste into Chrome's "Test instructions", Edge's "Notes for certification" and AMO's "Notes to reviewer":

```text
eGuard Browser Protection is the browser component of eGuard, a family digital-safety service. It needs a parent account to pair with.

Test account (parent dashboard): https://www.eguard.family/login
Email: <reviewer email>
Password: <password>

To test:
1. Install the extension. The setup page opens.
2. Sign in to the parent dashboard above in another tab, open "Test Child", go to the Browser tab, type any computer name and choose "Get pairing code".
3. Enter the 6-digit code in the setup page and choose Connect, then Verify configuration.
4. Open the extension popup: it shows the protection status and the family's settings.
5. Visit a site in a blocked category, e.g. a gambling site: the eGuard block page appears. "Ask a parent" sends an access request that appears in the dashboard.
6. The options page shows the settings read-only; they can only be changed in the dashboard.

For full protection, eGuard asks to be allowed in private windows; the popup shows "Protection needs attention" until then. That is expected.

Permissions: see the justification for each. The extension has no content scripts, requests no <all_urls> access, and loads no remote code. Blocking uses declarativeNetRequest; webNavigation is used only for onErrorOccurred to show the block page.
```

**Firefox only.** The package is built with Vite, so AMO needs the source. Upload `eguard-source-<version>.zip` and add to the notes:

```text
Build instructions: Node 24 or later. From the source root:
  npm ci
  VITE_ENVIRONMENT=production VITE_API_URL=https://www.eguard.family VITE_WEB_APP_URL=https://www.eguard.family VITE_POLICY_PUBLIC_KEY=<key below> node apps/extension/scripts/build.ts --target firefox
Output: dist/firefox. VITE_POLICY_PUBLIC_KEY is a public key (safe to share): <production public key>
```

Also paste this, so the reviewer knows why two libraries differ from their published versions:

```text
Two bundled libraries are patched at build time (apps/extension/scripts/amo-safe.ts) so the package has no eval or innerHTML: Zod's optional code-generation speed-up uses a Function constructor that always throws (Zod then uses its normal validator, as it already does under the extension's CSP), and React DOM's innerHTML branches (rendering <script> elements, dangerouslySetInnerHTML) throw instead. eGuard uses neither. The build fails if either pattern is left in the output.
```

## 8. Submitting

### Chrome Web Store

1. Developer Dashboard → **New item** → upload `eguard-chrome-<version>.zip`.
2. **Store listing:** description, category, language, images ([§3](#3-listing-text), [§4](#4-store-images)).
3. **Privacy practices:** single purpose, permission justifications, remote code "No", data use ([§5](#5-permission-justifications), [§6.1](#61-chrome-web-store-privacy-practices-tab)).
4. **Distribution:** Public. All regions, unless legal limits them. For a staged launch, choose **Unlisted** first: installable by link, not searchable.
5. **Test instructions:** reviewer notes ([§7](#7-reviewer-notes)).
6. **Submit for review.** Choose "publish automatically after review" unless the release is timed.

### Microsoft Edge Add-ons

1. Partner Center → Edge → **Create new extension** → upload `eguard-edge-<version>.zip`. Don't reuse the Chrome zip; the Edge build leaves out the Chrome-only `privacy` permission.
2. **Availability:** Public, markets.
3. **Properties:** category, privacy policy URL, website, support contact.
4. **Store listings:** English description and images.
5. **Submit**, with the reviewer notes in "Notes for certification".

### Firefox (AMO)

1. Developer Hub → **Submit a New Add-on** → **On this site** (listed) → upload `eguard-firefox-<version>.zip`.
2. Answer **Yes** to "Do you need to submit source code?" and upload `eguard-source-<version>.zip`.
3. Fill in the listing and the reviewer notes, including the build instructions.
4. The add-on ID is fixed by the manifest: `browser-extension@eguard.family`. Never change it; it identifies the extension for updates and enterprise policies.

Review times vary: often hours to a few days, longer for new extensions with broad warnings. A rejection email names the policy. Fix the listing or code, bump the version if the code changed, and resubmit.

## 9. After publishing

1. Record each store's listing URL and extension ID in the table below. Chrome and Edge assign different IDs on first upload.
2. Point the parent dashboard's "Install the extension" links at the listings.
3. Publish the IDs and force-install examples for schools and parents who manage devices. Force-installing is what stops a child removing the extension ([SECURITY.md](SECURITY.md#threat-model)):
   - **Chrome** (`ExtensionInstallForcelist`): `<chrome-id>;https://clients2.google.com/service/update2/crx`
   - **Edge** (`ExtensionInstallForcelist`): `<edge-id>;https://edge.microsoft.com/extensionwebstorebase/v1/crx`
   - **Firefox** (`policies.json`):
     ```json
     {
       "policies": {
         "ExtensionSettings": {
           "browser-extension@eguard.family": {
             "installation_mode": "force_installed",
             "install_url": "https://addons.mozilla.org/firefox/downloads/latest/<amo-slug>/latest.xpi"
           }
         }
       }
     }
     ```
4. Install from each store on a clean profile, pair with the reviewer account, and check the popup, the block page and the dashboard's health report.

| Store   | Listing URL | Extension ID                      |
| ------- | ----------- | --------------------------------- |
| Chrome  | _pending_   | _assigned on first upload_        |
| Edge    | _pending_   | _assigned on first upload_        |
| Firefox | _pending_   | `browser-extension@eguard.family` |

## 10. Updates

1. Bump `version` in `apps/extension/package.json`.
2. Run the RELEASE.md checklist, then build and package ([§2](#2-build-the-store-packages)).
3. Upload the new zip to the existing item in each store (Chrome: **Package → Upload new package**; Edge: **Update**; AMO: **Upload New Version**, with a new source zip).
4. If permissions, data collection or what the extension does changed, update the justifications, the privacy form, PRIVACY.md and the public privacy policy **in the same submission**.
5. Browsers update installed copies on their own, usually within hours to a day of approval.

To withdraw a bad release, stores don't roll back. Publish a fixed higher version. Chrome can also pause a staged rollout (percentage rollout in the Package tab, for items with enough users), which is worth using for releases that change blocking.
