import {
  createAccessRequest,
  fetchPolicy,
  listAccessRequests,
  pair,
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
import type { State } from "./state.ts";
import { deriveStatus } from "./status.ts";

/** Counts and switches only: the popup shows what kind of protection is set, never which sites. */
export function summarize(p: BrowserProtectionPolicy, now: Date): PolicySummary {
  return {
    safeSearch: p.safeSearch,
    safeBrowsing: p.safeBrowsing,
    blockedCategories: p.blockedCategories.length,
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
    const [installation, policy, sync, health, privateWindowsAllowed] = await Promise.all([
      d.state.installation.get(),
      loadPolicy(),
      d.state.sync.get(),
      d.state.health.get(),
      d.privateWindowsAllowed().catch(() => null),
    ]);
    const status = deriveStatus({
      browser: d.browser,
      supported: isSupportedBrowser(d.browser),
      installation,
      policyVersion: policy?.policy.version ?? null,
      policySummary: policy ? summarize(policy.policy, new Date(now())) : null,
      // Read back from the browser every time: what's installed must be exactly what the verified policy requires
      rulesVerified: installation
        ? await d.enforcement.verify(policy?.policy ?? null, new Date(now()))
        : false,
      privateWindowsAllowed,
      sync,
      lastHealthCheckAt: health?.lastCheckAt ?? null,
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
    return d.enforcement.apply(policy?.policy ?? null, new Date(now()));
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
    if (ev.decision !== "ALLOW") await d.openBlockPage(tabId, url);
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
  }

  /**
   * Phase 1 health check: refresh what we can observe (policy sync) and stamp the time.
   * Phase 5 adds rule read-back, permission and private-window checks, and reports to the backend.
   */
  async function runHealthCheck(): Promise<void> {
    if (await d.state.installation.get()) await syncPolicy();
    await enforce();
    await d.state.health.set({ lastCheckAt: iso() });
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
    openDashboard: () => d.openTab(`${d.webAppUrl}/dashboard`),
    openOnboarding: () => d.openTab(d.onboardingUrl),
  };
}

export type Service = ReturnType<typeof createService>;
