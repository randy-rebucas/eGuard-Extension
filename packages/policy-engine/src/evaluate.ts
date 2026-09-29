import type { BrowserProtectionPolicy, WebCategory } from "@eguard/schemas";
import { httpHost, matchDomain } from "./domain.ts";
import { isScheduleActive } from "./schedule.ts";

export type Decision = "ALLOW" | "WARN" | "BLOCK";

export type Reason =
  | { type: "NOT_WEB" }
  | { type: "ALLOWED_SITE"; domain: string }
  | { type: "TEMPORARY_ALLOW"; domain: string; until: string }
  | { type: "BLOCKED_SITE"; domain: string }
  | { type: "CATEGORY"; category: WebCategory }
  | { type: "FOCUS_HOURS" }
  | { type: "UNKNOWN_SITE" };

export type Evaluation = { decision: Decision; host: string | null; reason: Reason };

export type EvaluateOptions = {
  now: Date;
  /** Category of a host from eGuard's lists, when known. Unlisted hosts are "unknown sites". */
  categoryOf?: (host: string) => WebCategory | null;
};

/**
 * What the policy says about one URL. Order, most specific first:
 * allowed site → parent-approved (temporary) site → blocked site → blocked category → focus hours → the
 * "other websites" rule. Allowed sites win so a parent can always make an exception inside a blocked category.
 * compileRules() encodes the same order as rule priorities; a test keeps the two in step.
 */
export function evaluateUrl(policy: BrowserProtectionPolicy, url: string, opts: EvaluateOptions): Evaluation {
  const host = httpHost(url);
  if (!host) return { decision: "ALLOW", host: null, reason: { type: "NOT_WEB" } };

  const allowed = matchDomain(host, policy.allowedDomains);
  if (allowed) return { decision: "ALLOW", host, reason: { type: "ALLOWED_SITE", domain: allowed } };

  const now = opts.now.getTime();
  const temporary = policy.temporaryAllows.filter((t) => Date.parse(t.until) > now);
  const tempRule = matchDomain(
    host,
    temporary.map((t) => t.domain),
  );
  if (tempRule) {
    const until = temporary.find((t) => t.domain === tempRule)!.until;
    return { decision: "ALLOW", host, reason: { type: "TEMPORARY_ALLOW", domain: tempRule, until } };
  }

  const blocked = matchDomain(host, policy.blockedDomains);
  if (blocked) return { decision: "BLOCK", host, reason: { type: "BLOCKED_SITE", domain: blocked } };

  const category = opts.categoryOf?.(host) ?? null;
  if (category && policy.blockedCategories.includes(category)) {
    return { decision: "BLOCK", host, reason: { type: "CATEGORY", category } };
  }

  if (isScheduleActive(policy.schedule, opts.now))
    return { decision: "BLOCK", host, reason: { type: "FOCUS_HOURS" } };

  return { decision: policy.unknownSitesPolicy, host, reason: { type: "UNKNOWN_SITE" } };
}
