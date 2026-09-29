# Privacy

eGuard makes a child's browser safer; it doesn't watch the child. This page is written for parents and reviewers. The in-extension version is `apps/extension/src/shared/PrivacySummary.tsx` and the options page; keep them in step.

## What eGuard never does in the browser

- Keep a history of the websites your child visits
- Read messages, emails or page content (the extension has no content scripts and no access to pages)
- Record keystrokes or passwords
- Take screenshots or use the camera or microphone
- Sell data or build advertising profiles

These are promises about the shipped code, not settings. A change that would break one needs a product decision and an update here first.

## How website protection works

1. eGuard downloads the family's policy: blocked and allowed sites, blocked categories, SafeSearch and schedule.
2. It turns the policy into rules the **browser itself** evaluates (`declarativeNetRequest`). Pages that load normally are never shown to eGuard's code.
3. When a rule blocks a page, the browser reports a failed load, and only failed loads are shown to eGuard's code (`webNavigation.onErrorOccurred`). eGuard uses that to show its block page with the site's name and, if the child chooses, to include it in an access request. It doesn't store or send failed or blocked addresses otherwise.
4. For reports (Phase 5+), eGuard will keep **daily counts per category** ("3 gaming sites blocked on Sep 28"), never which site. Nothing is counted yet.

## What is sent to eGuard's servers

| Data                                                                              | When                          | Why                                                                       |
| --------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Browser name and version, extension version, OS type (`win`/`mac`/`linux`/`cros`) | Pairing, and updates on sync  | Show the parent which browser is protected; know which capabilities apply |
| Protection status and health-check results                                        | Sync / health check           | Tell the parent whether protection is working                             |
| Daily blocked counts per category                                                 | Once a day (Phase 4)          | Reports without browsing history                                          |
| An access request: the site's address and the reason typed                        | Only when the child sends one | So the parent can decide                                                  |

Nothing identifies the computer itself: the installation id is a random server-generated id, and the device name is whatever the parent typed.

## What is stored in the browser

The installation id and refresh token, the current policy, and sync/health timestamps (`storage.local`); the short-lived access token (`storage.session`, memory only). No browsing data.

## Retention

Server-side, health results and daily counts follow the family's retention setting (`Family.retentionDays`, default 90 days) through the existing maintenance job. Removing a browser in the dashboard revokes it; deleting the family account deletes everything, as for the rest of eGuard.
