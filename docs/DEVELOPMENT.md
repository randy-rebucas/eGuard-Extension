# Development

## Setup

Node 24+ (scripts run as TypeScript directly via Node's type stripping).

```bash
npm install
cp .env.example .env        # points at the local eGuard app on http://localhost:3217
npm run dev                 # builds dist/chrome and rebuilds on change
```

| Command                               | What it does                                                   |
| ------------------------------------- | -------------------------------------------------------------- |
| `npm run dev`                         | Watch-build the Chrome target into `dist/chrome`               |
| `npm run build`                       | Production build of `dist/chrome`, `dist/edge`, `dist/firefox` |
| `npm test`                            | Unit tests (Vitest)                                            |
| `npm run test:e2e`                    | Build for the mock backend and run Playwright in Chromium      |
| `npm run lint`                        | ESLint (typescript-eslint strict, type-checked)                |
| `npm run typecheck`                   | `tsc -b` across all packages, plus the tool scripts            |
| `npm run format`                      | Prettier                                                       |
| `npm run icons -w @eguard/extension`  | Re-render toolbar icons from the logo                          |
| `node scripts/sync-capability-doc.ts` | Regenerate the matrix in BROWSER-CAPABILITIES.md               |

Build for one browser: `node apps/extension/scripts/build.ts --target firefox`. Watch another: `node apps/extension/scripts/build.ts --target edge --watch`.

## Environment

| Variable                 | Meaning                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_URL`           | eGuard API origin. Becomes the only host permission and the only `connect-src`.                                                                                                                                           |
| `VITE_WEB_APP_URL`       | Parent web app, opened by "View parent dashboard".                                                                                                                                                                        |
| `VITE_POLICY_PUBLIC_KEY` | Public key (base64 SPKI) that verifies signed family policies. Must match the server's `BROWSER_POLICY_SIGNING_KEY`; generate both with `node scripts/browser-policy-keys.mjs` in `~/eguard`. The build fails without it. |
| `VITE_ENVIRONMENT`       | `development`, `staging` or `production`. Production refuses `http://` URLs; other builds are labelled in the extension name.                                                                                             |

Values are validated at build time (`apps/extension/src/config/env.ts`); a bad value fails the build. Shell variables override `.env`.

## Loading the extension

**Chrome / Edge / Brave:** open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, _Load unpacked_, choose `dist/chrome` (or `dist/edge`). After changes to the background worker, click the reload icon on the extension card; pages reload on reopen.

**Firefox:** open `about:debugging#/runtime/this-firefox`, _Load Temporary Add-on_, choose `dist/firefox/manifest.json`. Temporary add-ons are removed when Firefox closes. Firefox 128+ is required.

Running against the real backend needs the Phase 2 endpoints in `~/eguard`. Without it, `npm run try` builds `dist-manual/chrome` against the E2E mock with a throwaway policy-signing key and keeps the mock running on `http://127.0.0.1:3299` (pairing code `824917`).

## Conventions

- Browser APIs only through `packages/browser-adapter`. Anything that differs between browsers gets a function there, not an `if (firefox)` in app code.
- Every message type, API response and stored value has a zod schema in `packages/schemas` or next to its storage key.
- Text shown to people is calm and specific, and never claims protection that wasn't verified. Errors never show technical detail.
- Pure logic (status, policy, matching) lives in plain functions with unit tests; the worker's `index.ts` only wires events.
