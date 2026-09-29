import { z } from "zod";
import { BrowserInfo } from "./browser.ts";
import { CheckStatus } from "./capability.ts";
import { UnknownSitesPolicy } from "./policy.ts";

/** The family's settings in force, for display. Counts only: the popup never lists sites. */
export const PolicySummary = z.object({
  safeSearch: z.boolean(),
  safeBrowsing: z.boolean(),
  blockedCategories: z.number().int(),
  blockedSites: z.number().int(),
  allowedSites: z.number().int(),
  otherSites: UnknownSitesPolicy,
  focusHours: z.object({ startTime: z.string(), endTime: z.string(), activeNow: z.boolean() }).nullable(),
});
export type PolicySummary = z.infer<typeof PolicySummary>;

/**
 * The single answer to "am I protected?" (spec §6).
 * PROTECTED is only ever produced when a policy is present AND its rules are verified in the browser.
 */
export const ProtectionState = z.enum([
  "PROTECTED",
  "NEEDS_ATTENTION",
  "ACTION_REQUIRED",
  "SYNC_PAUSED",
  "UNSUPPORTED",
]);
export type ProtectionState = z.infer<typeof ProtectionState>;

export const IssueAction = z.enum(["CONNECT", "SYNC_NOW", "OPEN_DASHBOARD", "RUN_HEALTH_CHECK"]);
export type IssueAction = z.infer<typeof IssueAction>;

export const Issue = z.object({
  id: z.string(),
  status: CheckStatus,
  title: z.string(),
  detail: z.string(),
  action: IssueAction.nullable(),
});
export type Issue = z.infer<typeof Issue>;

export const Connection = z.discriminatedUnion("paired", [
  z.object({ paired: z.literal(false) }),
  z.object({
    paired: z.literal(true),
    installationId: z.string(),
    familyName: z.string(),
    childName: z.string(),
    deviceName: z.string(),
  }),
]);
export type Connection = z.infer<typeof Connection>;

export const ProtectionStatus = z.object({
  state: ProtectionState,
  headline: z.string(),
  summary: z.string(),
  browser: BrowserInfo,
  connection: Connection,
  policyVersion: z.number().int().nullable(),
  policySummary: PolicySummary.nullable(),
  lastSyncAt: z.iso.datetime().nullable(),
  lastHealthCheckAt: z.iso.datetime().nullable(),
  issues: z.array(Issue),
});
export type ProtectionStatus = z.infer<typeof ProtectionStatus>;
