import { create } from "zustand";
import type { ExtensionMessageInput, ProtectionStatus } from "@eguard/schemas";
import { send } from "./messaging.ts";

type Busy = ExtensionMessageInput["type"] | null;

type StatusStore = {
  status: ProtectionStatus | null;
  /** Last command's error, shown near the action that caused it. */
  error: { code: string; message: string } | null;
  busy: Busy;
  /** Sends a command; the reply always carries fresh status. Returns true on success. */
  run: (message: ExtensionMessageInput) => Promise<boolean>;
  clearError: () => void;
};

export const useStatus = create<StatusStore>((set, get) => ({
  status: null,
  error: null,
  busy: null,
  async run(message) {
    const quiet = message.type === "GET_PROTECTION_STATUS";
    if (!quiet) set({ busy: message.type, error: null });
    const res = await send(message);
    if (res.ok) {
      set({ status: res.status, busy: null, ...(quiet ? {} : { error: null }) });
      return true;
    }
    // A failed background refresh must not replace the error of the command the person just tried
    set({ busy: null, error: quiet && get().error ? get().error : { code: res.code, message: res.error } });
    // Keep the status fresh even when the command failed
    if (!quiet) await get().run({ type: "GET_PROTECTION_STATUS" });
    return false;
  },
  clearError: () => set({ error: null }),
}));
