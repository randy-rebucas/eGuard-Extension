# eGuard Browser Extension

The browser layer of eGuard, _simple digital protection for your family_. It applies a family's web-protection settings in Chrome, Edge and Firefox and keeps verifying that they're still in place, without watching the child: no browsing history, no page content, no keystrokes.

It is a client of the eGuard platform in `~/eguard` and pairs with it using one-time codes from the parent dashboard.

## Status

**Phases 1–4 are complete:** foundation, pairing with the real eGuard server, signed family policies that parents edit in the dashboard (child page → Browser tab), and real blocking: blocked sites and categories, allowed-only mode, focus hours, SafeSearch, a calm block page, and asking a parent for access. Highlights:

- Manifest V3 builds for Chrome, Edge and Firefox from one codebase
- Background worker: validated messaging, validated storage, policy sync every 5 minutes, offline handling, version-rollback protection
- Pairing with rotating installation tokens (the parent's password never touches the child's browser)
- Popup, onboarding and read-only options/privacy pages in the eGuard design language, light and dark
- 162 unit tests, 15 Playwright scenarios (real blocking in Chromium) including WCAG 2.2 AA scans

The popup says **Protected** only when the signed policy is verified, its rules are read back from the browser intact, eGuard is allowed in private windows and still has its site access; otherwise it says what needs attention. Category lists are a starter set for now (see [API.md](docs/API.md)). The popup and options page list seven health checks with guidance; the results go to eGuard, which alerts parents when protection drifts, private windows aren't covered, Safe Browsing is off, or the browser goes quiet. See the [plan](docs/ARCHITECTURE.md#f-implementation-plan).

## Quick start

```bash
npm install
cp .env.example .env
npm run build        # dist/chrome, dist/edge, dist/firefox
npm test
npm run test:e2e
```

Load `dist/chrome` as an unpacked extension, or `dist/firefox/manifest.json` as a temporary add-on. Details in [DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Documentation

|                                                                                                       |                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md)                                                               | Assessment of the existing platform, components, trust model, status, sync/offline, screen map, plan, open decisions         |
| [BROWSER-CAPABILITIES.md](docs/BROWSER-CAPABILITIES.md)                                               | What eGuard can do per browser: Automatic / Guided / Verification only / Unsupported                                         |
| [API.md](docs/API.md)                                                                                 | `/api/browser/v1` contract and the database changes for `~/eguard`                                                           |
| [SECURITY.md](docs/SECURITY.md)                                                                       | Permissions (with reasons), threat model                                                                                     |
| [PRIVACY.md](docs/PRIVACY.md)                                                                         | What is and isn't collected                                                                                                  |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) · [TESTING.md](docs/TESTING.md) · [RELEASE.md](docs/RELEASE.md) | Working on, testing and shipping it                                                                                          |
| [PUBLISHING.md](docs/PUBLISHING.md)                                                                   | Submitting to the Chrome, Edge and Firefox stores: listing text, permission justifications, data disclosures, reviewer notes |

## Layout

```text
apps/extension/        background worker, popup, onboarding, options, build scripts
packages/schemas/      zod contract: messages, status, policy, API
packages/browser-adapter/  browser detection, WebExtensions access, typed storage, capability matrix
packages/api-client/   HTTP client and token manager
packages/policy-engine/    signature check, domain matching, schedules, policy → declarativeNetRequest rules
tests/e2e/             Playwright suite and mock backend
docs/
```
