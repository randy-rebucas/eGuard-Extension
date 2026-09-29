import type { BrowserInfo, Issue, PolicySummary, ProtectionState, ProtectionStatus } from "@eguard/schemas";
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
   * The protection rules for the current policy are installed in the browser and were read back.
   * Nothing sets this until the protection engine exists (Phase 4), so PROTECTED is unreachable
   * until then. That is intended: eGuard never claims protection it can't verify.
   */
  rulesVerified: boolean;
  /**
   * extension.isAllowedIncognitoAccess(): extensions don't run in private windows unless the user allows it,
   * so without it private windows get around every rule. null when the browser can't tell us.
   */
  privateWindowsAllowed?: boolean | null;
  sync: SyncRecord | null;
  lastHealthCheckAt: string | null;
  now: number;
};

const OFFLINE_KINDS = new Set(["network", "timeout", "server"]);

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
      "Some protection features are unavailable in this browser",
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
    return result(
      "NEEDS_ATTENTION",
      "Protection needs attention",
      "eGuard has your family policy, but its protection rules aren't active in this browser.",
      [
        {
          id: "rules-not-active",
          status: "WARNING",
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

  const lastSuccess = sync?.lastSuccessAt ? Date.parse(sync.lastSuccessAt) : null;
  const stale = lastSuccess === null || input.now - lastSuccess > SYNC_STALE_MS;
  if (offline || stale) {
    return result(
      "SYNC_PAUSED",
      "Sync paused",
      `Your last verified protection policy (version ${input.policyVersion}) is still active. Sync will resume automatically.`,
      [
        {
          id: "sync-paused",
          status: "WARNING",
          title: "Couldn't reach eGuard",
          detail: sync?.lastError?.message ?? "No successful sync in the last day.",
          action: "SYNC_NOW",
        },
        ...(privateIssue ? [privateIssue] : []),
      ],
    );
  }

  if (privateIssue) {
    return result(
      "NEEDS_ATTENTION",
      "Protection needs attention",
      "Websites are protected in normal windows, but not in private ones.",
      [privateIssue],
    );
  }

  return result(
    "PROTECTED",
    "Protection active",
    "This browser matches your family's protection settings.",
    [],
  );
}
