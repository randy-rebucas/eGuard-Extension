import { z } from "zod";
import { CheckStatus } from "./capability.ts";
import { HealthCheckId, ProtectionState } from "./status.ts";

/**
 * Wire contract with the eGuard backend (/api/browser/v1). See docs/API.md.
 * Errors follow the existing eGuard convention: `error` is written for people and safe to show.
 */
export const ApiErrorBody = z.object({
  error: z.string(),
  code: z.string().optional(),
  /** /token's installation_revoked and token_reused: eGuard's signed word (RevocationProof), kept unparsed here. */
  revocation: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

/**
 * eGuard's signed statement that this installation is gone, signed with the policy key over the canonical JSON of
 * `revocation`. The extension forgets its connection (and lifts its rules) only on one that verifies: an unsigned
 * 401 could come from a proxy between the browser and eGuard.
 */
export const RevocationProof = z.object({
  revocation: z.looseObject({
    type: z.literal("eguard.browser.revoked"),
    installationId: z.string().min(1),
    at: z.string(),
  }),
  signature: z.string().min(1).max(200),
  keyId: z.string().max(64),
});
export type RevocationProof = z.infer<typeof RevocationProof>;

export const PairRequest = z.object({
  code: z.string(),
  browser: z.string().max(40),
  browserVersion: z.string().max(40).nullable(),
  extensionVersion: z.string().max(20),
  platform: z.string().max(40),
});
export type PairRequest = z.infer<typeof PairRequest>;

export const TokenGrant = z.object({
  accessToken: z.string().min(20),
  /** ISO timestamp. Access tokens are short-lived (minutes). */
  accessTokenExpiresAt: z.iso.datetime(),
  /** Rotated on every refresh; the old one stops working immediately. */
  refreshToken: z.string().min(20),
});
export type TokenGrant = z.infer<typeof TokenGrant>;

export const PairResponse = TokenGrant.extend({
  installationId: z.string().min(1),
  familyName: z.string(),
  childName: z.string(),
  deviceName: z.string(),
});
export type PairResponse = z.infer<typeof PairResponse>;

export const RefreshRequest = z.object({ installationId: z.string(), refreshToken: z.string() });

export const AccessRequest = z.object({
  id: z.string(),
  domain: z.string(),
  reason: z.string().nullable(),
  status: z.enum(["PENDING", "APPROVED", "DENIED"]),
  duration: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});
export type AccessRequest = z.infer<typeof AccessRequest>;
export const AccessRequestEnvelope = z.object({ request: AccessRequest });
export const AccessRequestList = z.object({ requests: z.array(AccessRequest) });

/**
 * POST /health: the state the popup shows, the policy version enforced, each check's status, and the versions
 * (so the parent sees the current one after an update, not the one from pairing day). Nothing else.
 */
export const HealthReport = z.object({
  state: ProtectionState,
  policyVersion: z.number().int().positive().nullable(),
  checks: z.array(z.object({ id: HealthCheckId, status: CheckStatus })),
  extensionVersion: z.string().max(20).optional(),
  browserVersion: z.string().max(40).nullable().optional(),
});
export type HealthReport = z.infer<typeof HealthReport>;
export const HealthReportResponse = z.object({ ok: z.literal(true), score: z.number(), total: z.number() });

/**
 * POST /events: how many pages were blocked on one day (in the family's time zone), per category or reason
 * (BLOCKED_SITE, UNKNOWN_SITE, FOCUS_HOURS). Never a site, never finer than a day.
 */
export const EventsReport = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  blocked: z.record(z.string(), z.number().int().nonnegative()),
});
export type EventsReport = z.infer<typeof EventsReport>;
export const EventsResponse = z.object({ ok: z.literal(true) });
