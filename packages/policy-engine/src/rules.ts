import type { BrowserProtectionPolicy } from "@eguard/schemas";
import { categoryIndex } from "./categories.ts";
import { evaluateUrl } from "./evaluate.ts";
import { isScheduleActive } from "./schedule.ts";
import { canonicalJson } from "./signature.ts";

/**
 * Compiles a verified policy into declarativeNetRequest rules: the browser matches them itself, so eGuard never
 * sees the pages a child opens. Plain block rules need no host permission (redirecting to the block page would
 * need access to every site); the worker shows the block page when the browser reports the blocked load.
 *
 * Priorities encode evaluateUrl()'s order (highest wins):
 *   110 SafeSearch redirect, only on search engines the policy lets the child open
 *   100 allow: allowed sites, parent-approved (temporary) sites, eGuard's own web app
 *    50 block: blocked sites
 *    40 block: blocked categories
 *    10 block every other web page: "other websites" is WARN/BLOCK, or focus hours are on
 * "Continue" on a warning adds a session allow rule at 100 (not compiled here).
 */

export type ResourceType = "main_frame" | "sub_frame";

export type DnrRule = {
  id: number;
  priority: number;
  action:
    | { type: "block" | "allow" }
    | {
        type: "redirect";
        redirect: { transform: { queryTransform: { addOrReplaceParams: { key: string; value: string }[] } } };
      };
  condition: {
    requestDomains?: string[];
    urlFilter?: string;
    regexFilter?: string;
    resourceTypes: ResourceType[];
  };
};

export const PRIORITY = { safeSearch: 110, allow: 100, site: 50, category: 40, other: 10 } as const;

/** Search engines eGuard enforces SafeSearch on. Each needs a host permission in the manifest. */
export const SAFE_SEARCH_ENGINES = [
  {
    host: "www.google.com",
    regexFilter: "^https?://(www\\.)?google\\.com/search\\?",
    param: { key: "safe", value: "active" },
  },
  {
    host: "www.google.com.ph",
    regexFilter: "^https?://(www\\.)?google\\.com\\.ph/search\\?",
    param: { key: "safe", value: "active" },
  },
  {
    host: "www.bing.com",
    regexFilter: "^https?://(www\\.)?bing\\.com/search\\?",
    param: { key: "adlt", value: "strict" },
  },
  {
    host: "duckduckgo.com",
    regexFilter: "^https?://(www\\.)?duckduckgo\\.com/\\?",
    param: { key: "kp", value: "1" },
  },
] as const;

const FRAMES: ResourceType[] = ["main_frame", "sub_frame"];

export type CompileOptions = {
  now: Date;
  /** Hosts that must always open (eGuard's web app, so a parent can sign in on this computer). */
  alwaysAllow?: string[];
};

export function compileRules(policy: BrowserProtectionPolicy, opts: CompileOptions): DnrRule[] {
  const rules: DnrRule[] = [];
  let id = 1;
  const add = (priority: number, action: DnrRule["action"], condition: DnrRule["condition"]) =>
    rules.push({ id: id++, priority, action, condition });

  const nowMs = opts.now.getTime();
  const allowed = [
    ...policy.allowedDomains,
    ...policy.temporaryAllows.filter((t) => Date.parse(t.until) > nowMs).map((t) => t.domain),
    ...(opts.alwaysAllow ?? []),
  ];
  if (allowed.length)
    add(PRIORITY.allow, { type: "allow" }, { requestDomains: sorted(allowed), resourceTypes: FRAMES });

  if (policy.blockedDomains.length) {
    add(
      PRIORITY.site,
      { type: "block" },
      { requestDomains: sorted(policy.blockedDomains), resourceTypes: FRAMES },
    );
  }

  for (const category of [...policy.blockedCategories].sort()) {
    const domains = policy.categoryDomains[category] ?? [];
    if (domains.length)
      add(PRIORITY.category, { type: "block" }, { requestDomains: sorted(domains), resourceTypes: FRAMES });
  }

  if (policy.unknownSitesPolicy !== "ALLOW" || isScheduleActive(policy.schedule, opts.now)) {
    add(PRIORITY.other, { type: "block" }, { urlFilter: "|http", resourceTypes: ["main_frame"] });
  }

  if (policy.safeSearch) {
    const categoryOf = categoryIndex(policy);
    for (const engine of SAFE_SEARCH_ENGINES) {
      // Never let a SafeSearch redirect (priority 110) open a search engine the policy blocks or only warns about
      const reachable =
        evaluateUrl(policy, `https://${engine.host}/`, { now: opts.now, categoryOf }).decision === "ALLOW";
      if (!reachable) continue;
      add(
        PRIORITY.safeSearch,
        {
          type: "redirect",
          redirect: { transform: { queryTransform: { addOrReplaceParams: [engine.param] } } },
        },
        { regexFilter: engine.regexFilter, resourceTypes: ["main_frame"] },
      );
    }
  }
  return rules;
}

function sorted(list: string[]) {
  return [...new Set(list)].sort();
}

/**
 * A stable fingerprint of what a rule does, for comparing what's installed in the browser with what the policy
 * requires. Browsers may add default fields when they store rules, so only the fields eGuard sets are compared.
 */
export function ruleFingerprint(r: {
  id: number;
  priority?: number;
  action: { type: string; redirect?: unknown };
  condition: {
    requestDomains?: string[];
    urlFilter?: string;
    regexFilter?: string;
    resourceTypes?: string[];
  };
}): string {
  return canonicalJson({
    id: r.id,
    priority: r.priority ?? 1,
    action: { type: r.action.type, redirect: r.action.redirect ?? null },
    condition: {
      requestDomains: r.condition.requestDomains ? [...r.condition.requestDomains].sort() : null,
      urlFilter: r.condition.urlFilter ?? null,
      regexFilter: r.condition.regexFilter ?? null,
      resourceTypes: r.condition.resourceTypes ? [...r.condition.resourceTypes].sort() : null,
    },
  });
}

/** True when `installed` does exactly what `expected` does: no rule missing, changed or extra. */
export function sameRules(
  expected: Parameters<typeof ruleFingerprint>[0][],
  installed: Parameters<typeof ruleFingerprint>[0][],
) {
  if (expected.length !== installed.length) return false;
  const a = expected.map(ruleFingerprint).sort();
  const b = installed.map(ruleFingerprint).sort();
  return a.every((x, i) => x === b[i]);
}
