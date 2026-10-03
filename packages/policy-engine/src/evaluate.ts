import type { BrowserProtectionPolicy } from "@eguard/schemas";
import { httpHost, labelCount, matchDomain } from "./domain.ts";
import { isScheduleActive } from "./schedule.ts";
import { unsupportedSearch } from "./search.ts";

export type Decision = "ALLOW" | "WARN" | "BLOCK";

export type Reason =
  | { type: "NOT_WEB" }
  | { type: "ALLOWED_SITE"; domain: string }
  | { type: "TEMPORARY_ALLOW"; domain: string; until: string }
  | { type: "SAFE_SEARCH" }
  | { type: "BLOCKED_SITE"; domain: string }
  | { type: "CATEGORY"; category: string }
  | { type: "FOCUS_HOURS" }
  | { type: "UNKNOWN_SITE" };

export type Evaluation = { decision: Decision; host: string | null; reason: Reason };

export type EvaluateOptions = {
  now: Date;
  /** Category of a host from eGuard's lists, when known. Unlisted hosts are "unknown sites". */
  categoryOf?: (host: string) => string | null;
};

/**
 * What eGuard enforces for sites on no list. A mode this build doesn't know (added on the server later) is
 * enforced as the strictest one rather than refusing the whole policy.
 */
export function otherSitesDecision(policy: BrowserProtectionPolicy): Decision {
  return policy.unknownSitesPolicy === "ALLOW" || policy.unknownSitesPolicy === "WARN"
    ? policy.unknownSitesPolicy
    : "BLOCK";
}

/**
 * What the policy says about one URL. Order:
 * a search on an engine eGuard can't enforce SafeSearch on (when SafeSearch is on) → allowed site, unless a
 * blocked site is more specific (allowed example.com, blocked games.example.com: games.example.com is blocked; a
 * tie goes to allowed) → parent-approved (temporary) site → blocked site → blocked category → focus hours → the
 * "other websites" rule. Allowed sites beat categories, so a parent can always make an exception inside a blocked category.
 * compileRules() encodes the same order as rule priorities; a test keeps the two in step.
 */
export function evaluateUrl(policy: BrowserProtectionPolicy, url: string, opts: EvaluateOptions): Evaluation {
  const host = httpHost(url);
  if (!host) return { decision: "ALLOW", host: null, reason: { type: "NOT_WEB" } };

  if (policy.safeSearch && unsupportedSearch(url))
    return { decision: "BLOCK", host, reason: { type: "SAFE_SEARCH" } };

  const allowed = matchDomain(host, policy.allowedDomains);
  const blocked = matchDomain(host, policy.blockedDomains);
  if (allowed && (!blocked || labelCount(allowed) >= labelCount(blocked)))
    return { decision: "ALLOW", host, reason: { type: "ALLOWED_SITE", domain: allowed } };

  const now = opts.now.getTime();
  const temporary = policy.temporaryAllows.filter((t) => Date.parse(t.until) > now);
  const tempRule = matchDomain(
    host,
    temporary.map((t) => t.domain),
  );
  if (tempRule) {
    // The latest end, if the same site was approved more than once
    const until = temporary
      .filter((t) => t.domain === tempRule)
      .map((t) => t.until)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0]!;
    return { decision: "ALLOW", host, reason: { type: "TEMPORARY_ALLOW", domain: tempRule, until } };
  }

  if (blocked) return { decision: "BLOCK", host, reason: { type: "BLOCKED_SITE", domain: blocked } };

  const category = opts.categoryOf?.(host) ?? null;
  if (category && policy.blockedCategories.includes(category)) {
    return { decision: "BLOCK", host, reason: { type: "CATEGORY", category } };
  }

  if (isScheduleActive(policy.schedule, opts.now))
    return { decision: "BLOCK", host, reason: { type: "FOCUS_HOURS" } };

  return { decision: otherSitesDecision(policy), host, reason: { type: "UNKNOWN_SITE" } };
}
