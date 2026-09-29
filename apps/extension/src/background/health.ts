import { capabilitiesFor } from "@eguard/browser-adapter";
import type { BrowserInfo, CapabilityId, HealthCheck } from "@eguard/schemas";
import type { SyncRecord } from "./state.ts";
import { SYNC_STALE_MS, privateWindowsHelp } from "./status.ts";

/**
 * chrome.privacy.services.safeBrowsingEnabled, narrowed. `level` is the browser's levelOfControl:
 * whether eGuard holds the setting, could take it, or something else (another extension, a policy) does.
 */
export type SafeBrowsingLevel =
  | "controlled_by_this_extension"
  | "controllable_by_this_extension"
  | "controlled_by_other_extensions"
  | "not_controllable";
export interface SafeBrowsingApi {
  get(): Promise<{ value: boolean; level: SafeBrowsingLevel }>;
  set(value: boolean): Promise<void>;
  /** Gives the setting back to the person using the browser. */
  clear(): Promise<void>;
}

/** What eGuard read from the browser for one health check. Pure input, so every branch is unit-tested. */
export type HealthInput = {
  browser: BrowserInfo;
  /** Version of the stored policy whose signature verified, or null */
  policyVersion: number | null;
  /** The verified policy asks for the browser's malware and phishing protection */
  wantsSafeBrowsing: boolean | null;
  rulesVerified: boolean;
  privateWindowsAllowed: boolean | null;
  sync: SyncRecord | null;
  /** Safe Browsing as read back; null where eGuard can't read it in this browser */
  safeBrowsing: { value: boolean; level: SafeBrowsingLevel } | null;
  /** management.getSelf().installType, or null where the browser can't say */
  installType: string | null;
  now: number;
};

const note = (browser: BrowserInfo, id: CapabilityId) =>
  capabilitiesFor(browser.family).find((c) => c.id === id)?.note ?? "";

const OFFLINE_KINDS = new Set(["network", "timeout", "server"]);

/** The six self-checks, in the order the popup lists them. Guidance is for a parent at the child's computer. */
export function buildChecks(i: HealthInput): HealthCheck[] {
  const b = i.browser;
  const hasPolicy = i.policyVersion !== null;
  const checks: HealthCheck[] = [];

  checks.push(
    hasPolicy
      ? {
          id: "policy_signature",
          status: "PASS",
          title: "Family settings verified",
          detail: `Version ${i.policyVersion} of your family's settings is signed by eGuard and hasn't been changed.`,
        }
      : {
          id: "policy_signature",
          status: "ACTION_REQUIRED",
          title: "No verified family settings",
          detail:
            "eGuard hasn't received family settings it could verify. It keeps trying; Sync now tries again.",
        },
  );

  checks.push(
    !hasPolicy
      ? {
          id: "rules_installed",
          status: "NOT_CONFIGURED",
          title: "Website rules waiting",
          detail: "The rules are set up as soon as your family's settings arrive.",
        }
      : i.rulesVerified
        ? {
            id: "rules_installed",
            status: "PASS",
            title: "Website rules active",
            detail: `${b.name} has exactly the blocking rules your family's settings need, read back just now.`,
          }
        : {
            id: "rules_installed",
            status: "ACTION_REQUIRED",
            title: "Website rules not active",
            detail: `The rules in ${b.name} don't match your family's settings. Run a health check to set them up again.`,
          },
  );

  checks.push(
    i.privateWindowsAllowed === true
      ? {
          id: "private_windows",
          status: "PASS",
          title: "Private windows protected",
          detail: `eGuard is allowed to run in ${b.name}'s private windows.`,
        }
      : i.privateWindowsAllowed === false
        ? {
            id: "private_windows",
            status: "WARNING",
            title: "Private windows aren't protected",
            detail: privateWindowsHelp(b),
          }
        : {
            id: "private_windows",
            status: "UNSUPPORTED",
            title: "Private windows not checked",
            detail: `${b.name} doesn't let eGuard check whether it runs in private windows.`,
          },
  );

  const lastSuccess = i.sync?.lastSuccessAt ? Date.parse(i.sync.lastSuccessAt) : null;
  const offline = !!i.sync?.lastError && OFFLINE_KINDS.has(i.sync.lastError.kind);
  const fresh = lastSuccess !== null && i.now - lastSuccess <= SYNC_STALE_MS && !offline;
  checks.push(
    fresh
      ? {
          id: "sync_fresh",
          status: "PASS",
          title: "Up to date",
          detail: "eGuard checked for new family settings in the last day.",
        }
      : {
          id: "sync_fresh",
          status: "WARNING",
          title: "Sync paused",
          detail: `${i.sync?.lastError?.message ?? "eGuard hasn't reached its servers in the last day."} The last settings stay active.`,
        },
  );

  checks.push(safeBrowsingCheck(i));

  checks.push(
    i.installType === "admin"
      ? {
          id: "force_installed",
          status: "PASS",
          title: "Can't be removed",
          detail: `eGuard was installed by a ${b.name} policy, so it can't be removed or turned off in this browser.`,
        }
      : i.installType === null
        ? {
            id: "force_installed",
            status: "UNSUPPORTED",
            title: "Removal protection not checked",
            detail: `${b.name} doesn't tell eGuard how it was installed.`,
          }
        : {
            id: "force_installed",
            status: "NOT_CONFIGURED",
            title: "Can be removed",
            detail: `${note(b, "TAMPER_RESISTANCE")} Without it, eGuard tells you when this browser stops checking in.`,
          },
  );
  return checks;
}

function safeBrowsingCheck(i: HealthInput): HealthCheck {
  const b = i.browser;
  const id = "safe_browsing" as const;
  if (i.wantsSafeBrowsing === null)
    return {
      id,
      status: "NOT_CONFIGURED",
      title: "Malware protection waiting",
      detail: "Checked once your family's settings arrive.",
    };
  if (!i.wantsSafeBrowsing)
    return {
      id,
      status: "NOT_CONFIGURED",
      title: "Malware protection off in eGuard",
      detail: `Your family's settings don't ask eGuard to keep ${b.name}'s malware and phishing protection on.`,
    };
  if (!i.safeBrowsing)
    return {
      id,
      status: "UNSUPPORTED",
      title: "Malware protection: check it yourself",
      detail: note(b, "BROWSER_SAFE_BROWSING"),
    };
  if (i.safeBrowsing.value)
    return {
      id,
      status: "PASS",
      title: "Malware protection on",
      detail:
        i.safeBrowsing.level === "controlled_by_this_extension"
          ? `eGuard keeps ${b.name}'s Safe Browsing on, so it can't be switched off in settings.`
          : `${b.name}'s Safe Browsing is on.`,
    };
  return {
    id,
    status: "ACTION_REQUIRED",
    title: "Malware protection is off",
    detail:
      i.safeBrowsing.level === "controlled_by_other_extensions"
        ? `Another extension controls ${b.name}'s Safe Browsing and has turned it off. Remove or turn off that extension, then run a health check.`
        : `${b.name}'s Safe Browsing is off and eGuard isn't allowed to change it (a browser policy may control it). Open ${b.name}'s Privacy and security settings and choose Standard or Enhanced protection.`,
  };
}

/** Whether the report to eGuard differs from the last one sent (then it goes now, not at the hourly refresh). */
export const reportKey = (r: {
  state: string;
  policyVersion: number | null;
  checks: { id: string; status: string }[];
}) => JSON.stringify([r.state, r.policyVersion, r.checks.map((c) => `${c.id}:${c.status}`)]);

/** "YYYY-MM-DD" for `now` in `timeZone` (the family's), or in UTC if the zone is unknown. */
export function dayIn(timeZone: string | undefined, now: Date): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
