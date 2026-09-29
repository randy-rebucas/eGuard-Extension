import {
  createAccessRequest,
  fetchPolicy,
  listAccessRequests,
  pair,
  reportEvents,
  reportHealth as postHealth,
  type HttpClient,
  type TokenManager,
} from "@eguard/api-client";
import { isSupportedBrowser } from "@eguard/browser-adapter";
import { categoryIndex, domainCovers, evaluateUrl, httpHost, isScheduleActive } from "@eguard/policy-engine";
import type {
  BlockInfo,
  BrowserInfo,
  BrowserProtectionPolicy,
  PolicySummary,
  ProtectionStatus,
} from "@eguard/schemas";
import type { Enforcement } from "./enforcement.ts";
import { buildChecks, dayIn, reportKey, type SafeBrowsingApi } from "./health.ts";
import type { State } from "./state.ts";
import { deriveStatus } from "./status.ts";

/** A health report goes to eGuard when something changed, and at least this often while nothing does. */
export const REPORT_EVERY_MS = 60 * 60_000;
/** Daily counts eGuard couldn't take yet are kept this long, then dropped (the server refuses older days). */
export const KEEP_COUNTS_DAYS = 14;

/** Counts and switches only: the popup shows what kind of protection is set, never which sites. */
export function summarize(
  p: BrowserProtectionPolicy,
  now: Date,
  blockedToday: Record<string, number> = {},
): PolicySummary {
  return {
    safeSearch: p.safeSearch,
    safeBrowsing: p.safeBrowsing,
    blockedCategories: p.blockedCategories.length,
    categories: [...p.blockedCategories],
    blockedToday,
    blockedSites: p.blockedDomains.length,
    allowedSites: p.allowedDomains.length,
    otherSites: p.unknownSitesPolicy,
    focusHours: p.schedule?.enabled
      ? {
          startTime: p.schedule.startTime,
          endTime: p.schedule.endTime,
          activeNow: isScheduleActive(p.schedule, now),
        }
      : null,
  };
}

export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export type ServiceDeps = {
  state: State;
  http: HttpClient;
  tokens: TokenManager;
  browser: BrowserInfo;
  extensionVersion: string;
  platform: () => Promise<string>;
  openTab: (url: string) => Promise<void>;
  webAppUrl: string;
  onboardingUrl: string;
  /** Checks eGuard's signature over a policy (policy-engine verifyPolicySignature with the built-in key). */
  verifyPolicy: (policy: BrowserProtectionPolicy, signature: string) => Promise<boolean>;
  enforcement: Enforcement;
  /** extension.isAllowedIncognitoAccess(), or null where the browser can't say. */
  privateWindowsAllowed: () => Promise<boolean | null>;
  /** Sends a tab to the eGuard block page for `url`. */
  openBlockPage: (tabId: number, url: string) => Promise<void>;
  /** The browser's own Safe Browsing switch, where eGuard can hold it on (Chrome); null elsewhere. */
  safeBrowsing: SafeBrowsingApi | null;
  /** management.getSelf().installType ("admin" when force-installed by policy), or null where unavailable. */
  installType: () => Promise<string | null>;
  now?: () => number;
  log?: (event: string, detail?: Record<string, unknown>) => void;
  /** Called after anything that can change the status (badge updates). */
  onStatus?: (s: ProtectionStatus) => void | Promise<void>;
};

export function createService(d: ServiceDeps) {
  const now = d.now ?? Date.now;
  const iso = () => new Date(now()).toISOString();
  const log = d.log ?? (() => {});

  /**
   * The stored policy, only if eGuard's signature still matches it. Anything else (edited in storage,
   * corrupted) is discarded so the next sync downloads a genuine one; it is never enforced or shown.
   */
  async function loadPolicy() {
    const stored = await d.state.policy.get();
    if (!stored) return null;
    if (await d.verifyPolicy(stored.policy, stored.signature)) return stored;
    log("stored_policy_invalid", { version: stored.policy.version });
    await d.state.policy.remove();
    return null;
  }

  async function getStatus(): Promise<ProtectionStatus> {
    const [installation, policy, sync, health, privateWindowsAllowed, safeBrowsing, installType, counts] =
      await Promise.all([
        d.state.installation.get(),
        loadPolicy(),
        d.state.sync.get(),
        d.state.health.get(),
        d.privateWindowsAllowed().catch(() => null),
        d.safeBrowsing ? d.safeBrowsing.get().catch(() => null) : null,
        d.installType().catch(() => null),
        d.state.blockCounts.get(),
      ]);
    // Read back from the browser every time: what's installed must be exactly what the verified policy requires
    const rulesVerified = installation
      ? await d.enforcement.verify(policy?.policy ?? null, new Date(now()))
      : false;
    const policyVersion = policy?.policy.version ?? null;
    const checks = buildChecks({
      browser: d.browser,
      policyVersion,
      wantsSafeBrowsing: policy?.policy.safeBrowsing ?? null,
      rulesVerified,
      privateWindowsAllowed,
      sync,
      safeBrowsing,
      installType,
      now: now(),
    });
    const status = deriveStatus({
      browser: d.browser,
      supported: isSupportedBrowser(d.browser),
      installation,
      policyVersion,
      policySummary: policy
        ? summarize(
            policy.policy,
            new Date(now()),
            counts?.[dayIn(policy.policy.schedule?.timezone, new Date(now()))] ?? {},
          )
        : null,
      rulesVerified,
      privateWindowsAllowed,
      sync,
      lastHealthCheckAt: health?.lastCheckAt ?? null,
      checks,
      now: now(),
    });
    await d.onStatus?.(status);
    return status;
  }

  /**
   * Downloads the family policy. A failed sync never removes the policy already in force (spec §22),
   * and a policy with a lower version than the one we hold is refused (rollback/replay protection).
   */
  async function syncPolicy(): Promise<void> {
    const installation = await d.state.installation.get();
    if (!installation) throw new UserFacingError("Connect this browser to eGuard first.", "NOT_CONNECTED");
    const attemptAt = iso();
    const prev = (await d.state.sync.get()) ?? { lastAttemptAt: null, lastSuccessAt: null, lastError: null };
    const res = await fetchPolicy(d.tokens);

    if (!res.ok) {
      if (res.kind === "unauthorized") return; // onRevoked already forgot the installation
      await d.state.sync.set({
        ...prev,
        lastAttemptAt: attemptAt,
        lastError: { kind: res.kind, message: res.message, at: attemptAt },
      });
      log("sync_failed", { kind: res.kind });
      return;
    }

    const { policy: incoming, signature, keyId } = res.data;
    const current = await loadPolicy();
    const reject = async (why: string) => {
      log("policy_rejected", { why, incoming: incoming.version, current: current?.policy.version });
      const message =
        "eGuard received a policy this browser couldn't accept. Your current protection stays active.";
      await d.state.sync.set({
        ...prev,
        lastAttemptAt: attemptAt,
        lastError: { kind: "invalid_response", message, at: attemptAt },
      });
    };
    if (!(await d.verifyPolicy(incoming, signature))) return reject("bad_signature");
    if (incoming.installationId !== installation.installationId) return reject("installation_mismatch");
    if (current && incoming.version < current.policy.version) return reject("version_rollback");

    if (!current || incoming.version > current.policy.version) {
      await d.state.policy.set({ policy: incoming, signature, keyId, receivedAt: attemptAt });
      log("policy_updated", { version: incoming.version });
    }
    await d.state.sync.set({ lastAttemptAt: attemptAt, lastSuccessAt: attemptAt, lastError: null });
    await enforce();
  }

  /**
   * Makes the browser's rules match the verified policy at this moment (focus hours and approvals depend on
   * the clock). No connection means no rules: a browser the parent removed stops being filtered.
   */
  async function enforce(): Promise<boolean> {
    const installation = await d.state.installation.get();
    const policy = installation ? await loadPolicy() : null;
    const ok = await d.enforcement.apply(policy?.policy ?? null, new Date(now()));
    await keepSafeBrowsing(policy?.policy.safeBrowsing ?? false);
    return ok;
  }

  /**
   * Holds the browser's Safe Browsing on while the family asks for it (settings then show it as managed by
   * eGuard), and hands it back otherwise. If something else controls it, the health check says so.
   */
  async function keepSafeBrowsing(wanted: boolean): Promise<void> {
    if (!d.safeBrowsing) return;
    try {
      const cur = await d.safeBrowsing.get();
      const ours = cur.level === "controlled_by_this_extension";
      if (wanted && (cur.level === "controllable_by_this_extension" || (ours && !cur.value))) {
        await d.safeBrowsing.set(true);
        log("safe_browsing_held");
      } else if (!wanted && ours) {
        await d.safeBrowsing.clear();
        log("safe_browsing_released");
      }
    } catch (err) {
      log("safe_browsing_failed", { error: String(err) });
    }
  }

  /** The browser reported a failed top-level load: if eGuard blocked it, show the block page instead. */
  async function onNavigationError(tabId: number, url: string): Promise<void> {
    const policy = await loadPolicy();
    const host = httpHost(url);
    if (!policy || !host || (await d.enforcement.isContinued(host, new Date(now())))) return;
    const ev = evaluateUrl(policy.policy, url, {
      now: new Date(now()),
      categoryOf: categoryIndex(policy.policy),
    });
    if (ev.decision === "ALLOW") return;
    await d.openBlockPage(tabId, url);
    await countBlocked(
      ev.reason.type === "CATEGORY" ? ev.reason.category : ev.reason.type,
      policy.policy.schedule?.timezone,
    );
  }

  /** One more blocked page today, under its category or reason. Never the site. */
  async function countBlocked(key: string, timeZone: string | undefined): Promise<void> {
    const day = dayIn(timeZone, new Date(now()));
    const counts = (await d.state.blockCounts.get()) ?? {};
    const today = counts[day] ?? {};
    today[key] = (today[key] ?? 0) + 1;
    counts[day] = today;
    await d.state.blockCounts.set(counts);
  }

  /**
   * Sends finished days' counts (today's keeps growing until tomorrow). A day eGuard took or refused is
   * forgotten; one that couldn't be sent waits for the next try, for up to KEEP_COUNTS_DAYS.
   */
  async function sendDailyCounts(): Promise<void> {
    if (!(await d.state.installation.get())) return;
    const counts = await d.state.blockCounts.get();
    if (!counts) return;
    const tz = (await loadPolicy())?.policy.schedule?.timezone;
    const today = dayIn(tz, new Date(now()));
    const oldest = dayIn(tz, new Date(now() - KEEP_COUNTS_DAYS * 864e5));
    const done = new Set(Object.keys(counts).filter((day) => day < oldest));
    for (const day of Object.keys(counts).sort()) {
      if (day >= today || done.has(day)) continue;
      const res = await reportEvents(d.tokens, { date: day, blocked: counts[day] ?? {} });
      if (!res.ok && res.kind !== "rejected") {
        log("counts_not_sent", { kind: res.kind });
        break;
      }
      done.add(day);
    }
    if (!(await d.state.installation.get())) return; // disconnected meanwhile
    await d.state.blockCounts.set(
      Object.fromEntries(Object.entries(counts).filter(([day]) => !done.has(day))),
    );
  }

  /** Everything the block page shows, worked out here from the verified policy (the page is never trusted). */
  async function blockInfo(url: string): Promise<BlockInfo> {
    const host = httpHost(url);
    if (!host) throw new UserFacingError("That isn't a web address.", "INVALID_URL");
    const [policy, installation] = await Promise.all([loadPolicy(), d.state.installation.get()]);
    const childName = installation?.childName ?? null;
    if (!policy) return { url, host, decision: "ALLOW", reason: null, childName, request: null };
    const ev = evaluateUrl(policy.policy, url, {
      now: new Date(now()),
      categoryOf: categoryIndex(policy.policy),
    });
    const reason: BlockInfo["reason"] =
      ev.reason.type === "BLOCKED_SITE"
        ? { type: "BLOCKED_SITE" }
        : ev.reason.type === "CATEGORY"
          ? { type: "CATEGORY", category: ev.reason.category }
          : ev.reason.type === "FOCUS_HOURS"
            ? { type: "FOCUS_HOURS", until: policy.policy.schedule?.endTime ?? "" }
            : ev.reason.type === "UNKNOWN_SITE"
              ? { type: "UNKNOWN_SITE" }
              : null;
    let request: BlockInfo["request"] = null;
    if (ev.decision !== "ALLOW" && installation) {
      const res = await listAccessRequests(d.tokens);
      const latest = res.ok ? res.data.requests.find((r) => domainCovers(r.domain, host)) : undefined;
      if (latest) request = { status: latest.status, duration: latest.duration };
    }
    return { url, host, decision: ev.decision, reason, childName, request };
  }

  /** "Continue" on a warning. Refused for anything the policy blocks outright. */
  async function continueToSite(url: string): Promise<void> {
    const info = await blockInfo(url);
    if (info.decision !== "WARN") {
      throw new UserFacingError("This site is blocked by your family's settings.", "NOT_ALLOWED");
    }
    await d.enforcement.allowForAWhile(info.host, new Date(now()));
    log("warning_continued");
  }

  async function requestAccess(url: string, reason: string | undefined): Promise<BlockInfo> {
    const host = httpHost(url);
    if (!host) throw new UserFacingError("That isn't a web address.", "INVALID_URL");
    if (!(await d.state.installation.get()))
      throw new UserFacingError("This browser isn't connected to eGuard.", "NOT_CONNECTED");
    const res = await createAccessRequest(d.tokens, { domain: host, reason });
    if (!res.ok)
      throw new UserFacingError(res.message, res.kind === "rate_limited" ? "RATE_LIMITED" : "REQUEST_FAILED");
    return blockInfo(url);
  }

  /** "Check again" on the block page: fetch the latest policy (a parent may have just said yes), then re-evaluate. */
  async function checkAccess(url: string): Promise<BlockInfo> {
    if (await d.state.installation.get())
      await syncPolicy().catch((err: unknown) => log("check_sync_failed", { error: String(err) }));
    return blockInfo(url);
  }

  async function pairWithCode(code: string): Promise<void> {
    if (await d.state.installation.get()) {
      throw new UserFacingError(
        "This browser is already connected to eGuard. To connect it to a different child, remove it in the parent dashboard first.",
        "ALREADY_PAIRED",
      );
    }
    const res = await pair(d.http, {
      code,
      browser: d.browser.name,
      browserVersion: d.browser.version,
      extensionVersion: d.extensionVersion,
      platform: await d.platform(),
    });
    if (!res.ok)
      throw new UserFacingError(
        res.message,
        res.kind === "rejected" ? "PAIRING_REJECTED" : res.kind.toUpperCase(),
      );
    const g = res.data;
    await d.state.credentials.setCredential({
      installationId: g.installationId,
      refreshToken: g.refreshToken,
    });
    await d.state.credentials.setAccess({ token: g.accessToken, expiresAt: g.accessTokenExpiresAt });
    await d.state.installation.set({
      installationId: g.installationId,
      familyName: g.familyName,
      childName: g.childName,
      deviceName: g.deviceName,
      pairedAt: iso(),
    });
    log("paired", { installationId: g.installationId });
    // First policy download. Pairing succeeded even if this fails; sync retries on its alarm.
    await syncPolicy().catch((err: unknown) => log("first_sync_failed", { error: String(err) }));
    // The parent sees this browser's health right away, not at the next alarm
    await reportHealth(true).catch((err: unknown) => log("first_report_failed", { error: String(err) }));
  }

  /**
   * Runs the self-checks and tells eGuard when the result changed, when `force`d (a parent pressed Run health
   * check), or at least every REPORT_EVERY_MS. If eGuard can't be reached, the next check tries again.
   */
  async function reportHealth(force = false): Promise<void> {
    if (!(await d.state.installation.get())) return;
    const status = await getStatus();
    const prev = await d.state.health.get();
    const at = iso();
    const body = {
      state: status.state,
      policyVersion: status.policyVersion,
      checks: status.checks.map((c) => ({ id: c.id, status: c.status })),
    };
    const key = reportKey(body);
    const due =
      force ||
      !prev?.lastReportAt ||
      key !== prev.lastReportKey ||
      now() - Date.parse(prev.lastReportAt) >= REPORT_EVERY_MS;
    let sent = false;
    if (due) {
      const res = await postHealth(d.tokens, body);
      sent = res.ok;
      if (!res.ok) log("health_not_sent", { kind: res.kind });
    }
    if (!(await d.state.installation.get())) return; // the report found this browser removed
    await d.state.health.set(
      sent ? { lastCheckAt: at, lastReportAt: at, lastReportKey: key } : { ...prev, lastCheckAt: at },
    );
  }

  /** "Run health check": fetch the latest policy, re-apply everything, check it and report it now. */
  async function runHealthCheck(): Promise<void> {
    if (!(await d.state.installation.get())) {
      await enforce(); // clears anything left over from an earlier connection
      await d.state.health.set({ lastCheckAt: iso() });
      return;
    }
    await syncPolicy();
    await enforce();
    await reportHealth(true);
  }

  /** Every sync alarm: the latest policy, then the checks (reported if they changed) and finished days' counts. */
  async function periodic(): Promise<void> {
    if (!(await d.state.installation.get())) return;
    await syncPolicy();
    await reportHealth();
    await sendDailyCounts();
  }

  return {
    getStatus,
    syncPolicy,
    enforce,
    onNavigationError,
    blockInfo,
    continueToSite,
    requestAccess,
    checkAccess,
    pairWithCode,
    runHealthCheck,
    reportHealth,
    sendDailyCounts,
    periodic,
    openDashboard: () => d.openTab(`${d.webAppUrl}/dashboard`),
    openOnboarding: () => d.openTab(d.onboardingUrl),
  };
}

export type Service = ReturnType<typeof createService>;
