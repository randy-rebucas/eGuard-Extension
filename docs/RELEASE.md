# Release

Not ready for store submission until Phase 8. This is the checklist to get there; [PUBLISHING.md](PUBLISHING.md) is the step-by-step store submission guide (accounts, listing text, permission justifications, data disclosures, reviewer notes).

## Versioning

`apps/extension/package.json` `version` is the manifest version (`MAJOR.MINOR.PATCH`, numbers only). Bump it for every store upload; stores reject a repeated version.

## Build and package

```bash
VITE_ENVIRONMENT=production VITE_API_URL=https://www.eguard.family VITE_WEB_APP_URL=https://www.eguard.family npm run build
cd dist/chrome && zip -r ../eguard-chrome-<version>.zip . ; cd -
cd dist/edge && zip -r ../eguard-edge-<version>.zip . ; cd -
cd dist/firefox && zip -r ../eguard-firefox-<version>.zip . ; cd -
```

Production builds refuse `http://` URLs. Check the manifest name has no environment suffix.

## Before every release

- [ ] `npm run lint && npm run typecheck && npm test && npm run test:e2e` pass
- [ ] Manual check in Chrome, Edge and Firefox ([TESTING.md](TESTING.md#manual-check-each-browser))
- [ ] `npm audit` clean
- [ ] New permissions? Update [SECURITY.md](SECURITY.md#permissions), the manifest test and the store justifications
- [ ] Capability changes reflected in the matrix and validated in each browser
- [ ] Privacy text (extension, [PRIVACY.md](PRIVACY.md), store listing) still true

## Store notes

- **Chrome Web Store:** single purpose ("apply and verify a family's web-protection settings"), a justification per permission, privacy-practices form matching PRIVACY.md, and a privacy policy URL (eguard.family/privacy).
- **Microsoft Edge Add-ons:** same package as Chrome (`dist/edge`); same disclosures.
- **Firefox (AMO):** the bundle is built, so upload source with build instructions (this repo + `npm ci && npm run build`). Declare `browser_specific_settings.gecko.data_collection_permissions` in the manifest before submission; decide the categories against PRIVACY.md (pairing sends technical browser info; health results are "technical and interaction" data; daily blocked counts per category are aggregated "browsing activity" at most, with no sites).
- Enterprise force-install (tamper resistance): publish the extension IDs and an example `ExtensionInstallForcelist` / Firefox `policies.json` for parents and schools.
