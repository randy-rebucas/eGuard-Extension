import { getExtensionApi } from "@eguard/browser-adapter";
import { MessageResponse, type ExtensionMessageInput } from "@eguard/schemas";

/** Sends a command to the background worker and validates the reply. Never throws. */
export async function send(message: ExtensionMessageInput): Promise<MessageResponse> {
  try {
    const raw: unknown = await getExtensionApi().runtime.sendMessage(message);
    const parsed = MessageResponse.safeParse(raw);
    if (parsed.success) return parsed.data;
  } catch {
    // The worker may be restarting; fall through to a friendly message.
  }
  return { ok: false, code: "UNAVAILABLE", error: "eGuard is starting up. Try again in a moment." };
}
