import { z } from "zod";

/**
 * How much eGuard can do for a capability in a given browser (spec §39). The same four words must be
 * used by the extension, the mobile apps, the parent dashboard and the docs.
 *
 * - AUTOMATIC: eGuard performs the action itself (and verifies it).
 * - GUIDED: eGuard walks the parent through the steps. `verifiable` says whether eGuard can confirm it after.
 * - VERIFICATION_ONLY: eGuard can tell whether it is set, but cannot change it.
 * - UNSUPPORTED: the browser doesn't expose enough to do either. Never shown as active.
 */
export const CapabilityLevel = z.enum(["AUTOMATIC", "GUIDED", "VERIFICATION_ONLY", "UNSUPPORTED"]);
export type CapabilityLevel = z.infer<typeof CapabilityLevel>;

/** Result of a single configuration-health check (same values as the web app's CheckStatus). */
export const CheckStatus = z.enum(["PASS", "WARNING", "ACTION_REQUIRED", "UNSUPPORTED", "NOT_CONFIGURED"]);
export type CheckStatus = z.infer<typeof CheckStatus>;

export const CapabilityId = z.enum([
  "WEBSITE_FILTERING",
  "DOMAIN_ALLOWLIST",
  "CATEGORY_FILTERING",
  "SAFE_SEARCH",
  "BROWSER_SAFE_BROWSING",
  "PRIVATE_WINDOWS",
  "SCHEDULED_PROTECTION",
  "TAMPER_RESISTANCE",
  "POLICY_SYNC",
  "HEALTH_CHECK",
  "PARENT_APPROVAL",
]);
export type CapabilityId = z.infer<typeof CapabilityId>;

export const Capability = z.object({
  id: CapabilityId,
  level: CapabilityLevel,
  /** eGuard can confirm the result afterwards. Always true for AUTOMATIC and VERIFICATION_ONLY. */
  verifiable: z.boolean(),
  /** Short, parent-facing explanation of what this level means in this browser. */
  note: z.string(),
});
export type Capability = z.infer<typeof Capability>;
