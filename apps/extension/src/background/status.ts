import type {
  BrowserInfo,
  HealthCheck,
  Issue,
  PolicySummary,
  ProtectionState,
  ProtectionStatus,
} from "@eguard/schemas";
import type { Installation, SyncRecord } from "./state.ts";

/** Without a successful sync for this long, the popup says sync is paused (protection stays on). */
export const SYNC_STALE_MS = 24 * 3600_000;

export type StatusInput = {
  browser: BrowserInfo;
  supported: boolean;
  installation: Installation | null;
  policyVersion: number | null;
  /** The verified policy's settings, for display. */
  policySummary?: PolicySummary | null;
  /**
   * The protection rules for the current policy are installed in the browser and were read back
   * (enforcement.verify). Without it PROTECTED is unreachable: eGuard never claims protection it can't verify.
   */
  rulesVerified: boolean;
  /**
   * extension.isAllowedIncognitoAccess(): extensions don't run in private windows unless the user allows it,
   * so without it private windows get around every rule. null when the browser can't tell us.
   */
  privateWindowsAllowed?: boolean | null;
  sync: SyncRecord | null;
  lastHealthCheckAt: string | null;
  /** The self-checks (health.ts buildChecks), shown as they are; a failed Safe Browsing or site-access check also needs attention. */
  checks?: HealthCheck[];
  now: number;
};

const OFFLINE_KINDS = new Set(["network", "timeout", "server"]);

/** The failure means eGuard couldn't be reached (not that it refused something). */
export const isOffline = (kind: string | undefined) => kind !== undefined && OFFLINE_KINDS.has(kind);

/**
 * The last sync failed (a success clears lastError). Any failure, not only an unreachable server: settings eGuard
 * sent but this browser refused (signature, older version) or a refused sign-in leave it on old settings too, and
 * it mustn't read "Protection active" or "Up to date" meanwhile.
 */
export const syncFailed = (sync: SyncRecord | null) => !!sync?.lastError;

/** What went wrong with the last sync, in a few words. */
export function syncProblem(kind: string | undefined): string {
  if (kind === undefined || OFFLINE_KINDS.has(kind)) return "Couldn't reach eGuard";
  if (kind === "refused" || kind === "invalid_response") return "Couldn't accept new family settings";
  if (kind === "unauthorized") return "eGuard didn't accept this browser's sign-in";
  return "Couldn't get new family settings";
}

/** Where each browser keeps the switch. Steps, not a link: extensions can't open these settings pages. */
export function privateWindowsHelp(b: BrowserInfo): string {
  switch (b.family) {
    case "firefox":
      return "Open Firefox's menu › Add-ons and themes › eGuard, and set Run in Private Windows to Allow.";
    case "edge":
      return "Open edge://extensions, choose Details under eGuard, and turn on Allow in InPrivate.";
    default: {
      const scheme = b.family === "brave" || b.family === "opera" ? b.family : "chrome";
      return `Open ${scheme}://extensions, choose Details under eGuard, and turn on Allow in Incognito.`;
    }
  }
}

/** The answer to "am I protected?", from facts only. Pure, so every branch is unit-tested. */
export function deriveStatus(input: StatusInput): ProtectionStatus {
  const { browser, installation, sync } = input;
  const base = {
    browser,
    connection: installation
      ? {
          paired: true as const,
          installationId: installation.installationId,
          familyName: installation.familyName,
          childName: installation.childName,
          deviceName: installation.deviceName,
        }
      : { paired: false as const },
    policyVersion: input.policyVersion,
    policySummary: input.policySummary ?? null,
    lastSyncAt: sync?.lastSuccessAt ?? null,
    lastHealthCheckAt: input.lastHealthCheckAt,
    checks: installation ? (input.checks ?? []) : [],
  };
  const result = (
    state: ProtectionState,
    headline: string,
    summary: string,
    issues: Issue[],
  ): ProtectionStatus => ({
    ...base,
    state,
    headline,
    summary,
    issues,
  });

  if (!input.supported) {
    return result(
      "UNSUPPORTED",
      "eGuard can't protect this browser",
      `eGuard can't protect ${browser.name}${browser.version ? ` ${browser.major ?? browser.version}` : ""} yet. Use Chrome, Edge or Firefox for full protection.`,
      [],
    );
  }

  if (!installation) {
    return result(
      "ACTION_REQUIRED",
      "Protection configuration required",
      "Connect this browser to your eGuard family to turn on protection.",
      [
        {
          id: "not-connected",
          status: "ACTION_REQUIRED",
          title: "Browser not connected",
          detail: "A parent needs to enter a pairing code from the eGuard dashboard.",
          action: "CONNECT",
        },
      ],
    );
  }

  const offline = !!sync?.lastError && OFFLINE_KINDS.has(sync.lastError.kind);

  if (input.policyVersion === null) {
    return result(
      "ACTION_REQUIRED",
      "Protection configuration required",
      offline
        ? "Connected, but eGuard couldn't download your family policy yet. It will keep trying."
        : "Connected. Waiting for your family policy from eGuard.",
      [
        {
          id: "no-policy",
          status: "ACTION_REQUIRED",
          title: "Family policy not received",
          detail: sync?.lastError?.message ?? "The first sync hasn't finished yet.",
          action: "SYNC_NOW",
        },
      ],
    );
  }

  if (!input.rulesVerified) {
    // Nothing may be blocked: the same weight as the rules_installed check, and as the parent's card says it
    return result(
      "ACTION_REQUIRED",
      "Protection needs attention",
      "eGuard has your family policy, but its protection rules aren't active in this browser.",
      [
        {
          id: "rules-not-active",
          status: "ACTION_REQUIRED",
          title: "Website protection not active",
          detail: `The rules for policy version ${input.policyVersion} aren't in place in ${browser.name} yet. Run a health check to set them up again.`,
          action: "RUN_HEALTH_CHECK",
        },
      ],
    );
  }

  const privateIssue =
    input.privateWindowsAllowed === true
      ? null
      : {
          id: "private-windows",
          status: "WARNING" as const,
          title: "Private windows aren't protected",
          detail:
            input.privateWindowsAllowed === false
              ? privateWindowsHelp(browser)
              : `eGuard can't check whether it runs in ${browser.name}'s private windows.`,
          action: null,
        };

  // Self-checks that need a parent: shown as issues, so the browser isn't called Protected meanwhile
  const needsParent = (input.checks ?? []).filter(
    (c) => (c.id === "safe_browsing" || c.id === "site_access") && c.status === "ACTION_REQUIRED",
  );
  const attention: Issue[] = [
    ...(privateIssue ? [privateIssue] : []),
    ...needsParent.map((c) => ({
      id: c.id.replace("_", "-"),
      status: c.status,
      title: c.title,
      detail: c.detail,
      action: null,
    })),
  ];

  const lastSuccess = sync?.lastSuccessAt ? Date.parse(sync.lastSuccessAt) : null;
  const stale = lastSuccess === null || input.now - lastSuccess > SYNC_STALE_MS;
  if (syncFailed(sync) || stale) {
    return result(
      "SYNC_PAUSED",
      "Sync paused",
      `Your last verified protection policy (version ${input.policyVersion}) is still active. eGuard keeps trying to get the latest.`,
      [
        {
          id: "sync-paused",
          status: "WARNING",
          title: syncProblem(sync?.lastError?.kind),
          detail: sync?.lastError?.message ?? "No successful sync in the last day.",
          action: "SYNC_NOW",
        },
        ...attention,
      ],
    );
  }

  if (attention.length) {
    return result(
      "NEEDS_ATTENTION",
      "Protection needs attention",
      privateIssue && !needsParent.length
        ? input.privateWindowsAllowed === false
          ? "Websites are protected in normal windows, but not in private ones."
          : "Websites are protected in normal windows. eGuard can't check private ones."
        : "Websites are protected, but part of this browser's protection needs a parent.",
      attention,
    );
  }

  return result(
    "PROTECTED",
    "Protection active",
    "This browser matches your family's protection settings.",
    [],
  );
}
