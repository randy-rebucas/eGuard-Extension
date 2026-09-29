# Browser capabilities

What eGuard can do in each browser, using the four levels every eGuard surface shares (spec §39):

| Level                 | Meaning                                                                                                                                                                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Automatic**         | eGuard performs the action itself and verifies it.                                                                                                                                                         |
| **Guided**            | eGuard walks the parent through the steps. "+ verified" means eGuard can confirm the result afterwards; "(not verifiable)" means it can't, and health shows _Verification unavailable_ rather than a pass. |
| **Verification only** | eGuard can tell whether it's set, but can't change it.                                                                                                                                                     |
| **Unsupported**       | The browser doesn't expose enough. Never shown as active.                                                                                                                                                  |

## Matrix

Generated from [`packages/browser-adapter/src/capabilities.ts`](../packages/browser-adapter/src/capabilities.ts); a unit test fails if this table and the code disagree. Regenerate with `node scripts/sync-capability-doc.ts`.

A ✓ marks a cell validated by running it in that browser. **No cell is validated yet**: validation is Phase 7. Until then the levels are what the documented APIs allow, and runtime health checks verify real state regardless of this table.

<!-- matrix:start -->
| Capability | Chrome | Edge | Firefox | Safari |
| --- | --- | --- | --- | --- |
| Website blocking | Automatic | Automatic | Automatic | Unsupported |
| Allowed sites | Automatic | Automatic | Automatic | Unsupported |
| Blocked categories | Automatic | Automatic | Automatic | Unsupported |
| Safe Search | Automatic | Automatic | Automatic | Unsupported |
| Browser malware & phishing protection | Automatic | Guided (not verifiable) | Guided (not verifiable) | Unsupported |
| Protection in private windows | Guided + verified | Guided + verified | Guided + verified | Unsupported |
| Scheduled protection | Automatic | Automatic | Automatic | Unsupported |
| Can't be removed by the child | Guided + verified | Guided + verified | Guided (not verifiable) | Unsupported |
| Family policy sync | Automatic | Automatic | Automatic | Unsupported |
| Protection health | Automatic | Automatic | Automatic | Unsupported |
| Ask a parent for access | Automatic | Automatic | Automatic | Unsupported |
<!-- matrix:end -->

Brave, Opera and other Chromium browsers run the Chrome build and inherit Chrome's levels, but are never shown as validated.

## Evidence and caveats per capability

**Website blocking, allowed sites, categories, schedules.** `declarativeNetRequest` dynamic rules: Chrome 88+ (MV3), Edge (Chromium), Firefox 113+. The browser matches rules itself, so eGuard never sees the pages visited. Limits that shape the design:

- Chrome allows 30,000 dynamic rules, of which 5,000 may be "unsafe" (redirects). eGuard uses one rule per category/list with `requestDomains` arrays, so rule count stays small regardless of list size.
- _Redirect_ rules (to show the eGuard block page) need host permission for the blocked site. To avoid asking for access to all sites, Phase 4 uses plain _block_ rules and then sends the tab to the block page after the browser reports `net::ERR_BLOCKED_BY_CLIENT` (via `webNavigation`). See [SECURITY.md](SECURITY.md#permissions).
- Category coverage is only as good as eGuard's lists. The UI says so ("New sites may not be listed yet").

**Safe Search.** A `declarativeNetRequest` redirect with a query transform adds `safe=active` (Google), `adlt=strict` (Bing), `kp=1` (DuckDuckGo). Requires host permission for those search domains only. This is _enforcement in this browser_, not a change to the child's search-engine account. Other search engines aren't covered; if the family blocks unknown sites they're blocked instead. Needs Phase 7 validation per engine, because engines change parameters.

**Browser malware & phishing protection.** Chrome exposes `chrome.privacy.services.safeBrowsingEnabled` (needs the `privacy` permission): eGuard can read and set it unless an enterprise policy controls it. Edge's SmartScreen and Firefox's "Block dangerous and deceptive content" have no extension API, so these are _Guided, not verifiable_. Independently, eGuard's own Malware/Phishing category lists apply in all three.

**Private windows.** Extensions don't run in Incognito/InPrivate/Private windows unless the user allows it. `extension.isAllowedIncognitoAccess()` (Chrome, Edge, Firefox) tells eGuard whether it's allowed, so it's Guided + verified. On Chrome/Edge a parent can instead disable private windows by policy (`IncognitoModeAvailability` / `InPrivateModeAvailability`).

**Can't be removed by the child.** No extension can stop its own removal. The only mechanism is enterprise policy: `ExtensionInstallForcelist` (Chrome/Edge, via Group Policy, registry or MDM) or `policies.json` `ExtensionSettings` with `installation_mode: force_installed` (Firefox). On Chromium, `management.getSelf().installType === "admin"` confirms a forced install; Firefox's value for this case hasn't been validated, so Firefox is marked not verifiable. Without it, removal is detected by the backend when the browser stops checking in, and the parent is alerted.

**Things no browser lets an extension detect.** The extension being disabled or removed (the backend infers it from silence); another browser or profile on the same computer; the child using a different device. eGuard never claims to cover these.
