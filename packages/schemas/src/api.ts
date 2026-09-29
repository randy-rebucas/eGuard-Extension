import { z } from "zod";

/**
 * Wire contract with the eGuard backend (/api/browser/v1). See docs/API.md.
 * Errors follow the existing eGuard convention: `error` is written for people and safe to show.
 */
export const ApiErrorBody = z.object({ error: z.string(), code: z.string().optional() });
export type ApiErrorBody = z.infer<typeof ApiErrorBody>;

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
