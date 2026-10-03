import { z } from "zod";

/**
 * A host name as the policy engine stores it: lower-case, no scheme, port, path or trailing dot.
 * Wildcards are implied (a rule for example.com also covers www.example.com).
 * No trimming or lower-casing: the signature is checked over the parsed value, so a transform would turn a
 * signed policy into one that fails verification. The server sends normalised names; anything else is refused.
 */
export const Domain = z
  .string()
  .max(253)
  .regex(/^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/, "Not a valid domain");
export type Domain = z.infer<typeof Domain>;

/** The categories this build has labels for. Policies may carry newer ones (see CategoryKey). */
export const WebCategory = z.enum([
  "ADULT",
  "GAMBLING",
  "MALWARE",
  "PHISHING",
  "VIOLENCE",
  "DRUGS",
  "WEAPONS",
  "HATE",
  "DATING",
  "SOCIAL_MEDIA",
  "GAMING",
  "STREAMING",
  "SHOPPING",
  "DOWNLOADS",
]);
export type WebCategory = z.infer<typeof WebCategory>;

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

/**
 * A category key as the server sends it. Open-ended on purpose: a category added on the server after this build
 * shipped must not make every policy fail to parse (that would freeze every installed browser on its last policy).
 * Its sites are blocked like any other; the block page calls it "other". Same shape POST /events accepts.
 */
export const CategoryKey = z.string().regex(/^[A-Z][A-Z_]{1,31}$/, "Not a category key");

export const UnknownSitesPolicy = z.enum(["ALLOW", "WARN", "BLOCK"]);
export type UnknownSitesPolicy = z.infer<typeof UnknownSitesPolicy>;

/**
 * The browser policy the backend sends. Versioned: the extension only ever moves forward,
 * and keeps the last valid one when offline (see docs/ARCHITECTURE.md §Offline).
 *
 * Objects are loose: the signature covers every field the server sent, so a field this build doesn't know yet must
 * survive parsing (and storage) for the signature to verify. A strict or stripping schema would make one additive
 * server change refuse every new policy. Unknown fields are kept but never enforced.
 */
export const BrowserProtectionPolicy = z.looseObject({
  id: z.string().min(1),
  childId: z.string().min(1),
  installationId: z.string().min(1),
  version: z.number().int().positive(),
  safeBrowsing: z.boolean(),
  safeSearch: z.boolean(),
  blockedCategories: z.array(CategoryKey).max(64),
  blockedDomains: z.array(Domain).max(5000),
  allowedDomains: z.array(Domain).max(5000),
  /** ALLOW, WARN or BLOCK; a mode this build doesn't know is enforced as BLOCK (policy-engine otherSitesDecision). */
  unknownSitesPolicy: z.string().regex(/^[A-Z][A-Z_]{1,31}$/),
  schedule: z
    .looseObject({
      enabled: z.boolean(),
      /** Protection is tightened (unknown sites blocked) between these times. */
      startTime: HHMM,
      endTime: HHMM,
      timezone: z.string().min(1).max(64),
    })
    .nullable(),
  /** Parent-approved exceptions (from access requests) until a time. The extension ignores expired ones. */
  temporaryAllows: z
    .array(z.looseObject({ domain: Domain, until: z.iso.datetime({ offset: true }) }))
    .max(500),
  /**
   * Sites on eGuard's lists for the categories this family blocks (only those). Signed with the policy.
   * No defaults or transforms here: the signature is checked over exactly what was parsed.
   */
  categoryDomains: z.record(CategoryKey, z.array(Domain).max(50_000)),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type BrowserProtectionPolicy = z.infer<typeof BrowserProtectionPolicy>;

/** What GET /api/browser/v1/policy returns: the policy plus eGuard's signature over its canonical JSON. */
export const PolicyEnvelope = z.object({
  policy: BrowserProtectionPolicy,
  /** base64 ECDSA P-256 / SHA-256, raw r||s */
  signature: z.string().min(1).max(200),
  /** First 16 hex chars of SHA-256 of the signing public key, for diagnostics and rotation */
  keyId: z.string().max(64),
});
export type PolicyEnvelope = z.infer<typeof PolicyEnvelope>;
