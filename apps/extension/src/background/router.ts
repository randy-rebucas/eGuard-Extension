import { ExtensionMessage, type BlockInfo, type MessageResponse } from "@eguard/schemas";
import { isTrustedSender, type SenderLike } from "./sender.ts";
import { UserFacingError, type Service } from "./service.ts";

export type Trust = { runtimeId: string; extensionBase: string };

const fail = (code: string, error: string): MessageResponse => ({ ok: false, code, error });

/**
 * Entry point for every message. Order: who sent it → is it well-formed → do it.
 * Always resolves with a MessageResponse; internal errors never leak details to the page.
 */
export async function handleMessage(
  raw: unknown,
  sender: SenderLike,
  service: Service,
  trust: Trust,
  log: (event: string, detail?: Record<string, unknown>) => void = () => {},
): Promise<MessageResponse> {
  if (!isTrustedSender(sender, trust.runtimeId, trust.extensionBase)) {
    log("message_refused", { reason: "untrusted_sender" });
    return fail("FORBIDDEN", "This request isn't allowed.");
  }
  const parsed = ExtensionMessage.safeParse(raw);
  if (!parsed.success) {
    const pairing =
      typeof raw === "object" && raw !== null && (raw as { type?: unknown }).type === "PAIR_WITH_CODE";
    return pairing
      ? fail("INVALID_CODE", "Enter the pairing code shown in the eGuard parent dashboard.")
      : fail("INVALID_MESSAGE", "That request wasn't understood.");
  }

  const msg = parsed.data;
  let block: BlockInfo | undefined;
  try {
    switch (msg.type) {
      case "GET_PROTECTION_STATUS":
        break;
      case "RUN_HEALTH_CHECK":
        await service.runHealthCheck();
        break;
      case "SYNC_POLICY":
        await service.syncPolicy();
        break;
      case "PAIR_WITH_CODE":
        await service.pairWithCode(msg.code);
        break;
      case "OPEN_PARENT_DASHBOARD":
        await service.openDashboard();
        break;
      case "OPEN_ONBOARDING":
        await service.openOnboarding();
        break;
      case "GET_BLOCK_INFO":
        block = await service.blockInfo(msg.url);
        break;
      case "CHECK_ACCESS":
        block = await service.checkAccess(msg.url);
        break;
      case "REQUEST_ACCESS":
        block = await service.requestAccess(msg.url, msg.reason);
        break;
      case "CONTINUE_TO_SITE":
        await service.continueToSite(msg.url);
        break;
    }
    const status = await service.getStatus();
    return block ? { ok: true, status, block } : { ok: true, status };
  } catch (err) {
    if (err instanceof UserFacingError) return fail(err.code, err.message);
    log("message_failed", { type: msg.type, error: String(err) });
    return fail("INTERNAL", "Something went wrong in eGuard. Your protection settings haven't changed.");
  }
}
