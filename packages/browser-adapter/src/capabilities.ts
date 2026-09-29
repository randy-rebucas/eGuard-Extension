import type { BrowserFamily, Capability, CapabilityId, CapabilityLevel } from "@eguard/schemas";

/**
 * What eGuard can do in each browser (spec §38/§52). This is the single source for the popup,
 * onboarding and docs/BROWSER-CAPABILITIES.md (a test keeps the doc table in sync).
 *
 * `validated` is false until the behaviour has been exercised in that browser (Phase 7).
 * Runtime health checks verify the actual state regardless; this table only sets expectations.
 */
export type MatrixEntry = {
  level: CapabilityLevel;
  verifiable: boolean;
  validated: boolean;
  note: string;
};

type Row = { id: CapabilityId; label: string; api: string; by: Record<MatrixFamily, MatrixEntry> };
export type MatrixFamily = "chrome" | "edge" | "firefox" | "safari";

const auto = (note: string, validated = false): MatrixEntry => ({
  level: "AUTOMATIC",
  verifiable: true,
  validated,
  note,
});
const guided = (note: string, verifiable: boolean): MatrixEntry => ({
  level: "GUIDED",
  verifiable,
  validated: false,
  note,
});
const unsupported = (note: string): MatrixEntry => ({
  level: "UNSUPPORTED",
  verifiable: false,
  validated: false,
  note,
});

const SAFARI = unsupported(
  "Safari hasn't been validated yet, so eGuard doesn't claim this capability there.",
);

export const CAPABILITY_MATRIX: Row[] = [
  {
    id: "WEBSITE_FILTERING",
    label: "Website blocking",
    api: "declarativeNetRequest (dynamic rules)",
    by: {
      chrome: auto("eGuard blocks sites on your family's blocked list."),
      edge: auto("eGuard blocks sites on your family's blocked list."),
      firefox: auto("eGuard blocks sites on your family's blocked list."),
      safari: SAFARI,
    },
  },
  {
    id: "DOMAIN_ALLOWLIST",
    label: "Allowed sites",
    api: "declarativeNetRequest (allow rules with higher priority)",
    by: {
      chrome: auto("Sites you allow always open, even inside a blocked category."),
      edge: auto("Sites you allow always open, even inside a blocked category."),
      firefox: auto("Sites you allow always open, even inside a blocked category."),
      safari: SAFARI,
    },
  },
  {
    id: "CATEGORY_FILTERING",
    label: "Blocked categories",
    api: "declarativeNetRequest + eGuard category lists",
    by: {
      chrome: auto(
        "Blocks the sites on eGuard's starter lists for each category. The lists aren't complete yet.",
      ),
      edge: auto(
        "Blocks the sites on eGuard's starter lists for each category. The lists aren't complete yet.",
      ),
      firefox: auto(
        "Blocks the sites on eGuard's starter lists for each category. The lists aren't complete yet.",
      ),
      safari: SAFARI,
    },
  },
  {
    id: "SAFE_SEARCH",
    label: "Safe Search",
    api: "declarativeNetRequest redirect (URL transform) on Google, Bing, DuckDuckGo",
    by: {
      chrome: auto(
        "eGuard turns on SafeSearch for Google (google.com, google.com.ph), Bing and DuckDuckGo in this browser.",
      ),
      edge: auto(
        "eGuard turns on SafeSearch for Google (google.com, google.com.ph), Bing and DuckDuckGo in this browser.",
      ),
      firefox: auto(
        "eGuard turns on SafeSearch for Google (google.com, google.com.ph), Bing and DuckDuckGo in this browser.",
      ),
      safari: SAFARI,
    },
  },
  {
    id: "BROWSER_SAFE_BROWSING",
    label: "Browser malware & phishing protection",
    api: "chrome.privacy.services.safeBrowsingEnabled (Chrome only)",
    by: {
      chrome: auto("eGuard keeps Chrome's Safe Browsing switched on."),
      edge: guided(
        "Turn on Microsoft Defender SmartScreen in Edge settings. Edge doesn't let eGuard check it.",
        false,
      ),
      firefox: guided(
        "Turn on 'Block dangerous and deceptive content' in Firefox settings. Firefox doesn't let eGuard check it.",
        false,
      ),
      safari: SAFARI,
    },
  },
  {
    id: "PRIVATE_WINDOWS",
    label: "Protection in private windows",
    api: "extension.isAllowedIncognitoAccess()",
    by: {
      chrome: guided(
        "Allow eGuard in Incognito from the extension's details page. eGuard checks it's allowed.",
        true,
      ),
      edge: guided(
        "Allow eGuard in InPrivate from the extension's details page. eGuard checks it's allowed.",
        true,
      ),
      firefox: guided(
        "Allow eGuard to run in private windows from Add-ons settings. eGuard checks it's allowed.",
        true,
      ),
      safari: SAFARI,
    },
  },
  {
    id: "SCHEDULED_PROTECTION",
    label: "Scheduled protection",
    api: "alarms + dynamic rule updates",
    by: {
      chrome: auto("eGuard switches schedule rules on and off while the browser is open."),
      edge: auto("eGuard switches schedule rules on and off while the browser is open."),
      firefox: auto("eGuard switches schedule rules on and off while the browser is open."),
      safari: SAFARI,
    },
  },
  {
    id: "TAMPER_RESISTANCE",
    label: "Can't be removed by the child",
    api: "Enterprise policy (force-install); management.getSelf().installType",
    by: {
      chrome: guided(
        "Only possible with a Chrome policy that force-installs eGuard. eGuard can check for it.",
        true,
      ),
      edge: guided(
        "Only possible with an Edge policy that force-installs eGuard. eGuard can check for it.",
        true,
      ),
      firefox: guided("Only possible with a Firefox policies.json that force-installs eGuard.", false),
      safari: SAFARI,
    },
  },
  {
    id: "POLICY_SYNC",
    label: "Family policy sync",
    api: "alarms + fetch to the eGuard API",
    by: {
      chrome: auto("Keeps this browser on your latest family policy."),
      edge: auto("Keeps this browser on your latest family policy."),
      firefox: auto("Keeps this browser on your latest family policy."),
      safari: SAFARI,
    },
  },
  {
    id: "HEALTH_CHECK",
    label: "Protection health",
    api: "Extension self-checks + backend heartbeat",
    by: {
      chrome: auto("eGuard checks its own setup and tells you when something changes."),
      edge: auto("eGuard checks its own setup and tells you when something changes."),
      firefox: auto("eGuard checks its own setup and tells you when something changes."),
      safari: SAFARI,
    },
  },
  {
    id: "PARENT_APPROVAL",
    label: "Ask a parent for access",
    api: "Extension block page + eGuard API",
    by: {
      chrome: auto("Your child can ask for a blocked site. You approve or deny in eGuard."),
      edge: auto("Your child can ask for a blocked site. You approve or deny in eGuard."),
      firefox: auto("Your child can ask for a blocked site. You approve or deny in eGuard."),
      safari: SAFARI,
    },
  },
];

/** Chromium-based browsers without their own column use Chrome's row, but nothing counts as validated. */
export function matrixFamily(family: BrowserFamily): MatrixFamily {
  if (family === "edge" || family === "firefox" || family === "safari") return family;
  return "chrome";
}

export function capabilitiesFor(
  family: BrowserFamily,
): (Capability & { label: string; validated: boolean })[] {
  const col = matrixFamily(family);
  const inherited = col === "chrome" && family !== "chrome";
  return CAPABILITY_MATRIX.map((row) => {
    const e = row.by[col];
    return {
      id: row.id,
      label: row.label,
      level: e.level,
      verifiable: e.level === "AUTOMATIC" || e.level === "VERIFICATION_ONLY" ? true : e.verifiable,
      validated: inherited ? false : e.validated,
      note: e.note,
    };
  });
}

export const LEVEL_LABEL: Record<CapabilityLevel, string> = {
  AUTOMATIC: "Automatic",
  GUIDED: "Guided",
  VERIFICATION_ONLY: "Verification only",
  UNSUPPORTED: "Unsupported",
};

/** The capability table as Markdown, embedded in docs/BROWSER-CAPABILITIES.md. */
export function renderMatrixMarkdown(): string {
  const cols: MatrixFamily[] = ["chrome", "edge", "firefox", "safari"];
  const head = "| Capability | Chrome | Edge | Firefox | Safari |\n| --- | --- | --- | --- | --- |";
  const cell = (e: MatrixEntry) =>
    `${LEVEL_LABEL[e.level]}${e.level === "GUIDED" ? (e.verifiable ? " + verified" : " (not verifiable)") : ""}${e.validated ? " ✓" : ""}`;
  const rows = CAPABILITY_MATRIX.map((r) => `| ${r.label} | ${cols.map((c) => cell(r.by[c])).join(" | ")} |`);
  return [head, ...rows].join("\n");
}
