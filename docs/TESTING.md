# Testing

## Unit (Vitest): `npm test`

| Area       | File                                                    | Covers                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status     | `apps/extension/src/background/status.test.ts`          | Every state; PROTECTED impossible without verified rules; offline vs rejected policy; staleness                                                                                                                                                                                     |
| Health     | `…/background/health.test.ts`, `service-health.test.ts` | Each check's status and guidance per browser; reports sent after pairing, on change, hourly and on Run health check, retried when unsent; Safe Browsing held/released/overridden; daily counts by category (no sites), finished days only, kept while offline, dropped when too old |
| Service    | `…/background/service.test.ts`                          | Pairing stores credentials (no password, access token only in session storage); first-sync failure; re-pair refused; policy version rollback, wrong installation and malformed policy refused; offline keeps policy; revocation forgets everything                                  |
| Messaging  | `…/background/router.test.ts`, `sender.test.ts`         | Untrusted senders refused before parsing; strict schemas; internal errors hidden; moz-extension URL handling                                                                                                                                                                        |
| Config     | `apps/extension/src/config/config.test.ts`              | Env validation (https in production); minimal permissions, no all-sites access, strict CSP, per-browser manifests                                                                                                                                                                   |
| API client | `packages/api-client/src/*.test.ts`                     | Error mapping (5xx text never shown), timeouts, token refresh, rotation-safe single flight, retry after 401, revocation                                                                                                                                                             |
| Adapter    | `packages/browser-adapter/src/*.test.ts`                | Browser detection from real UA strings; storage rejects tampered values; capability matrix rules and doc sync                                                                                                                                                                       |
| Schemas    | `packages/schemas/src/schemas.test.ts`                  | Messages, pairing codes, domains, policy                                                                                                                                                                                                                                            |

## Browser (Playwright): `npm run test:e2e`

Builds `dist-e2e/chrome` pointed at an in-process mock of `/api/browser/v1` ([tests/e2e/mock-backend.ts](../tests/e2e/mock-backend.ts)) and loads it into Playwright's Chromium. Branded Chrome 137+ ignores `--load-extension`, so the bundled Chromium is used; it runs the same extension platform.

Scenarios: first install opens onboarding and the popup never claims protection · bad then good pairing code · offline keeps the last policy, recovers when back · parent removal forgets the connection · web pages can't reach the extension · options page is read-only · keyboard operation · axe-core WCAG 2.2 AA on popup (both states), onboarding and options.

**Blocking** (`tests/e2e/blocking.spec.ts`, real enforcement in Chromium): test sites are `http://<name>.example:3299/`, mapped to the mock server with `--host-resolver-rules`, so allowed sites really load and blocked ones are really blocked by the browser. Covers: blocked site and subdomain → block page · category site · allowed and ordinary sites open · ask a parent → no answer yet → approval (new signed policy) → site opens · Warn first → Continue · allowed-only mode refuses Continue, even a forged message · SafeSearch rules installed · disconnecting removes every rule · axe on the block page, request form and warning.

## Not yet automated

- **Firefox and Edge:** Playwright can't load extensions into Firefox, and branded Edge may ignore `--load-extension` like Chrome. Until Phase 7 adds `web-ext`-based runs, check Firefox and Edge by hand with the list below.
- **Real backend:** the main E2E suite uses the mock. `tests/e2e/real-backend.spec.ts` runs the real extension against a running `~/eguard` (opt-in: `EGUARD_API_URL=http://localhost:3217 npx playwright test real-backend`; the server needs `SMTP_URL=smtp://localhost:1025` and `RATE_LIMIT_IP_ALLOWLIST=::1,127.0.0.1`). It signs up a parent, verifies the email through Mailpit, gets a browser code, pairs through onboarding, checks the health report reached eGuard (the parent gets "Private windows aren't protected"), and checks removal disconnects the extension. Server-side cases (rotation, replay, limits, isolation) are in `~/eguard/tests/api/browser.test.ts`; health, drift, alerts, silence and daily counts in `browser-health.test.ts`.

### Manual check (each browser)

1. Load the build (see [DEVELOPMENT.md](DEVELOPMENT.md#loading-the-extension)); onboarding opens.
2. Popup shows _Protection configuration required_ and a `!` badge.
3. Pair with a wrong code (error shown), then the right one; Review lists capabilities for that browser.
4. Verify shows _Protection needs attention_ (Phase 1: no enforcement yet).
5. Stop the backend, run a health check: policy version unchanged, no technical errors shown.
6. Options: no way to disconnect; privacy text present.

### Spec scenarios still to come

SafeSearch through a real search engine page (HTTPS test infrastructure), Chrome's real Safe Browsing setting (Playwright's Chromium build), extension update and browser restart: Phase 7.
