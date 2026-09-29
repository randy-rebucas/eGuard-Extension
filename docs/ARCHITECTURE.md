# Architecture

The eGuard browser extension applies a family's web-protection policy inside Chrome, Edge and Firefox, and keeps checking that it's still in place. It is a client of the existing eGuard platform (`~/eguard`, Next.js 16 + Postgres/Prisma); it has no identity system or data store of its own.

> **The rule everything follows:** eGuard never tells a parent a browser is protected unless it has verified that. Unknown is shown as unknown.

---

## A. Assessment of the existing eGuard platform

Reviewed in `~/eguard` on 2026-09-29.

| Area                       | What exists                                                                                                                                                                                                                                                                        | What the extension does with it                                                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity                   | `Family` → `User` (parent roles `FAMILY_ADMIN`/`PARENT`) → `Child` → `Device`. Parent sessions are opaque tokens, SHA-256 hashed in `Session`.                                                                                                                                     | Reuses it. No new identity system.                                                                                                                                    |
| Device pairing             | Parent generates a one-time `PairingCode` for a child; the phone app exchanges it at `POST /api/device/v1/pair` for a device token (hashed in `Device.tokenHash`). Rate-limited per IP; codes are claimed atomically; plan `deviceLimit` enforced.                                 | Same pattern for browsers (`/api/browser/v1/pair`), plus short-lived access tokens and rotating refresh tokens. The parent never signs in inside the child's browser. |
| Verification engine        | `lib/engine.ts processReport`: devices report actual config, the server compares with the parent's policy, updates `DeviceProtection`, raises/resolves `Alert`s, writes `ConfigChange` history. `CheckStatus` = `PASS · WARNING · ACTION_REQUIRED · UNSUPPORTED · NOT_CONFIGURED`. | Same statuses. Browser health reports follow the same "reported vs desired" model.                                                                                    |
| Web policy                 | `ProtectionKey.WEB` with config `{ mode: OFF\|FILTER\|ALLOWLIST, blockedSites: <number> }`. The count is all there is: **no domain lists, categories or SafeSearch exist yet.**                                                                                                    | Needs a real, versioned browser policy (Phase 3, see [API.md](API.md#database-changes)).                                                                              |
| Capability terms           | `Capability = AVAILABLE \| GUIDED \| VERIFY_ONLY \| UNSUPPORTED`, returned by the mobile API.                                                                                                                                                                                      | Spec §39 requires `AUTOMATIC \| GUIDED \| VERIFICATION_ONLY \| UNSUPPORTED` everywhere. The extension uses the spec's terms. **Open decision** below.                 |
| Alerts, audit, rate limits | `Alert` (severity, category, `resolveKey`), `AuditLog(actor, action, detail)`, DB-backed fixed-window `RateLimit`.                                                                                                                                                                 | Reused as-is for browser alerts, audit and pairing limits.                                                                                                            |
| API conventions            | `/api/device/v1`, `/api/mobile/v1`; errors `{ error, code }` where `error` is parent-safe text; `X-eGuard-Client` header names the client.                                                                                                                                         | New namespace `/api/browser/v1` with the same conventions.                                                                                                            |
| Realtime                   | None; clients poll.                                                                                                                                                                                                                                                                | Poll every 5 min with `alarms` (fits MV3 workers, which can't hold sockets open). Push is a later optimisation.                                                       |
| Design                     | Tailwind v4 tokens in `src/app/globals.css` (navy/azure, Hanken Grotesk + Sora), `lucide-react`, `LogoMark` SVG.                                                                                                                                                                   | Copied into `apps/extension/src/ui` so the extension reads as the same product.                                                                                       |

**Where the code lives.** `~/eguard` is a single Next.js app, not a monorepo, so the extension is a sibling repository (`~/eguard-browser`) with the structure the spec asks for. Backend changes (Phase 2+) go into `~/eguard`, following its conventions. The shared contract is [`packages/schemas`](../packages/schemas) and [API.md](API.md).

### Decisions that need a product owner

1. **Capability terminology.** Rename the web app's `AVAILABLE`/`VERIFY_ONLY` to `AUTOMATIC`/`VERIFICATION_ONLY`? The labels can change freely, but the mobile API returns the raw values, so renaming the wire values affects shipped app builds. _Recommendation:_ change labels now; accept both wire values in `/api/mobile/v2` or a coordinated app release.
2. **Do browsers count toward the plan's device limit?** The existing pair endpoint enforces `Family.deviceLimit`. _Recommendation:_ yes, one installation = one device, so pricing stays simple. Easy to change later.
3. **Is a laptop a `Device`?** `Device` today means phone/tablet (`Platform = ANDROID\|IOS`, 10 protection keys in health). Forcing laptops into it ripples through health scoring. _Recommendation:_ `BrowserInstallation` hangs off `Child` with a parent-entered device label, and the dashboard shows browsers next to devices. Link to a `Device` later if eGuard ships desktop apps.
4. **Should Android's web filter use the same domain lists?** _Recommendation:_ yes. `BrowserPolicy` becomes the family's web policy; the `WEB` protection's `blockedSites` count is derived from it.

---

## Components

```text
apps/extension
├── background/   service worker (Chrome/Edge) or background script (Firefox), one classic-script bundle
│   ├── index.ts        wires browser events → service. Every listener registered at top level.
│   ├── router.ts       message entry point: sender check → zod parse → dispatch
│   ├── sender.ts       only this extension's own pages may send commands
│   ├── service.ts      pairing, policy sync, health check, navigation
│   ├── status.ts       deriveStatus(): the single, pure answer to "am I protected?"
│   └── state.ts        persisted state; every value schema-checked on read
├── popup/        compact status (360px)
├── onboarding/   welcome → connect (pairing code) → review capabilities → verify
├── options/      read-only settings + privacy
└── ui/           tokens, LogoMark, Button/Pill/Card

packages
├── schemas/          zod: messages, status, policy, API contract, capability levels
├── browser-adapter/  browser detection, WebExtensions namespace, typed storage, capability matrix
└── api-client/       fetch with timeouts + friendly errors, token manager (rotating refresh, single-flight)
```

Planned packages: `policy-engine` (Phase 3: policy → declarativeNetRequest rules, domain matching, schedules) and `ui` if a second consumer appears.

## Trust model: parent vs child

The extension lives on the **child's** browser. After pairing it is always in child mode:

- Parents authenticate on **their own** device, in the eGuard web app or phone app. They create a one-time pairing code there and type it into the child's browser once. No parent password or parent session ever reaches the child's browser.
- The extension holds an **installation credential** scoped to one child and one browser: it can read that child's browser policy and report health, nothing else.
- Nothing in the extension can weaken protection: no "disconnect", no toggles. Removing a browser is done by a parent in the dashboard, which revokes its credential; the extension then forgets the connection.
- Re-pairing an already-connected browser is refused, so a child can't move it to a different account.

The spec's "OAuth/OIDC + PKCE" parent sign-in is deliberately not used in the child's browser: a parent session there would give the child's environment parent powers. If a parent-mode extension is ever needed (for example on the parent's own browser), PKCE against the existing session system is the way to add it.

## Protection status

`deriveStatus()` ([status.ts](../apps/extension/src/background/status.ts)) turns facts into one of five states, in this order:

| State             | When                                                                                                                                           |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `UNSUPPORTED`     | Browser family/version eGuard doesn't support (Safari until validated).                                                                        |
| `ACTION_REQUIRED` | Not connected, or connected but no policy received yet.                                                                                        |
| `NEEDS_ATTENTION` | Policy present but its rules aren't installed exactly as it requires (read back from the browser), or eGuard isn't allowed in private windows. |
| `SYNC_PAUSED`     | Verified rules, but the backend is unreachable or there's been no successful sync for 24 h. The last policy **stays active**.                  |
| `PROTECTED`       | Signed policy verified, its rules installed and read back, allowed in private windows, recent sync.                                            |

`rulesVerified` comes from reading the browser's dynamic rules back on every status request and comparing them with what the verified policy requires at that moment (`sameRules`). The toolbar badge mirrors the state (`!` for attention/action).

## Enforcement

`packages/policy-engine` `compileRules()` turns the verified policy into `declarativeNetRequest` dynamic rules: allow (allowed sites, active approvals, the eGuard web app) > block sites > block categories > block everything else when "other websites" is Warn/Allowed-only or focus hours are on; SafeSearch redirects sit above all of them but are only added for engines the policy lets the child open. `evaluateUrl()` states the same order in code, and a test replays the browser's matching over many policies and URLs to prove they agree, so the block page's explanation is always what actually happened.

Blocking uses plain block rules (no host access to every site). When the browser reports the blocked top-level load (`webNavigation.onErrorOccurred`), the worker re-evaluates the URL and, if eGuard blocked it, sends the tab to the block page. "Warn first" sites are blocked the same way; **Continue** adds a 30-minute session allow rule for that host, and the worker refuses Continue for anything the policy blocks outright. Rules are re-applied every minute (focus hours, approvals ending, rules removed behind eGuard's back) and removed entirely when the browser is disconnected.

## Sync, versioning and offline behaviour

- Every policy has a positive integer `version`. The extension only moves forward: a lower version (rollback/replay) or a policy addressed to another installation is refused and logged, and the current policy stays.
- Policies are schema-validated on receipt **and** on every read from storage, so a tampered or malformed stored value reads as "missing", never as trusted.
- Sync runs on a 5-minute alarm, when the popup asks, and after pairing.
- **Offline / expiry strategy.** A policy never expires on the device: protection doesn't switch off because the network did. Staleness is surfaced instead: after 24 h without a successful sync the popup shows _Sync paused_ (policy still active), and the backend raises "eGuard can't verify this browser" for the parent (same 24 h threshold as `OFFLINE_AFTER_MS` in the web app). The only thing that removes a policy is the backend revoking the installation.
- **Integrity.** The backend signs each policy (ECDSA P-256 over canonical JSON; see [API.md](API.md#get-policy-bearer)); the public key ships in the build and is checked on receipt and on every read. A policy edited in storage (e.g. with developer tools) is discarded and downloaded again, never enforced or displayed.

## E. UI screen map

```text
Toolbar icon (badge ! when attention needed)
└── Popup
    ├── Not connected ─────────── [Connect to eGuard] → Onboarding
    ├── Connected: status hero · child/device/browser/policy version · issues with actions
    │     [Sync now] [Run health check]
    └── View parent dashboard → web app /dashboard (parent signs in there)

Onboarding tab (opens on install)
    1 Welcome (does / does not) → 2 Connect (pairing code, inline server errors)
    → 3 Review (connection + what eGuard can do in this browser, by capability level)
    → 4 Verify (runs health check, shows the honest result)

Options tab: Account (read-only) · Protection capabilities · Privacy
Phase 4: Block page → "Ask a parent" (reason) → request sent
Phase 5: Health detail with per-check PASS/WARNING/… and guided fixes (private windows, Safe Browsing on Edge/Firefox)
Web app (Phase 6): Child → Devices → Browser card (health x/10, last sync, Run health check) · Access requests · Add browser (pairing code)
```

## F. Implementation plan

| Phase                | Scope                                                                                                                                                                                                             | Status   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1 Foundation         | Monorepo, MV3 manifests for 3 browsers, React/Vite/Tailwind, background worker, validated storage, browser adapter, capability matrix, auth token manager, pairing UI, popup/onboarding/options, unit + E2E tests | **Done** |
| 2 Pairing            | `~/eguard`: `PairingCode.kind`, `BrowserInstallation`, `/api/browser/v1/pair` + `/token`, "Add browser" in the dashboard, revoke                                                                                  | **Done** |
| 3 Policy             | `BrowserPolicy` + versions, parent editing UI, `/policy` endpoint, signing; `packages/policy-engine`                                                                                                              | **Done** |
| 4 Protection         | declarativeNetRequest rules, block page, SafeSearch transforms, access requests + approval, starter category lists, private-window check                                                                          | **Done** |
| 5 Health             | Rule read-back (sets `rulesVerified`), permissions, private-window access, install type, drift detection, `/health` reporting                                                                                     |          |
| 6 Parent integration | Browser cards, alerts, access-request review in web + mobile API                                                                                                                                                  |          |
| 7 Cross-browser      | Validate every matrix cell in Chrome, Edge, Firefox; then evaluate Safari                                                                                                                                         |          |
| 8 Hardening          | Security/privacy review, performance (bundle size, zod/mini), accessibility audit, store packaging                                                                                                                |          |

The first end-to-end vertical slice after Phase 2 is: pair with a real code → download a real policy → block one domain → report health → parent sees it.

## G. Security considerations

See [SECURITY.md](SECURITY.md) for the threat model and the permission table.
