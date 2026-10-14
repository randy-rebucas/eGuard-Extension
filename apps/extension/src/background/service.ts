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
import {
  canonicalJson,
  categoryIndex,
  domainCovers,
  engineDomain,
  evaluateUrl,
  SAFE_SEARCH_ENGINES,
  httpHost,
  isScheduleActive,
  otherSitesDecision,
  youtubeRestrictHeader,
} from "@eguard/policy-engine";
import type {
  AccessRequest,
  BlockInfo,
  BrowserInfo,
  BrowserProtectionPolicy,
  PolicySummary,
  ProtectionStatus,
} from "@eguard/schemas";
import type { Enforcement } from "./enforcement.ts";
import { buildChecks, dayIn, reportKey, type SafeBrowsingApi } from "./health.ts";
import type { State } from "./state.ts";
import { deriveStatus, isOffline } from "./status.ts";

/** A health report goes to eGuard when something changed, and at least this often while nothing does. */
export const REPORT_EVERY_MS = 60 * 60_000;
/** Daily counts eGuard couldn't take yet are kept this long, then dropped (the server refuses older days). */
export const KEEP_COUNTS_DAYS = 14;
/** POST /events accepts each count up to this. */
const MAX_DAILY_COUNT = 100_000;
/**
 * How often buttons anyone at the computer can press again and again ("Sync now", "Check again", "Run health check")
 * reach eGuard. eGuard limits each browser's policy reads (120 per 15 minutes) and health reports (60 an hour); using
 * them up would hold back the parent's next change, and the alert about the next problem. These leave room for the
 * 5-minute sync and for reports of a changed result, which always go.
 */
export const MANUAL_LIMITS = {
  sync: { max: 60, windowMs: 15 * 60_000 },
  report: { max: 20, windowMs: 60 * 60_000 },
} as const;
/** Open block pages share one copy of this browser's access requests for this long (eGuard allows 300 reads per 15 minutes). */
export const REQUESTS_FRESH_MS = 15_000;

/** Counts and switches only: the popup shows what kind of protection is set, never which sites. */
export function summarize(
  p: BrowserProtectionPolicy,
  now: Date,
  blockedToday: Record<string, number> = {},
): PolicySummary {
  const youtube = youtubeRestrictHeader(p);
  return {
    safeSearch: p.safeSearch,
    safeBrowsing: p.safeBrowsing,
    youtubeRestrict: youtube === "Strict" ? "STRICT" : youtube === "Moderate" ? "MODERATE" : "OFF",
    blockedCategories: p.blockedCategories.length,
    categories: [...p.blockedCategories],
    blockedToday,
    blockedSites: p.blockedDomains.length,
    allowedSites: p.allowedDomains.length,
    otherSites: otherSitesDecision(p),
    focusHours: p.schedule?.enabled
      ? {
          startTime: p.schedule.startTime,
          endTime: p.schedule.endTime,
          activeNow: isScheduleActive(p.schedule, now),
        }
      : null,
  };
}

/** Where the block page can send a child to search: engines with SafeSearch that the policy lets them open. */
function searchableEngines(p: BrowserProtectionPolicy, now: Date): string[] {
  const categoryOf = categoryIndex(p);
  return SAFE_SEARCH_ENGINES.filter(
    (e) => evaluateUrl(p, `https://${e.host}/`, { now, categoryOf }).decision !== "BLOCK",
  ).map(engineDomain);
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
  /**
   * Whether the browser still grants every host permission eGuard asked for (people can withdraw them in the
   * browser's extension settings), or null where it can't say.
   */
  hostAccess: () => Promise<boolean | null>;
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
    const [
      installation,
      policy,
      sync,
      health,
      privateWindowsAllowed,
      safeBrowsing,
      installType,
      hostAccess,
      counts,
    ] = await Promise.all([
      d.state.installation.get(),
      loadPolicy(),
      d.state.sync.get(),
      d.state.health.get(),
      d.privateWindowsAllowed().catch(() => null),
      d.safeBrowsing ? d.safeBrowsing.get().catch(() => null) : null,
      d.installType().catch(() => null),
      d.hostAccess().catch(() => null),
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
      hostAccess,
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
      // A verified removal already forgot the installation (onRevoked); any other refusal is recorded like any error
      if (res.kind === "unauthorized" && !(await d.state.installation.get())) return;
      await d.state.sync.set({
        ...prev,
        lastAttemptAt: attemptAt,
        lastError: { kind: res.kind, message: res.message, at: attemptAt },
      });
      log("sync_failed", { kind: res.kind });
      return;
    }

    const { policy: incoming, signature, keyId, names } = res.data;
    const current = await loadPolicy();
    const floor = Math.max((await d.state.policyFloor.get()) ?? 0, current?.policy.version ?? 0);
    const reject = async (why: string) => {
      log("policy_rejected", { why, incoming: incoming.version, current: current?.policy.version });
      const message = "eGuard sent family settings this browser couldn't accept.";
      await d.state.sync.set({
        ...prev,
        lastAttemptAt: attemptAt,
        lastError: { kind: "refused", message, at: attemptAt },
      });
    };
    if (!(await d.verifyPolicy(incoming, signature))) return reject("bad_signature");
    if (incoming.installationId !== installation.installationId) return reject("installation_mismatch");
    if (incoming.version < floor) return reject("version_rollback");

    // The same version can still change: eGuard's category lists are updated, and expired approvals drop out,
    // without the parent editing anything. It's signed for this installation, so the newer copy is taken.
    if (
      !current ||
      incoming.version > current.policy.version ||
      canonicalJson(incoming) !== canonicalJson(current.policy)
    ) {
      await d.state.policy.set({ policy: incoming, signature, keyId, receivedAt: attemptAt });
      if (incoming.version > floor) await d.state.policyFloor.set(incoming.version);
      log("policy_updated", { version: incoming.version });
    }
    // A child or family renamed since pairing: show the names as they are now
    if (
      names &&
      (names.childName !== installation.childName ||
        names.familyName !== installation.familyName ||
        names.deviceName !== installation.deviceName)
    ) {
      await d.state.installation.set({ ...installation, ...names });
    }
    await d.state.sync.set({ lastAttemptAt: attemptAt, lastSuccessAt: attemptAt, lastError: null });
    await enforce();
  }

  /**
   * Makes the browser's rules match the verified policy at this moment (focus hours and approvals depend on
   * the clock). No connection means no rules: a browser the parent removed stops being filtered.
   *
   * Connected but without a policy that verifies (the stored one was edited or no longer matches a trusted key),
   * the rules already installed stay: they came from the last verified policy, and removing them would turn a
   * tampered or unverifiable policy into no protection at all. The status says the rules aren't verified until a
   * genuine policy arrives.
   */
  async function enforce(): Promise<boolean> {
    const installation = await d.state.installation.get();
    if (!installation) {
      const ok = await d.enforcement.apply(null, new Date(now()));
      await keepSafeBrowsing(false);
      return ok;
    }
    const policy = await loadPolicy();
    if (!policy) {
      log("rules_kept_without_policy");
      return false;
    }
    const ok = await d.enforcement.apply(policy.policy, new Date(now()));
    await keepSafeBrowsing(policy.policy.safeBrowsing);
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

  // Counts are read, changed and written back; blocks reported at the same moment would lose increments, so
  // every change to them (counting, sending) runs one after another.
  let countsQueue: Promise<unknown> = Promise.resolve();
  const serialCounts = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = countsQueue.then(fn, fn);
    countsQueue = run.catch(() => {});
    return run;
  };

  /** One more blocked page today, under its category or reason. Never the site. */
  function countBlocked(key: string, timeZone: string | undefined): Promise<void> {
    return serialCounts(async () => {
      const day = dayIn(timeZone, new Date(now()));
      const counts = (await d.state.blockCounts.get()) ?? {};
      const today = counts[day] ?? {};
      today[key] = (today[key] ?? 0) + 1;
      counts[day] = today;
      await d.state.blockCounts.set(counts);
    });
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
      // The server refuses a whole day if any count is over its cap, so cap rather than lose the day
      const blocked = Object.fromEntries(
        Object.entries(counts[day] ?? {}).map(([k, n]) => [k, Math.min(n, MAX_DAILY_COUNT)]),
      );
      const res = await reportEvents(d.tokens, { date: day, blocked });
      if (!res.ok && res.kind !== "rejected") {
        log("counts_not_sent", { kind: res.kind });
        break;
      }
      done.add(day);
    }
    await serialCounts(async () => {
      if (!(await d.state.installation.get())) return; // disconnected meanwhile
      // Re-read: pages blocked while the counts were being sent are kept
      const latest = (await d.state.blockCounts.get()) ?? {};
      await d.state.blockCounts.set(
        Object.fromEntries(Object.entries(latest).filter(([day]) => !done.has(day))),
      );
    });
  }

  // Every block page reads this browser's requests, and waiting ones poll it, so they share one recent copy
  let requestsCache: { installationId: string; at: number; requests: AccessRequest[] } | null = null;

  /**
   * This browser's recent access requests. If eGuard can't answer (offline, too many reads), the last list it gave is
   * used: a request still waiting mustn't read as never sent, offering "Ask a parent" again.
   */
  async function recentRequests(installationId: string): Promise<AccessRequest[] | null> {
    const cached = requestsCache?.installationId === installationId ? requestsCache : null;
    if (cached && now() - cached.at < REQUESTS_FRESH_MS) return cached.requests;
    const res = await listAccessRequests(d.tokens);
    if (!res.ok) {
      log("requests_not_read", { kind: res.kind });
      return cached?.requests ?? null;
    }
    requestsCache = { installationId, at: now(), requests: res.data.requests };
    return res.data.requests;
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
              : ev.reason.type === "SAFE_SEARCH"
                ? { type: "SAFE_SEARCH", engines: searchableEngines(policy.policy, new Date(now())) }
                : null;
    let request: BlockInfo["request"] = null;
    if (ev.decision !== "ALLOW" && installation) {
      const requests = await recentRequests(installation.installationId);
      const latest = requests?.find((r) => domainCovers(r.domain, host));
      if (latest) request = { status: latest.status, duration: latest.duration };
    }
    return { url, host, decision: ev.decision, reason, childName, request };
  }

  /** "Continue" on a warning. Refused for anything the policy blocks outright. */
  async function continueToSite(url: string): Promise<void> {
    const info = await blockInfo(url);
    const policy = await loadPolicy();
    if (info.decision !== "WARN" || !policy) {
      throw new UserFacingError("This site is blocked by your family's settings.", "NOT_ALLOWED");
    }
    await d.enforcement.allowForAWhile(info.host, new Date(now()), policy.policy);
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
    requestsCache = null; // the list changed
    const info = await blockInfo(url);
    // The list may not have answered: the request just made is still waiting, not missing (no second "Ask")
    return info.request
      ? info
      : { ...info, request: { status: res.data.request.status, duration: res.data.request.duration } };
  }

  /** "Check again" on the block page: fetch the latest policy (a parent may have just said yes), then re-evaluate. */
  async function checkAccess(url: string): Promise<BlockInfo> {
    const installation = await d.state.installation.get();
    const host = httpHost(url);
    if (installation && host) {
      // A parent answered after the last sync: the approval is in a policy this browser hasn't got, so no waiting
      const latest = (await recentRequests(installation.installationId))?.find((r) =>
        domainCovers(r.domain, host),
      );
      const synced = (await d.state.sync.get())?.lastSuccessAt;
      const answeredSince =
        !!latest?.decidedAt && (!synced || Date.parse(latest.decidedAt) > Date.parse(synced));
      if (answeredSince || (await allowManual("sync"))) {
        await syncPolicy().catch((err: unknown) => log("check_sync_failed", { error: String(err) }));
      }
    }
    return blockInfo(url);
  }

  // One pairing at a time: two codes sent together would both pass the "already connected" check
  let pairing: Promise<void> | null = null;
  function pairWithCode(code: string): Promise<void> {
    if (pairing) {
      return Promise.reject(
        new UserFacingError(
          "eGuard is already connecting this browser. Wait a moment.",
          "PAIRING_IN_PROGRESS",
        ),
      );
    }
    pairing = pairOnce(code).finally(() => {
      pairing = null;
    });
    return pairing;
  }

  async function pairOnce(code: string): Promise<void> {
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
  async function reportHealth(force = false, opts: { offline?: boolean } = {}): Promise<void> {
    if (!(await d.state.installation.get())) return;
    const status = await getStatus();
    const prev = await d.state.health.get();
    const at = iso();
    const body = {
      state: status.state,
      policyVersion: status.policyVersion,
      checks: status.checks.map((c) => ({ id: c.id, status: c.status })),
      // In the key too: an extension or browser update is reported at once
      extensionVersion: d.extensionVersion,
      browserVersion: d.browser.version,
    };
    const key = reportKey(body);
    const due =
      !opts.offline &&
      (force ||
        !prev?.lastReportAt ||
        key !== prev.lastReportKey ||
        now() - Date.parse(prev.lastReportAt) >= REPORT_EVERY_MS);
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

  /**
   * Counts one press of a button that reaches eGuard, and says whether it's within MANUAL_LIMITS. Kept in session
   * storage, so the worker stopping between presses doesn't start the count again.
   */
  async function allowManual(kind: keyof typeof MANUAL_LIMITS): Promise<boolean> {
    const { max, windowMs } = MANUAL_LIMITS[kind];
    const all = (await d.state.manualPresses.get()) ?? { sync: [], report: [] };
    const recent = all[kind].filter((t) => now() - t < windowMs && t <= now());
    if (recent.length >= max) {
      log("manual_limited", { kind });
      return false;
    }
    await d.state.manualPresses.set({ ...all, [kind]: [...recent, now()] });
    return true;
  }

  /**
   * "Run health check": fetch the latest policy, re-apply everything, check it and report it now. Pressed over and over
   * (MANUAL_LIMITS), the checks still run here and only a changed result is sent.
   */
  async function runHealthCheck(): Promise<void> {
    if (!(await d.state.installation.get())) {
      await enforce(); // clears anything left over from an earlier connection
      await d.state.health.set({ lastCheckAt: iso() });
      return;
    }
    if (await allowManual("sync")) await syncPolicy();
    await enforce();
    await reportHealth(await allowManual("report"));
  }

  /** "Sync now" in the popup. */
  async function syncNow(): Promise<void> {
    if (!(await d.state.installation.get())) return syncPolicy(); // says to connect first
    if (!(await allowManual("sync"))) {
      throw new UserFacingError(
        "eGuard checked for new settings many times just now. It checks again by itself within 5 minutes.",
        "RATE_LIMITED",
      );
    }
    await syncPolicy();
  }

  /**
   * Every sync alarm: the latest policy, then the checks (reported if they changed) and finished days' counts. When
   * eGuard couldn't be reached just now (the sign-in already retried), the checks still run but nothing more is sent.
   */
  async function periodic(): Promise<void> {
    if (!(await d.state.installation.get())) return;
    await syncPolicy();
    const offline = isOffline((await d.state.sync.get())?.lastError?.kind);
    await reportHealth(false, { offline });
    if (!offline) await sendDailyCounts();
  }

  return {
    getStatus,
    syncPolicy,
    syncNow,
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
