import { z } from "zod";
import { ProtectionStatus } from "./status.ts";

/**
 * Messages extension pages send to the background worker (spec §29).
 * Every message is parsed with `.strict()` schemas, so unknown fields are rejected, not ignored.
 */
export const PairingCode = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, "").toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{6,12}$/, "Enter the code shown in the eGuard parent dashboard"));

/** Long enough for real-world addresses (long query strings included); the block page must still explain them. */
const PageUrl = z.url({ protocol: /^https?$/ }).max(65_536);

export const BlockReason = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BLOCKED_SITE") }),
  z.object({ type: z.literal("CATEGORY"), category: z.string() }),
  z.object({ type: z.literal("FOCUS_HOURS"), until: z.string() }),
  z.object({ type: z.literal("UNKNOWN_SITE") }),
  /** A search on an engine where eGuard can't turn on SafeSearch */
  z.object({ type: z.literal("SAFE_SEARCH") }),
]);

/** What the block page shows. Built by the worker from the verified policy. */
export const BlockInfo = z.object({
  url: z.string(),
  host: z.string(),
  decision: z.enum(["ALLOW", "WARN", "BLOCK"]),
  reason: BlockReason.nullable(),
  childName: z.string().nullable(),
  request: z
    .object({ status: z.enum(["PENDING", "APPROVED", "DENIED"]), duration: z.string().nullable() })
    .nullable(),
});
export type BlockInfo = z.infer<typeof BlockInfo>;

export const ExtensionMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("GET_PROTECTION_STATUS") }).strict(),
  z.object({ type: z.literal("RUN_HEALTH_CHECK") }).strict(),
  z.object({ type: z.literal("SYNC_POLICY") }).strict(),
  z.object({ type: z.literal("OPEN_PARENT_DASHBOARD") }).strict(),
  z.object({ type: z.literal("OPEN_ONBOARDING") }).strict(),
  z.object({ type: z.literal("PAIR_WITH_CODE"), code: PairingCode }).strict(),
  // From the block page. The worker re-evaluates the URL itself; nothing the page says is trusted.
  z.object({ type: z.literal("GET_BLOCK_INFO"), url: PageUrl }).strict(),
  z.object({ type: z.literal("CONTINUE_TO_SITE"), url: PageUrl }).strict(),
  z.object({ type: z.literal("CHECK_ACCESS"), url: PageUrl }).strict(),
  z
    .object({
      type: z.literal("REQUEST_ACCESS"),
      url: PageUrl,
      reason: z.string().trim().max(280).optional(),
    })
    .strict(),
]);
export type ExtensionMessage = z.infer<typeof ExtensionMessage>;
export type ExtensionMessageInput = z.input<typeof ExtensionMessage>;
export type MessageType = ExtensionMessage["type"];

/** Every reply has this shape. `error` is always parent/child-safe text; never a stack trace. */
export const MessageResponse = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), status: ProtectionStatus, block: BlockInfo.optional() }),
  z.object({ ok: z.literal(false), error: z.string(), code: z.string() }),
]);
export type MessageResponse = z.infer<typeof MessageResponse>;
