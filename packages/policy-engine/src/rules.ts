import type { BrowserProtectionPolicy } from "@eguard/schemas";
import { categoryIndex } from "./categories.ts";
import { labelCount } from "./domain.ts";
import { evaluateUrl } from "./evaluate.ts";
import { isScheduleActive } from "./schedule.ts";
import { SAFE_SEARCH_ENGINES, UNSUPPORTED_SEARCHES } from "./search.ts";
import { canonicalJson } from "./signature.ts";

export {
  SAFE_SEARCH_ENGINES,
  UNSUPPORTED_SEARCHES,
  engineDomain,
  safeSearchEnginesFor,
  unsupportedSearch,
} from "./search.ts";

/**
 * Compiles a verified policy into declarativeNetRequest rules: the browser matches them itself, so eGuard never
 * sees the pages a child opens. Plain block rules need no host permission (redirecting to the block page would
 * need access to every site); the worker shows the block page when the browser reports the blocked load.
 *
 * Priorities encode evaluateUrl()'s order (highest wins):
 *   110 SafeSearch redirect, only on search engines the policy lets the child open (a warned one gets it with
 *       "Continue"); blocks of searches on engines where SafeSearch can't be enforced; and the YouTube Restricted
 *       Mode header (a header rule below a matching allow rule would be skipped, so it ranks above every allow)
 *   100 allow: eGuard's own web app
 *   54–91 the parent's allowed, approved (temporary) and blocked sites, by specificity (listPriority): a more
 *       specific rule wins, and allowed wins a tie
 *    40 block: blocked categories
 *    10 block every other web page: "other websites" is WARN/BLOCK, or focus hours are on
 * "Continue" on a warning adds a session allow rule for that exact host at 100 (enforcement.ts, not compiled here).
 */

export type ResourceType = "main_frame" | "sub_frame" | "xmlhttprequest";

export type DnrRule = {
  id: number;
  priority: number;
  action:
    | { type: "block" | "allow" }
    | {
        type: "redirect";
        redirect: { transform: { queryTransform: { addOrReplaceParams: { key: string; value: string }[] } } };
      }
    | { type: "modifyHeaders"; requestHeaders: { header: string; operation: "set"; value: string }[] };
  condition: {
    requestDomains?: string[];
    excludedRequestDomains?: string[];
    urlFilter?: string;
    regexFilter?: string;
    resourceTypes: ResourceType[];
  };
};

export const PRIORITY = { safeSearch: 110, allow: 100, site: 50, category: 40, other: 10 } as const;

/** Labels beyond this count as this many (no real domain gets near it; keeps every list rule below 100). */
const MAX_LABELS = 20;

/** Priority of an allowed or blocked site: deeper subdomains rank higher, and allowed beats blocked at a tie. */
export function listPriority(domain: string, kind: "allow" | "block"): number {
  return PRIORITY.site + 2 * Math.min(labelCount(domain), MAX_LABELS) + (kind === "allow" ? 1 : 0);
}

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
  const alwaysOpen = opts.alwaysAllow ?? [];
  if (alwaysOpen.length)
    add(PRIORITY.allow, { type: "allow" }, { requestDomains: sorted(alwaysOpen), resourceTypes: FRAMES });
  const temporary = policy.temporaryAllows.filter((t) => Date.parse(t.until) > nowMs).map((t) => t.domain);

  // One rule per (action, specificity), most specific first
  const lists = new Map<number, { kind: "allow" | "block"; domains: string[] }>();
  const put = (kind: "allow" | "block", domains: string[]) => {
    for (const d of domains) {
      const p = listPriority(d, kind);
      const group = lists.get(p) ?? { kind, domains: [] };
      group.domains.push(d);
      lists.set(p, group);
    }
  };
  // Approved sites rank as allowed ones: a more specific blocked site still wins (evaluateUrl does the same)
  put("allow", [...policy.allowedDomains, ...temporary]);
  put("block", policy.blockedDomains);
  for (const [priority, { kind, domains }] of [...lists].sort(([a], [b]) => b - a)) {
    add(priority, { type: kind }, { requestDomains: sorted(domains), resourceTypes: FRAMES });
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
      // Never let a SafeSearch redirect (priority 110) open a search engine the policy blocks or only warns about.
      // A warned engine gets its redirect with the child's "Continue" (enforcement.ts, safeSearchRule).
      const reachable =
        evaluateUrl(policy, `https://${engine.host}/`, { now: opts.now, categoryOf }).decision === "ALLOW";
      if (!reachable) continue;
      const r = safeSearchRule(engine, 0);
      add(r.priority, r.action, r.condition);
    }
    for (const u of UNSUPPORTED_SEARCHES) {
      add(
        PRIORITY.safeSearch,
        { type: "block" },
        {
          regexFilter: u.regexFilter,
          ...(u.excludedRequestDomains ? { excludedRequestDomains: u.excludedRequestDomains } : {}),
          resourceTypes: ["main_frame"],
        },
      );
    }
  }

  const restrict = youtubeRestrictHeader(policy);
  if (restrict) {
    add(
      PRIORITY.safeSearch,
      {
        type: "modifyHeaders",
        requestHeaders: [{ header: YOUTUBE_RESTRICT_HEADER, operation: "set", value: restrict }],
      },
      { requestDomains: [...YOUTUBE_DOMAINS], resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest"] },
    );
  }
  return rules;
}

/**
 * YouTube Restricted Mode: YouTube honours this request header on these hosts (Google's documented list for
 * network-enforced Restricted Mode). Setting a header needs host access to each, unlike a plain block.
 */
export const YOUTUBE_RESTRICT_HEADER = "YouTube-Restrict";
export const YOUTUBE_DOMAINS = [
  "youtube.com",
  "youtube-nocookie.com",
  "youtubei.googleapis.com",
  "youtube.googleapis.com",
] as const;

/**
 * The header value for the policy's `youtubeRestrict`, or null when it's off or not sent (older servers). A
 * level this build doesn't know is enforced as Strict, the way an unknown "other websites" mode is enforced as BLOCK.
 */
export function youtubeRestrictHeader(policy: BrowserProtectionPolicy): "Moderate" | "Strict" | null {
  const level = policy.youtubeRestrict;
  if (level === undefined || level === "OFF") return null;
  return level === "MODERATE" ? "Moderate" : "Strict";
}

/**
 * A regex (for a session rule) that opens exactly `host` (any port and path), not its subdomains: requestDomains would also
 * match every subdomain, so "Continue" on example.com would open a blocked games.example.com, and on a bare
 * suffix like "com" every .com site.
 */
export function exactHostFilter(host: string): string {
  return `^https?://${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(:[0-9]+)?([/?#]|$)`;
}

/** The SafeSearch redirect for one engine, at the priority that beats every allow rule. */
export function safeSearchRule(engine: (typeof SAFE_SEARCH_ENGINES)[number], id: number): DnrRule {
  return {
    id,
    priority: PRIORITY.safeSearch,
    action: {
      type: "redirect",
      redirect: { transform: { queryTransform: { addOrReplaceParams: [engine.param] } } },
    },
    condition: { regexFilter: engine.regexFilter, resourceTypes: ["main_frame"] },
  };
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
  action: {
    type: string;
    redirect?: unknown;
    requestHeaders?: { header: string; operation: string; value?: string }[];
  };
  condition: {
    requestDomains?: string[];
    excludedRequestDomains?: string[];
    urlFilter?: string;
    regexFilter?: string;
    resourceTypes?: string[];
  };
}): string {
  return canonicalJson({
    id: r.id,
    priority: r.priority ?? 1,
    action: {
      type: r.action.type,
      redirect: withoutDefaults(r.action.redirect) ?? null,
      // Header names are case-insensitive; a browser may store them in another case
      requestHeaders:
        r.action.requestHeaders?.map((h) => ({
          header: h.header.toLowerCase(),
          operation: h.operation,
          value: h.value ?? null,
        })) ?? null,
    },
    condition: {
      requestDomains: r.condition.requestDomains ? [...r.condition.requestDomains].sort() : null,
      excludedRequestDomains: r.condition.excludedRequestDomains?.length
        ? [...r.condition.excludedRequestDomains].sort()
        : null,
      urlFilter: r.condition.urlFilter ?? null,
      regexFilter: r.condition.regexFilter ?? null,
      resourceTypes: r.condition.resourceTypes ? [...r.condition.resourceTypes].sort() : null,
    },
  });
}

/**
 * Firefox stores a redirect with every optional field it didn't get as null, and replaceOnly as false (its
 * default). Dropping null, false and what's left empty compares only what was set.
 */
function withoutDefaults(v: unknown): unknown {
  if (v === null || v === undefined || v === false) return undefined;
  if (Array.isArray(v)) return v.map((x) => withoutDefaults(x) ?? null);
  if (typeof v !== "object") return v;
  const entries = Object.entries(v)
    .map(([k, x]) => [k, withoutDefaults(x)] as const)
    .filter(([, x]) => x !== undefined);
  return entries.length ? Object.fromEntries(entries) : undefined;
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
